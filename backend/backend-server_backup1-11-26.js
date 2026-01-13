const VERSION = "2025.06.23";

const express = require("express");
const app = express();
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const nodemailer = require("nodemailer");
const ordersStore = require("./ordersStore");
const STRIPE_MODE = process.env.STRIPE_MODE || null;
const stripeSecretKey =
    STRIPE_MODE === "test"
        ? process.env.STRIPE_TEST_SECRET_KEY
        : process.env.STRIPE_SECRET_KEY;
const stripeWebhookSecret =
    STRIPE_MODE === "test"
        ? process.env.STRIPE_TEST_WEBHOOK_SECRET
        : process.env.STRIPE_WEBHOOK_SECRET;
const stripe = require("stripe")(stripeSecretKey, {
    apiVersion: "2025-04-30.basil",
});
const YOUR_DOMAIN = "https://shop.porchlogic.com";

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || null;
const EMAIL_USER = process.env.EMAIL_USER || null;
const EMAIL_PASS = process.env.EMAIL_PASS || null;
const EMAIL_TO = process.env.EMAIL_TO || EMAIL_USER || null;

const INV_PATH = path.join(__dirname, "inventory.json");
const LOG_PATH = path.join(__dirname, "events.log");
const SIGNUPS_PATH = path.join(__dirname, "signups.json");
const ALLOWED_ORDER_STATUSES = new Set([
    "paid",
    "produced",
    "packed",
    "shipped",
    "cancelled",
    "on_hold",
    "fulfilled",
    "deleted",
]);

function getOrderById(orderId) {
    return orderId ? ordersStore.getOrderById(orderId) : null;
}

// Called from webhook when checkout.session.completed fires
async function hydrateSessionShipping(session) {
    if (
        session.shipping_cost &&
        session.shipping_cost.shipping_rate &&
        typeof session.shipping_cost.shipping_rate === "object" &&
        (session.collected_information?.shipping_details || session.shipping_details)
    ) {
        return session;
    }

    try {
        return await stripe.checkout.sessions.retrieve(session.id, {
            expand: ["shipping_cost.shipping_rate", "collected_information.shipping_details"],
        });
    } catch (err) {
        console.warn("⚠️ Failed to hydrate session shipping:", err.message);
        return session;
    }
}

// Called from webhook when checkout.session.completed fires
async function updateOrderFromStripeSession(session) {
    const hydratedSession = await hydrateSessionShipping(session);
    const orderId = hydratedSession.metadata?.orderId || null;
    const reservedPayload = session.metadata?.reserved;
    let reservedItems = [];

    if (reservedPayload) {
        try {
            reservedItems = JSON.parse(reservedPayload);
        } catch (err) {
            console.warn("Failed to parse reserved metadata:", err);
        }
    }

    const pending = getOrderById(orderId);
    const pendingCart = Array.isArray(pending?.cartItems)
        ? pending.cartItems
        : [];

    // Prefer new collected_information.shipping_details, fall back to legacy shipping_details
    const shippingDetails =
        hydratedSession.collected_information?.shipping_details ||
        hydratedSession.shipping_details ||
        null;

    // Shipping method as chosen in Stripe Checkout
    let shippingMethod = null;
    const shippingCost =
        hydratedSession.shipping_cost || hydratedSession.total_details || null;

    if (shippingCost) {
        const rate = hydratedSession.shipping_cost?.shipping_rate;
        const rateId =
            typeof rate === "string" ? rate : rate?.id || null;

        let label =
            rate && typeof rate === "object"
                ? rate.display_name || rate.nickname || null
                : null;

        if (!label && rateId && Array.isArray(hydratedSession.shipping_options)) {
            const option = hydratedSession.shipping_options.find(
                (opt) =>
                    opt?.shipping_rate === rateId ||
                    (typeof opt?.shipping_rate_data === "object" &&
                        opt.shipping_rate_data?.display_name)
            );
            label =
                option?.shipping_rate_data?.display_name ||
                option?.shipping_rate_data?.nickname ||
                label;
        }

        shippingMethod = {
            id: rateId,
            label,
            amount: Number.isFinite(hydratedSession.shipping_cost?.amount_total)
                ? hydratedSession.shipping_cost.amount_total
                : Number.isFinite(hydratedSession.total_details?.amount_shipping)
                    ? hydratedSession.total_details.amount_shipping
                    : null,
        };
    }

    const shippingCombined =
        shippingDetails || shippingMethod
            ? {
                // e.g. { address: {...}, name: "..." }
                ...(shippingDetails || {}),
                method: shippingMethod,
            }
            : null;

    const base = {
        id: orderId || session.id,
        status: "paid",
        createdAt: pending?.createdAt || new Date().toISOString(),
        cartItems: pendingCart.length ? pendingCart : reservedItems,
        reserved: pending?.reserved?.length ? pending.reserved : reservedItems,
        stripeSessionId: hydratedSession.id || session.id,
        stripePaymentIntentId:
            hydratedSession.payment_intent || session.payment_intent || null,
        email:
            hydratedSession.customer_details?.email ||
            session.customer_details?.email ||
            null,
        shipping: shippingCombined,
        totalAmount: hydratedSession.amount_total ?? session.amount_total,
        currency: hydratedSession.currency || session.currency,
        rawStripeSession: hydratedSession, // keep for debugging/audit
    };

    console.log("✅ Saving order from Stripe session:", {
        orderId: base.id,
        shipping: base.shipping,
        totalAmount: base.totalAmount,
    });

    return ordersStore.saveOrder(base);
}



