# porchLogic shop

## Stripe test mode and product testing

### How Stripe mode is selected
- Backend: `backend/backend-server_backup1-11-26.js` reads `STRIPE_MODE`.
  - `STRIPE_MODE=test` uses `STRIPE_TEST_SECRET_KEY` + `STRIPE_TEST_WEBHOOK_SECRET`.
  - Otherwise it uses the live keys.
  - In test mode, `resolvePriceId()` returns `PRICE_LOOKUP.test_product` for every item, so you do not need test price IDs per product.
  - In live mode, `resolvePriceId()` uses `PRICE_LOOKUP[item.id]`.
- Frontend checkout: `checkout/checkout.js` picks a publishable key based on `sessionStorage.porchlogic_checkout_test_mode`.
  - When enabled, the “Test mode – payments are simulated” banner appears.
  - The keyboard toggle is disabled; use devtools to set the flag.

### Simple procedure to test a new product while the live site stays live
1. Run a local or staging backend in test mode.
   - `STRIPE_MODE=test`
   - `STRIPE_TEST_SECRET_KEY=...`
   - `STRIPE_TEST_WEBHOOK_SECRET=...`
   - Start the server (default dev port is `4242`).
2. Point checkout at the local/staging API.
   - In `checkout/checkout.js`, set `THIS_API_BASE` to your local URL (ex: `http://localhost:4242`) and reload.
3. Enable checkout test mode in the browser.
   - Open devtools and run:
     ```js
     sessionStorage.setItem("porchlogic_checkout_test_mode", "1");
     location.reload();
     ```
4. Add the new product to cart and complete checkout.
   - Use Stripe test card `4242 4242 4242 4242` with any future expiry/CVC.
   - Verify the order and inventory behavior in server logs or stored orders.
5. Ship live when ready.
   - Add the new live price ID to `PRICE_LOOKUP` for the product ID.
   - Deploy backend with `STRIPE_MODE` unset so it uses live keys.
