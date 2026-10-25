# Storefront redesign — 16 October 2026

The homepage aisle section now uses real catalog products in two visual category cards. American and Global counts and all eight subcategory destinations come from the live catalog. Images load independently of the category links.

Product pages now feature a full-packaging photo stage with an accessible native-dialog zoom viewer, flavour/size/case facts, a focused purchase panel, both VAT price presentations, live quantity totals, expandable product information and related products from the same category. The source-spreadsheet implementation notes were removed from the shopping flow. Product data and the existing shared pricing calculations are preserved.

Implementation: `src/AisleSection.tsx`, `src/ProductDetailContent.tsx`, `src/storefront-redesign.css`, with integration in `src/App.tsx` and `src/main.tsx`.

Validation:

- Production TypeScript/Vite build passed.
- All 10 existing VAT/pricing tests passed.
- Chrome checked desktop 1440px, tablet 768px, and phone 390px/320px layouts. No horizontal overflow or browser errors.
- Verified quantity updates and totals, add-to-bag persistence, image zoom and Escape dismissal, expandable information, tax display preference, and related-product navigation.
- `verification.json` contains the browser results. `aisles-*.png` and `product-*.png` contain captured screenshots at each viewport.

Re-run browser checks after building with: `$env:NODE_ENV='production'; node scripts/verify-storefront-redesign.js`. The current script also verifies sign-in gates, search, route scrolling and responsive shopping flows; its latest evidence is in `reports/responsive/`. It uses a separate headless Chrome profile and a temporary application server, creates a disposable test customer to exercise real sign-in, and removes that customer and its sessions in cleanup. It creates no orders.