// ---------- Logging + Admin auth ----------

function logEvent(type, details = {}) {
    const entry = {
        ts: new Date().toISOString(),
        type,
        ...details,
    };

    try {
        fs.appendFileSync(LOG_PATH, JSON.stringify(entry) + "\n");
    } catch (err) {
        console.error("Failed to write log entry", err);
    }
}

function requireAdmin(req, res, next) {
    const token = req.header("x-admin-token") || req.query.token;

    if (!ADMIN_TOKEN) {
        console.warn("⚠️ ADMIN_TOKEN is not set – blocking admin access.");
        return res.status(500).json({ error: "Admin not configured" });
    }

    if (token !== ADMIN_TOKEN) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    next();
}

// ---------- Order email notifications ----------

function formatMoney(amount, currency) {
    if (!Number.isFinite(amount)) {
        return "n/a";
    }
    const upper = currency ? String(currency).toUpperCase() : "";
    return `${(amount / 100).toFixed(2)} ${upper}`.trim();
}

function formatShipping(shipping) {
    if (!shipping) {
        return "(none)";
    }

    const lines = [];
    if (shipping.name) {
        lines.push(shipping.name);
    }

    const addr = shipping.address || {};
    const line1 = addr.line1 || "";
    const line2 = addr.line2 || "";
    const city = addr.city || "";
    const state = addr.state || "";
    const postal = addr.postal_code || "";
    const country = addr.country || "";
    const cityLine = [city, state, postal].filter(Boolean).join(", ");

    if (line1) lines.push(line1);
    if (line2) lines.push(line2);
    if (cityLine) lines.push(cityLine);
    if (country) lines.push(country);

    if (shipping.method?.label) {
        const methodAmount = formatMoney(shipping.method.amount, "usd");
        lines.push(`Shipping method: ${shipping.method.label} (${methodAmount})`);
    }

    return lines.length ? lines.join("\n") : "(none)";
}

