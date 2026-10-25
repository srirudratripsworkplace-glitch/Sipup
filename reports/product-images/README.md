# Product image replacement — 16 October 2026

All 162 products now have locally downloaded product photographs attached in MySQL. The 81 previous image associations were replaced; the 81 products without images now have photographs. All seven contact sheets were inspected for packaging, flavour and variant.

The owner approved using the same flavour's packaging when its size differs from the catalog. The owner also confirmed orange Samyang ramen for Original and black Buldak for Spicy. Catalog sizes, selling quantities, prices, VAT, stock, product identifiers and categories were preserved.

- `review.html`: visual gallery with supplier links and both catalog and source packaging sizes.
- `image-sources.csv`: per-product image provenance and size comparison.
- `originals/`: downloaded original image bytes, with corresponding source URL metadata.
- `downloaded.json`: final local asset URLs, content hashes and actual image dimensions.
- `visual-review.json`: fingerprint of the visually reviewed manifest.
- `application-result.json`: database replacement and before/after business-data integrity checks.
- `database-backup-2026-10-16T05-05-58-685Z.json`: previous image rows for recovery.
- `http-verification.json`: all 162 public primary images, detail galleries and served WebP files verified; zero missing images.

Final assets live in `public/products/web/` and are included in the production build. Empty image margins were trimmed without enlarging the source photographs. Product details, thumbnails, cart and admin images display the full packaging using `object-fit: contain`.

Validation: `npm.cmd run build` passed. `$env:NODE_ENV='production'; node scripts/verify-product-images.js` passed for all 162 products.

Source images represent the same product/flavour; recorded packaging sizes can differ. A supplier's title is not always the same as its URL slug; selections use the listing and inspected packaging, including legacy slugs. Two Trident listings state stick counts without a packaging weight; that limitation is recorded in the source-size column.
