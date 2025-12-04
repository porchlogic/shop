# readme

## Frontend → backend payload

- Cart is persisted in `sessionStorage` under `porchlogic_cart` and is reused on the cart and checkout pages.
- Checkout POSTs to `https://api.porchlogic.com/create-checkout-session` with `{"cartItems":[...]}` exactly as stored in the cart.
- M8 PLATE items already include the needed attributes for the backend:

```json
{
  "id": "m8_plate_1",
  "uid": "ci_xyz123",          // per-line unique key
  "name": "M8 PLATE",
  "price": 32,
  "quantity": 1,
  "material": "PETG",
  "color": "Smoke",            // "Smoke" | "Clear"
  "customGlyphEnabled": true,  // toggle on cart page
  "glyphData": [[0,1,...]],    // 8x16 grid of 0/1 values; null when disabled
  "showOnLive": false          // toggle on cart page
}
```

- Glyph edits from the cart modal update `glyphData` in-place and the value is sent unchanged to the backend. Both toggles are booleans, so backend parsing can be simple type checks.

### Shipping methods

Checkout now hard-codes three shipping options. The selected method is sent with `create-checkout-session` as:

```json
{
  "shippingMethod": {
    "id": "us_economy",                  // us_economy | us_priority | intl_economy
    "label": "US Economy (3–7 days)",    // human-readable label
    "amount": 6                          // numeric USD cost
  }
}
```

Totals shown on the checkout page include the chosen shipping amount before payment is submitted.



### Backend functions (for reference)

```js
// ---------- Checkout session creation ----------

app.post("/create-checkout-session", async (req, res) => {
	console.log("🔥 /create-checkout-session hit");
	console.log("🔥 Raw cartItems from client:", JSON.stringify(req.body, null, 2));

	const { cartItems } = req.body;

	if (!Array.isArray(cartItems) || cartItems.length === 0) {
		return res.status(400).json({ error: "Cart is empty" });
	}

	// Debug each cart item and lookup
	for (const item of cartItems) {
		console.log(`🔍 Checking item:`, item);
		console.log(`🔍 PRICE_LOOKUP['${item.id}'] =`, PRICE_LOOKUP[item.id]);
	}

	try {
		// 1. check inventory (but don't decrement yet)
		const inv = loadInv();
		for (const { id, quantity } of cartItems) {
			if ((inv[id] ?? 0) < quantity) {
				const remaining = inv[id] ?? 0;
				const err = new Error(`Only ${remaining} left of ${id}`);
				err.name = "InventoryError";
				err.itemId = id;
				err.remaining = remaining;
				throw err;
			}
		}

		// 2. generate an internal orderId
		const orderId = "ord_" + crypto.randomUUID();

		// 3. compact reserved payload (id + quantity only) for metadata
		const reserved = cartItems.map(({ id, quantity }) => ({
			id,
			quantity,
		}));

		const summary = reserved
			.map((i) => `${i.id}x${i.quantity || 1}`)
			.join(",");

		// 4. build Stripe line_items (no glyph data here)
		const line_items = cartItems.map(({ id, quantity }) => ({
			price: PRICE_LOOKUP[id],
			quantity,
		}));

		// 5. persist pending order (includes glyphData) separate from orders.json
		recordPendingOrder({
			id: orderId,
			status: "pending",
			createdAt: new Date().toISOString(),
			cartItems,
			reserved,
		});
		logEvent("order_pending_saved", {
			orderId,
			cartItemsCount: cartItems.length,
		});

		const session = await stripe.checkout.sessions.create({
			ui_mode: "custom",
			billing_address_collection: "auto",
			shipping_address_collection: {
				allowed_countries: ['US', 'CA', 'MX', 'GB', 'DE', 'FR', 'AU'],
			},
			line_items,
			mode: "payment",
			return_url: `${YOUR_DOMAIN}/stripe/return.html?session_id={CHECKOUT_SESSION_ID}`,
			automatic_tax: { enabled: true },

			// metadata stays small: reserved summary + orderId only
			metadata: {
				orderId,
				reserved: JSON.stringify(reserved), // safe length; no glyphs
				items: summary, // optional human-readable summary
			},
		});

		logEvent("checkout_session_created", {
			session_id: session.id,
			amount_total: session.amount_total,
			currency: session.currency,
			line_items: reserved,
			orderId,
		});

		res.send({ clientSecret: session.client_secret });
	} catch (err) {
		console.error("🔥 Checkout session error:", err);

		logEvent("checkout_session_error", {
			message: err.message,
			name: err.name,
			stack: err.stack,
		});

		if (err.name === "InventoryError") {
			return res.status(400).json({
				error: "InventoryError",
				message: err.message,
				itemId: err.itemId,
				remaining: err.remaining,
			});
		}

		res.status(400).json({ error: err.message });
	}
});

// ---------- Session status + activation codes ----------

app.get("/session-status", async (req, res) => {
	const session = await stripe.checkout.sessions.retrieve(req.query.session_id, {
		expand: ["line_items"],
	});

	let activation_codes = [];

	if (session.status === "complete") {
		const activationItem = session.line_items.data.find(
			(item) => item.price.id === PRICE_LOOKUP["smb1_activation"]
		);
		const quantity = activationItem ? activationItem.quantity : 0;

		if (quantity > 0) {
			const activatedFile = path.join(__dirname, "activation_codes.json");
			let activated = [];
			if (fs.existsSync(activatedFile)) {
				const data = fs.readFileSync(activatedFile);
				activated = JSON.parse(data);
			}

			let existing = activated.find((entry) => entry.session_id === session.id);
			if (existing) {
				activation_codes = existing.activation_codes;
			} else {
				for (let i = 0; i < quantity; i++) {
					activation_codes.push(generateActivationCode());
				}

				activated.push({
					session_id: session.id,
					customer_email: session.customer_details?.email || "",
					activation_codes,
					activated_at: new Date().toISOString(),
				});

				fs.writeFileSync(activatedFile, JSON.stringify(activated, null, 2));
				console.log(
					`✅ Generated ${quantity} activation codes for session ${session.id}`
				);

				logEvent("activation_codes_generated", {
					session_id: session.id,
					customer_email: session.customer_details?.email || "",
					quantity,
				});

				// Kick off Worker sync, but don't block the HTTP response
				pushCodesToWorkerKV(activation_codes).catch((err) => {
					console.error("❌ Failed to push codes to Worker KV:", err);
					logEvent("worker_kv_sync_error", {
						message: err.message,
					});
				});
			}
		}
	}

	res.send({
		status: session.status,
		customer_email: session.customer_details?.email || "",
		activation_codes,
	});
});
```