async function sendNewOrderEmail(order, session) {
    if (!EMAIL_USER || !EMAIL_PASS || !EMAIL_TO) {
        logEvent("order_email_skipped", {
            orderId: order?.id || null,
            reason: "missing_email_config",
        });
        return;
    }

    const transporter = nodemailer.createTransport({
        host: "smtp.gmail.com",
        port: 465,
        secure: true,
        auth: {
            user: EMAIL_USER,
            pass: EMAIL_PASS,
        },
    });

    const items = Array.isArray(order?.cartItems)
        ? order.cartItems
            .map((item) => `${item.id} x${item.quantity || 1}`)
            .join(", ")
        : "";

    const customerEmail =
        order?.email || session?.customer_details?.email || "";

    const text = [
        `Order ID: ${order?.id || "(missing)"}`,
        `Customer email: ${customerEmail || "(missing)"}`,
        `Items: ${items || "(none)"}`,
        `Total: ${formatMoney(order?.totalAmount, order?.currency)}`,
        "Shipping:",
        formatShipping(order?.shipping),
    ].join("\n");

    await transporter.sendMail({
        from: `Porch Logic <${EMAIL_USER}>`,
        to: EMAIL_TO,
        subject: `New order paid: ${order?.id || "unknown"}`,
        text,
    });

    logEvent("order_email_sent", {
        orderId: order?.id || null,
        to: EMAIL_TO,
    });
}

// ---------- Stripe webhook (raw body) ----------
// IMPORTANT: This must come BEFORE express.json()

app.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {
    let event;

    try {
        event = stripe.webhooks.constructEvent(
            req.body,
            req.headers["stripe-signature"],
            stripeWebhookSecret
        );
    } catch (err) {
        console.error("Webhook err", err.message);
        return res.sendStatus(400);
    }

    logEvent("stripe_webhook_received", {
        type: event.type,
        id: event.id,
    });

    if (event.type === "checkout.session.completed") {
        const session = event.data.object;
        const { metadata } = session;

        // 1) Update order record based on orderId in metadata
        try {
            const savedOrder = await updateOrderFromStripeSession(session);
            logEvent("order_marked_paid", {
                orderId: metadata?.orderId || null,
                session_id: session.id,
                customer_email: session.customer_details?.email || "",
            });
            try {
                await sendNewOrderEmail(savedOrder, session);
            } catch (err) {
                console.error("Failed to send order email:", err);
                logEvent("order_email_error", {
                    orderId: savedOrder?.id || metadata?.orderId || null,
                    session_id: session.id,
                    message: err.message,
                });
            }
        } catch (err) {
            console.error("Failed to update order from session:", err);
            logEvent("order_update_error", {
                session_id: session.id,
                message: err.message,
            });
        }

        // 2) Inventory: use compact reserved payload (id + quantity only)
        if (metadata?.reserved) {
            try {
                const inv = loadInv();
                JSON.parse(metadata.reserved).forEach(({ id, quantity }) => {
                    inv[id] = (inv[id] ?? 0) - quantity;
                });
                saveInv(inv);
            } catch (err) {
                console.error("Failed to apply reserved inventory:", err);
                logEvent("inventory_apply_error", {
                    message: err.message,
                    metadataReserved: metadata.reserved,
                });
            }
        }

        // 3) Newsletter signup?
        const orderId = metadata?.orderId || null;
        const orderForNewsletter = orderId ? getOrderById(orderId) : null;

        if (orderForNewsletter?.newsletterSubscribed) {
            const email = session.customer_details?.email || null;

            if (!email) {
                logEvent("newsletter_checkout_opt_in_error", {
                    orderId,
                    session_id: session.id,
                    message: "Missing email on session",
                });
            } else {
                try {
                    const { added } = saveNewsletterEmail(email);
                    logEvent(
                        added
                            ? "newsletter_checkout_opt_in"
                            : "newsletter_checkout_opt_in_duplicate",
                        {
                            orderId,
                            session_id: session.id,
                            email,
                        }
                    );
                } catch (err) {
                    console.error(
                        "Failed to save newsletter opt-in from checkout webhook:",
                        err
                    );
                    logEvent("newsletter_checkout_opt_in_error", {
                        orderId,
                        session_id: session.id,
                        email,
                        message: err.message,
                    });
                }
            }
        } else {
            logEvent("newsletter_checkout_opt_in_skipped", {
                orderId,
                session_id: session.id,
                reason: orderForNewsletter ? "not_opted_in" : "order_missing",
            });
        }

        logEvent("checkout_session_completed", {
            session_id: session.id,
            customer_email: session.customer_details?.email || "",
            metadata: session.metadata || {},
        });
    }

    // If you later want to undo holds on expired/canceled sessions, re-enable this:
    // if (
    // 	event.type === "checkout.session.expired" ||
    // 	event.type === "payment_intent.canceled"
    // ) {
    // 	const { metadata } = event.data.object;
    // 	if (metadata?.reserved) {
    // 		const inv = loadInv();
    // 		JSON.parse(metadata.reserved).forEach(({ id, quantity }) => {
    // 			inv[id] = (inv[id] || 0) + quantity;
    // 		});
    // 		saveInv(inv);
    // 	}
    // }

    res.json({ received: true });
});

