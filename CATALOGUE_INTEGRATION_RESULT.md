# SipUp catalogue publication — 15 October 2026

All 162 imported products are now VAT-confirmed and published in local development
MySQL. The owner explicitly confirmed that Excel prices exclude VAT and that each
source row's VAT rate must be preserved. No second admin confirmation is needed.

| Verified result | Count |
| --- | ---: |
| Valid Excel products / public API products | 162 / 162 |
| Newly published existing products | 162 |
| Products deleted or recreated during confirmation | 0 |
| Standard-rated (20%) / zero-rated (0%) | 147 / 15 |
| Saved net price or VAT mismatches against Excel | 0 |
| Duplicate products / failed records | 0 / 0 |
| Confirmed catalogue images / without confirmed images | 81 / 81 |
| Products still holding 20 wholesale cases | 162 |
| Total available cases | 3,240 |

The original import created these 162 products. This update changes only VAT
confirmation, publication and price-entry provenance. It does not re-import,
recreate or reset products. Canonical prices remain net for reporting; the shared
integer-pence VAT engine adds VAT once. GBP 10 net becomes GBP 12 at 20% and GBP 10
at 0%. VAT-inclusive prices are visible on cards and details, including when the
existing ex-VAT presentation option is selected. Checkout calculates tax from
server-side net prices rather than trusting browser totals.

## Homepage and admin categories

Homepage category cards, navigation and category/subcategory filters use MySQL:

- American (136): Candy (68), Drinks (30), Monster (11), Gum (11), Snacks (16).
- Global (26): Drinks (19), Snacks (6), Candys (1).

Names follow the actual Excel source, including `Candys`. Empty legacy categories
remain intact in admin and are omitted from homepage/navigation. Category links
use unique slugs, so American Drinks and Global Drinks are separate selections.

`/admin/categories` supports creating and editing names, parent categories,
descriptions and display order. Cycles and duplicate sibling names are rejected;
identical child names under different parents are supported. Renaming/reparenting
preserves category IDs and URLs. Product editing retains category IDs. Admin
products explicitly display net price, imported VAT rate, calculated VAT and gross
price. The original import review notes remain informational after VAT confirmation.
Publication is also recorded in the existing import history/audit tables.

## Integrity and outstanding source issues

Before/after SHA-256 fingerprints match for orders, order items, tax snapshots,
payments, refunds, stock movements, product images, bulk prices and categories.
Product IDs, SKUs, slugs, net/sale prices, VAT treatments/rates, stock and category
assignments also match exactly. No schema migration was needed for this update.

81 products have no confirmed image, including 11 uncertain candidates. No guessed
flavour images were assigned. There are still 67 unresolved separate brand fields
and 16 informational unit-price discrepancies. The original case price is retained;
source unit price is informational and does not determine checkout charges.

The `import-data` workbook and ZIP are zero-byte placeholders. The validated source
was `server/catalogue-import/available-stock-list.xlsm`, identical to the original
workbook, and the previous image extraction used `D:/Sipup_Combined_Catalogue.zip`.
Workbook hash: `f3ac1925da789cfb239d7cf5da4ccb5ab125d94aabb23000fd4a4f3235592f47`.

## Validation and evidence

- `npm run test:integration`: 29 passed, zero failures/skips, isolated MySQL instance.
- `npm run build`: TypeScript and Vite production build passed.
- Actual configured database: every one of 162 saved prices and rates matches Excel.
- Public HTTP API: all 162 products fetched across four pages, no duplicate IDs;
  all parent/child counts match filtered API results; zero and 20% detail APIs pass.
- Existing running API at `http://127.0.0.1:3000/api/products` returns total 162.
- Started the local storefront at `http://127.0.0.1:5173`: homepage and transformed
  React module return HTTP 200; its API proxy returns all 162 products and both
  category groups. All 81 attached WebP URLs return HTTP 200 with image content.
- Isolated tests cover mixed-rate checkout, stock 20→17 after three cases, no double
  deduction, overselling prevention, historical tax snapshots, dry-run isolation,
  confirmation retries, source mismatch rejection and category cycle protection.
- Browser visual/responsive acceptance was not performed.

Current evidence: `reports/catalogue-import/vat-confirmation.json`,
`publication-integrity-before.json` and `publication-verification.json`.
Earlier `import-verification.json` and `api-verification.json` describe the historical
draft state before this confirmation, not current storefront visibility.

## Commands

```powershell
npm run dev
# Storefront: http://localhost:5173
# Admin: http://localhost:5173/admin/products
# Category management: http://localhost:5173/admin/categories

# Read-only source/database VAT validation (no product writes):
node scripts/confirm-catalogue.js

# Already executed with the owner's authorization; no need to run again:
# node scripts/confirm-catalogue.js --commit

npm run test:integration
npm run build
```

The normal importer still defaults to a preview and preserves existing SKUs,
identifiers and inventory on retry. It does not reset stock or undo publication.
No production deployment was performed.

## Files changed for this confirmation

- `server/index.js`: hierarchy counts, category editing/validation, publication
  history events and stable price sorting.
- `server/catalogue-import/confirm.js`: transactional source validation and audited
  publication with per-row rates and unchanged canonical prices/inventory.
- `scripts/confirm-catalogue.js`: preview/explicit commit command.
- `scripts/verify-catalogue-publication.js`: actual DB and HTTP verification.
- `src/App.tsx`, `src/index.css`: homepage hierarchy, navigation, subcategory filters,
  admin category editor and explicit rate column.
- `test/backend.test.js`: mixed-rate confirmation, retries, integrity and hierarchy tests.
- `README.md`, `CATALOGUE_IMPORT.md`, this report and generated verification evidence.
