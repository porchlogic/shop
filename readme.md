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