// ---------- Normal middlewares ----------

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// ---------- Basic health check ----------

app.get("/ping", (req, res) => {
    res.send("pong");
});

// ---------- Inventory helpers ----------

function loadInv() {
    return JSON.parse(fs.readFileSync(INV_PATH));
}

function saveInv(inv) {
    fs.writeFileSync(INV_PATH, JSON.stringify(inv, null, 2));
}

/**
 * Reserve items – throws if any qty unavailable.
 * Returns the map of { id: qty } actually reserved so we can
 * roll it back later if checkout fails.
 */
function reserve(inv, cart) {
    for (const { id, quantity } of cart) {
        if ((inv[id] ?? 0) < quantity) {
            const remaining = inv[id] ?? 0;
            const err = new Error(`Only ${remaining} left of ${id}`);
            err.name = "InventoryError";
            err.itemId = id;
            err.remaining = remaining;
            throw err;
        }
    }
    // All good – decrement
    cart.forEach(({ id, quantity }) => (inv[id] -= quantity));
}

// ---------- Newsletter helpers ----------

function readNewsletterSignups() {
    if (!fs.existsSync(SIGNUPS_PATH)) {
        return [];
    }

    try {
        const data = fs.readFileSync(SIGNUPS_PATH);
        const emails = JSON.parse(data);
        return Array.isArray(emails) ? emails : [];
    } catch (err) {
        console.error("Failed to read signups.json:", err);
        return [];
    }
}

function saveNewsletterEmail(email) {
    if (!email || typeof email !== "string" || !email.includes("@")) {
        const err = new Error("Invalid email");
        err.code = "invalid_email";
        throw err;
    }

    const currentSignups = readNewsletterSignups();

    if (currentSignups.includes(email)) {
        return { added: false };
    }

    const updated = [...currentSignups, email];

    try {
        fs.writeFileSync(SIGNUPS_PATH, JSON.stringify(updated, null, 2));
        return { added: true };
    } catch (err) {
        err.code = err.code || "newsletter_write_failed";
        throw err;
    }
}

// ---------- Price lookup ----------

// test mode:
// const PRICE_LOOKUP = {
// 	smb1_default: "price_1RP7gdABTHjSuIhXXZfq0oyv",
// 	smb1_host: "price_1RddCnABTHjSuIhXSpr276RI",
// 	smb1_activation: "price_1RWJTEABTHjSuIhXyEJGdbaO",
// };

const PRICE_LOOKUP = {
    smb1_default: "price_1RddA2ABTHjSuIhXaL0YkdVs",
    smb1_host: "price_1RddCnABTHjSuIhXSpr276RI",
    smb1_activation: "price_1RbM7eABTHjSuIhX0FsjSFVl",
    test_product: "price_1SaeEXPADwDYgfnvGIcH9C30",
    m8_plate_1: "price_1SVwbWABTHjSuIhXrqbogAH3",
    m8_keycap_smoke: "price_1Sg3UEABTHjSuIhXhgK5hV9U",
    m8_keycap_clear: "price_1Sg3zWABTHjSuIhX0PjRd9YX",
    m8_backpack_1: "price_1SoQmqABTHjSuIhX705tECHZ"
};
const TEST_MODE_PRICE_ID = PRICE_LOOKUP["test_product"];

