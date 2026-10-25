# Shopping and responsive updates — 16 October 2026

Add-to-bag now checks the actual customer session before changing the browser bag. Guests and expired sessions go to the customer/store sign-in screen. The selected product and quantity are held temporarily, fetched again after sign-in, and added once on return. Login and registration preserve the shopping destination; redirects are restricted to internal shopping routes. Server-side checkout authentication remains in place.

The header search button now opens a keyboard-accessible search dialog on every screen size. Submitting it opens real catalog results, with the query preserved in the URL and result counts displayed. The catalog also has a working search submit button. Repeated searches on the shop page update the results.

Routes reset to the top on navigation, including query changes and browser history navigation. Intentional anchor links still reach their section. Catalog pagination also resets to the top.

Responsive styling now covers navigation, header search, homepage hero and aisles, catalog filters and cards, product details, bag, checkout, account forms, footer and information pages. Product grids adjust to one, two, three or four columns based on available space. Tablet and iPad navigation uses a dismissible menu. The homepage hero has a local product-photo fallback while any configured image loads.

Validation evidence:

- TypeScript/Vite production build.
- Navigation security and pending-bag validation tests, plus the existing pricing/VAT tests.
- Chrome checks at 320, 360, 390, 430, 600, 768, 820, 1024, 1180 and 1440px across home, shop, product, bag, authenticated checkout and contact pages.
- Login and guest checkout also checked at phone and tablet sizes.
- End-to-end guest redirect, real sign-in, single pending addition, signed-in additions, revoked-session rejection, all three search flows, menu behavior, route scrolling, pagination, product image zoom and Escape dismissal.

`verification.json` is the browser result. Screenshots use page names and viewport widths. The test's temporary customer and sessions are removed in cleanup; no orders are created. Run after building: `$env:NODE_ENV='production'; node scripts/verify-storefront-redesign.js`.
