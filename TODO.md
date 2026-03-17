## ToDo


## Done
- [x] add a new custom glyph section for M8-Backpack (different from our other custom glyph editor)
  - [x] a way to upload an image and resize/crop it to be within a 32x32 pixel square
  - [x] image is converted to black/white, with a threshold slider
  - Comment: added the upload/preview UI with drag-to-crop, scale, and threshold sliders in `m8-backpack/index.html`, and stored the resulting bitmap as `customGlyphImage` on cart items via `cart/cart.js`.
- [x] create a new product "M8-Kit" which is basically a package of both M8-Plate and M8-Backpack.
  - [x] the product page will need all the configurable options for both components
  - [x] the price should be $36 (there will be a separate stripe price id for it)
  - Comment: added the `m8-kit/index.html` bundle page with plate/backpack options, glyph + keycaps, and battery inquiry; listed it in `index.html`, supported kit metadata in `cart/cart.js`, and added a placeholder Stripe price id in `backend/backend-server_backup.js`.
- [x] read checkout/ as well as backend/backend-server_backup1-11-26.js,
  - [x] get an understanding of how we had stripe setup so that we can test new products while the site is still live,
  - [x] then document in readme.md a simple-as-possible procedure for testing a new product
  - Comment: documented Stripe test vs live flow and a concise test procedure in `readme.md` based on checkout and backend behavior.