function resolvePriceId(itemId) {
    if (STRIPE_MODE === "test") {
        if (!TEST_MODE_PRICE_ID) {
            throw new Error("Test mode price not configured");
        }
        return TEST_MODE_PRICE_ID;
    }
    return PRICE_LOOKUP[itemId];
}

// ---------- CHECKOUT ----------

app.post("/create-checkout-session", async (req, res) => {
    console.log("🔥 /create-checkout-session hit");
    console.log("🔥 Raw body from client:", JSON.stringify(req.body, null, 2));

    const { cartItems } = req.body;

    if (!Array.isArray(cartItems) || cartItems.length === 0) {
        return res.status(400).json({ error: "Cart is empty" });
    }

    // Debug each cart item and lookup
    for (const item of cartItems) {
        console.log(`🔍 Checking item:`, item);
        console.log(`🔍 price for '${item.id}' =`, resolvePriceId(item.id));
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

        // 2. generate an internal orderId (serial)
        const orderId = ordersStore.generateOrderId();
        const createdAt = new Date().toISOString();

        // 3. compact reserved payload (id + quantity only) for metadata
        const reserved = cartItems.map(({ id, quantity }) => ({
            id,
            quantity,
        }));

        const summary = reserved
            .map((i) => `${i.id}x${i.quantity || 1}`)
            .join(",");

        // 4. build Stripe line_items (no glyph data here)
        const line_items = cartItems.map(({ id, quantity }) => {
            const price = resolvePriceId(id);
            if (!price) {
                throw new Error(`No Stripe price configured for item '${id}'`);
            }
            return { price, quantity };
        });

        // 5. Create Checkout Session with shipping options owned by Stripe
        const session = await stripe.checkout.sessions.create({
            ui_mode: "embedded", // ⬅ change this from "custom"

            allow_promotion_codes: true,

            permissions: {
                update_shipping_details: "server_only", // ⬅ required for dynamic shipping
            },

            billing_address_collection: "auto",
            shipping_address_collection: {
                allowed_countries: ["US", "CA", "MX", "GB", "DE", "FR", "AU"],
            },

            // Initial dummy shipping; you'll overwrite this later
            shipping_options: [
                {
                    shipping_rate_data: {
                        display_name: "Calculating shipping…",
                        type: "fixed_amount",
                        fixed_amount: { amount: 0, currency: "usd" },
                    },
                },
            ],

            line_items,
            mode: "payment",
            return_url: `${YOUR_DOMAIN}/stripe/return.html?session_id={CHECKOUT_SESSION_ID}`,
            automatic_tax: { enabled: true },

            metadata: {
                orderId,
                reserved: JSON.stringify(reserved),
                items: summary,
                subscribe: req.body.subscribeToNewsletter ? "yes" : "no"
            },

            // consent_collection: {
            // 	promotions: 'auto',
            // },
        });


        // 6. Save pending order (no shipping method yet – it's chosen in Checkout)
        try {
            ordersStore.saveOrder({
                id: orderId,
                status: "pending",
                createdAt,
                cartItems,
                reserved,
                stripeSessionId: session.id,
                shipping: null,
            });
            logEvent("order_pending_created", {
                orderId,
                cartItemsCount: cartItems.length,
            });
        } catch (err) {
            console.error("Failed to persist pending order:", err);
            logEvent("order_pending_save_error", {
                orderId,
                message: err.message,
            });
            return res.status(500).json({ error: "Failed to save order" });
        }

        logEvent("checkout_session_created", {
            session_id: session.id,
            amount_total: session.amount_total,
            currency: session.currency,
            line_items: reserved,
            orderId,
        });

        // res.send({ clientSecret: session.client_secret });
        res.send({
            clientSecret: session.client_secret,
            sessionId: session.id
        });

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

app.post("/calculate-shipping-options", async (req, res) => {
    try {
        const { checkout_session_id, shipping_details } = req.body;

        // 1. Retrieve the Checkout Session (you can also inspect line_items here if needed)
        const session = await stripe.checkout.sessions.retrieve(checkout_session_id);

        // 2. Validate address if you want custom rules
        // Example: block unsupported countries or PO boxes
        // const country = shipping_details?.address?.country;

        const address = shipping_details?.address || {};
        const country = address.country;
        const state = (address.state || "").toUpperCase();
        const city = (address.city || "").trim().toLowerCase();

        if (!country) {
            return res.json({
                type: "error",
                message: "Please enter a valid shipping address.",
            });
        }

        const isPortlandOR =
            country === "US" &&
            state === "OR" &&
            city === "portland";

        // 3. Build shipping options dynamically
        let shippingOptions = [];

        if (isPortlandOR) {
            shippingOptions = [
                {
                    shipping_rate_data: {
                        display_name: "Free Hand-Delivery in Portland",
                        type: "fixed_amount",
                        fixed_amount: { amount: 0, currency: "usd" },
                    },
                },
                {
                    shipping_rate_data: {
                        display_name: "US Economy (3–7 days)",
                        type: "fixed_amount",
                        fixed_amount: { amount: 600, currency: "usd" },
                    },
                },
                {
                    shipping_rate_data: {
                        display_name: "US Priority (2–3 days)",
                        type: "fixed_amount",
                        fixed_amount: { amount: 1000, currency: "usd" },
                    },
                },
            ];
        } else if (country === "US") {
            shippingOptions = [
                {
                    shipping_rate_data: {
                        display_name: "US Economy (3–7 days)",
                        type: "fixed_amount",
                        fixed_amount: { amount: 600, currency: "usd" },
                    },
                },
                {
                    shipping_rate_data: {
                        display_name: "US Priority (2–3 days)",
                        type: "fixed_amount",
                        fixed_amount: { amount: 1000, currency: "usd" },
                    },
                },
            ];
        } else {
            shippingOptions = [
                {
                    shipping_rate_data: {
                        display_name: "International Economy (2–4 weeks)",
                        type: "fixed_amount",
                        fixed_amount: { amount: 2000, currency: "usd" },
                    },
                },
            ];
        }

        // 4. Update the session with the *real* shipping details + options
        await stripe.checkout.sessions.update(checkout_session_id, {
            collected_information: { shipping_details },
            shipping_options: shippingOptions,
        });

        return res.json({ type: "object", value: { succeeded: true } });
    } catch (err) {
        console.error("calculate-shipping-options error:", err);
        return res.json({
            type: "error",
            message: "We can't find shipping options. Please try again.",
        });
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

// ---------- Newsletter ----------

app.post("/newsletter-signup", (req, res) => {
    const { email } = req.body;

    try {
        const { added } = saveNewsletterEmail(email);

        if (!added) {
            return res.status(200).json({ message: "Already signed up!" });
        }

        logEvent("newsletter_signup", { email });

        res.status(200).json({ message: "Thanks for signing up!" });
    } catch (err) {
        if (err.code === "invalid_email") {
            return res.status(400).json({ error: "Invalid email" });
        }

        console.error("Error writing to signups.json:", err);
        logEvent("newsletter_signup_error", {
            email,
            message: err.message,
        });
        res.status(500).json({ error: "Failed to save email" });
    }
});
app.post("/newsletter-checkout-opt-in", async (req, res) => {
    const { session_id, subscribe } = req.body;

    if (!session_id || typeof subscribe !== "boolean") {
        return res.status(400).json({ error: "Invalid payload" });
    }

    try {
        const session = await stripe.checkout.sessions.retrieve(session_id);
        const orderId = session.metadata?.orderId || null;

        if (!orderId) {
            logEvent("newsletter_checkout_opt_in_skipped", {
                session_id,
                reason: "missing_order_id",
            });
            return res.status(404).json({ error: "Order not found for session" });
        }

        const existingOrder = getOrderById(orderId);

        if (!existingOrder) {
            logEvent("newsletter_checkout_opt_in_skipped", {
                session_id,
                orderId,
                reason: "order_missing",
            });
            return res.status(404).json({ error: "Order not found" });
        }

        const updated = ordersStore.saveOrder({
            ...existingOrder,
            newsletterSubscribed: subscribe,
        });

        logEvent(
            subscribe ? "newsletter_checkout_opt_in" : "newsletter_checkout_opt_out",
            {
                session_id,
                orderId,
                email: session.customer_details?.email || "",
            }
        );

        res.json({ subscribed: updated.newsletterSubscribed });
    } catch (err) {
        console.error("Failed to update newsletter flag from checkout:", err);
        logEvent("newsletter_checkout_opt_in_error", {
            session_id,
            message: err.message,
        });
        res.status(500).json({ error: "Failed to update order" });
    }
});


// ---------- Admin API ----------

app.get("/admin/status", requireAdmin, (req, res) => {
    res.json({
        version: VERSION,
        uptimeSeconds: process.uptime(),
        nodeVersion: process.version,
        env: process.env.NODE_ENV || "development",
    });
});

app.get("/admin/inventory", requireAdmin, (req, res) => {
    try {
        const inv = loadInv();
        res.json(inv);
    } catch (err) {
        console.error("Failed to load inventory in /admin/inventory", err);
        res.status(500).json({ error: "Failed to load inventory" });
    }
});

app.get("/admin/newsletter", requireAdmin, (req, res) => {
    if (!fs.existsSync(SIGNUPS_PATH)) {
        return res.json({ count: 0, emails: [] });
    }
    try {
        const data = fs.readFileSync(SIGNUPS_PATH);
        const emails = JSON.parse(data);
        res.json({ count: emails.length, emails });
    } catch (err) {
        console.error("Failed to read signups.json", err);
        res.status(500).json({ error: "Failed to read signups" });
    }
});

app.get("/admin/activation-codes", requireAdmin, (req, res) => {
    const activatedFile = path.join(__dirname, "activation_codes.json");
    if (!fs.existsSync(activatedFile)) {
        return res.json({ sessions: [], totalCodes: 0 });
    }
    try {
        const data = fs.readFileSync(activatedFile);
        const sessions = JSON.parse(data);
        const totalCodes = sessions.reduce(
            (sum, entry) => sum + (entry.activation_codes?.length || 0),
            0
        );
        res.json({ sessions, totalCodes });
    } catch (err) {
        console.error("Failed to read activation_codes.json", err);
        res.status(500).json({ error: "Failed to read activation codes" });
    }
});

// Orders overview
app.get("/admin/orders", requireAdmin, (req, res) => {
    try {
        const orders = ordersStore.getOrders();
        res.json(orders);
    } catch (err) {
        console.error("Failed to load orders from database in /admin/orders:", err);
        res.status(500).json({ error: "Failed to load orders" });
    }
});

// Mark order fulfilled
app.post("/admin/orders/:id/fulfill", requireAdmin, (req, res) => {
    const orderId = req.params.id;
    const adminUser = req.header("x-admin-token") ? "admin" : "unknown";

    try {
        const order = ordersStore.markFulfilled(orderId, adminUser);
        if (!order) {
            return res.status(404).json({ error: "Order not found" });
        }

        logEvent("order_marked_fulfilled", {
            orderId,
            fulfilledAt: order.fulfilledAt,
            adminUser,
        });

        res.json({ ok: true, order });
    } catch (err) {
        console.error("Failed to fulfill order:", err);
        res.status(500).json({ error: "Failed to fulfill order" });
    }
});

// Update order status
app.post("/admin/orders/:id/status", requireAdmin, (req, res) => {
    const orderId = req.params.id;
    const requestedStatus =
        typeof req.body.status === "string"
            ? req.body.status.trim().toLowerCase()
            : "";
    const adminUser = req.header("x-admin-token") ? "admin" : "unknown";

    if (!ALLOWED_ORDER_STATUSES.has(requestedStatus)) {
        return res.status(400).json({ error: "Invalid status" });
    }

    try {
        const order = ordersStore.updateStatus(orderId, requestedStatus);
        if (!order) {
            return res.status(404).json({ error: "Order not found" });
        }

        logEvent("order_status_updated", {
            orderId,
            status: requestedStatus,
            adminUser,
        });

        res.json({ ok: true, order });
    } catch (err) {
        console.error("Failed to update order status:", err);
        res.status(500).json({ error: "Failed to update order status" });
    }
});

// Delete order (soft delete, move to deleted store)
app.post("/admin/orders/:id/delete", requireAdmin, (req, res) => {
    const orderId = req.params.id;
    return deleteOrder(orderId, req, res);
});

// Body-based delete endpoint for clients that post JSON { orderId }
app.post("/admin/orders/delete", requireAdmin, (req, res) => {
    const orderId = req.body.orderId;
    if (!orderId) {
        return res.status(400).json({ error: "orderId is required" });
    }
    return deleteOrder(orderId, req, res);
});

function deleteOrder(orderId, req, res) {
    const adminUser = req.header("x-admin-token") ? "admin" : "unknown";

    try {
        const order = ordersStore.markDeleted(orderId, adminUser);
        if (!order) {
            return res.status(404).json({ error: "Order not found" });
        }

        logEvent("order_deleted", {
            orderId,
            deletedAt: order.deletedAt,
            adminUser,
        });

        res.json({ ok: true, order });
    } catch (err) {
        console.error("Failed to delete order:", err);
        res.status(500).json({ error: "Failed to delete order" });
    }
}


app.get("/admin/logs", requireAdmin, (req, res) => {
    const limit = parseInt(req.query.limit || "200", 10);

    if (!fs.existsSync(LOG_PATH)) {
        return res.json({ entries: [] });
    }

    try {
        const raw = fs.readFileSync(LOG_PATH, "utf8");
        const lines = raw.trim().split("\n").filter(Boolean);
        const slice = lines.slice(-limit);
        const entries = slice.map((line) => {
            try {
                return JSON.parse(line);
            } catch (err) {
                return { ts: null, type: "parse_error", raw: line };
            }
        });
        res.json({ entries });
    } catch (err) {
        console.error("Failed to read events log", err);
        res.status(500).json({ error: "Failed to read logs" });
    }
});

// ---------- Startup ----------

console.log(`Porch Logic API Server ${VERSION} is now running on port 4242`);

app.listen(4242, "0.0.0.0", () => console.log("Running on port 4242"));

// ---------- Helpers ----------

function generateActivationCode() {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let code = "";
    for (let i = 0; i < 8; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

async function pushCodesToWorkerKV(activation_codes) {
    const WORKER_KV_URL =
        "https://smb1-update.porchlogic.com/update-activation-codes";
    const WORKER_API_KEY = "d4ah1H8Mf82rEsLIkKiip55h"; // Same as Worker expects!

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
        const response = await fetch(WORKER_KV_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${WORKER_API_KEY}`,
            },
            body: JSON.stringify({ activation_codes }),
            signal: controller.signal,
        });

        clearTimeout(timeout);

        if (response.ok) {
            console.log(
                "✅ Successfully updated Worker KV with new activation codes."
            );
            logEvent("worker_kv_sync_ok", {
                count: activation_codes.length,
            });
        } else {
            const text = await response.text();
            console.error(
                `❌ Failed to update Worker KV: ${response.status} ${text}`
            );
            logEvent("worker_kv_sync_failed", {
                status: response.status,
                body: text,
            });
        }
    } catch (err) {
        clearTimeout(timeout);
        console.error("❌ Error pushing codes to Worker KV:", err);
        logEvent("worker_kv_sync_error", {
            message: err.message,
        });
    }
}
