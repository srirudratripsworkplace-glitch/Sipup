# SipUp catalogue extraction and dry-run preview

**Update:** all 162 products are now imported and published following explicit
owner confirmation of VAT-exclusive prices and the original per-row 20% / 0% rates. See [CATALOGUE_INTEGRATION_RESULT.md](CATALOGUE_INTEGRATION_RESULT.md)
for the actual database/API verification. The sections below describe the earlier
preview phase and its review findings.

No application database products, inventory, categories or migrations were changed.
The configured database still contains 22 products and 22 stock movements; their
combined before/after fingerprint is identical. Evidence is in
`reports/catalogue-import/database-verification.json`.

## Inputs used

The two requested files under `import-data/` are still zero bytes. They were not
overwritten. The completed run used explicit paths:

- `server/catalogue-import/available-stock-list.xlsm` (75,454 bytes), identical to
  the original `D:/available-stock-list.xlsm`.
- `D:/Sipup_Combined_Catalogue.zip` (15,632,093 bytes), containing one 16-page PDF.

Both fingerprints are recorded in the preview. ExcelJS reads OOXML cells without
executing VBA. ZIP entries are inspected for traversal, encrypted/symlink entries
and size limits. PDF.js decodes existing image objects without evaluating PDF
JavaScript. Sharp makes WebP assets; no packaging was generated or altered.

## Results

| Item | Result |
| --- | ---: |
| Structurally valid product records | 162 |
| New by exact generated SKU | 162 |
| Existing matching identifiers | 0 |
| Duplicate source identities | 0 |
| Inspected image associations | 81 |
| Unconfirmed image candidates | 11 |
| Products with no usable suggestion | 70 |
| Source case/unit-price discrepancies greater than 1p | 16 |
| Separate brands requiring review | 67 |
| Unrecognised source VAT values | 0 |
| Source classifications still requiring admin confirmation for sale | 162 |
| Ready for draft import | 66 |
| Requires review | 96 |
| Proposed initial stock | 20 cases per new product; 3,240 cases total |

Review counts overlap: image, brand and price warnings may affect the same row.
Prices remain the original workbook values. The preview uses `exclusive` based
on the user's earlier explicit confirmation that source prices exclude VAT.
The default CLI leaves the convention unresolved unless supplied explicitly.
The workbook has 147 percentage-formatted values of 0.2 (20%) and 15 values of
0 (0%); none is relabelled exempt. These are source mappings, not independent tax
classification advice. All eventual creations are unpublished VAT-unconfirmed drafts.

PDF extraction inventoried 125 raster placements, including repeated logos,
backgrounds and complete page images. Twenty explicit product crops were made
from the original-resolution rasters. Only the 81 inspected product associations
were copied into `public/products/` using content-hash filenames. The production
build includes these assets; deploying the source/build makes `/products/*.webp`
available without machine-local paths or temporary upload URLs.

Some catalogue products are absent from Excel, and some Excel products are absent
from the PDF. Full-page images and logos are not assigned as product pictures.
Examples requiring review include Jolly Jose/Jolly Joes, Strawberry/Strawberry
Kiwi, Roll-Ups 141g versus 10-count labels, and Taco noodles 140g versus 135g.
No uncertain candidates were copied as confirmed product images.

## Review artifacts

- `reports/catalogue-import/preview.html`: searchable visual review of all rows.
- `reports/catalogue-import/products-preview.csv`: original prices, VAT, stock and warnings.
- `reports/catalogue-import/product-image-mapping.csv`: all 162 products and image status.
- `reports/catalogue-import/unmatched-products.csv`: 70 records without suggestions.
- `reports/catalogue-import/ambiguous-matches.csv`: 11 unconfirmed candidate records.
- `reports/catalogue-import/preview.json`: complete source cells, identifiers,
  brand mappings, tax previews, image evidence, crop provenance and approval digest.
- `reports/catalogue-import/matched-review-1.png` through `matched-review-3.png`:
  inspected product/image contact sheets.
- `reports/catalogue-import/image-inventory.json`: extraction inventory and PDF text layout.
- `server/catalogue-import/image-review.json`: source-pinned image/brand review configuration.

`confirmed` in image mapping means inspected association, not approval to import.

## Commands

Both commands are dry-run by default:

```powershell
npm run products
npm run products:import
```

They expect populated `import-data` files. With the files currently available,
reproduce the completed preview using:

```powershell
npm run products:import -- --workbook server/catalogue-import/available-stock-list.xlsm --catalogue D:/Sipup_Combined_Catalogue.zip --mapping server/catalogue-import/image-review.json --price-mode exclusive --dry-run
```

Add `--reuse-images` to reuse the extraction inventory; the ZIP hash is verified.
Do not run two jobs into the same report directory concurrently. Re-extraction
also retains original-resolution PNGs under `reports/catalogue-import/sources/`
for reproducible cropping. The separate `catalogue-image-review.js` script rebuilds
the inspected source-specific manifest and refuses different workbook/PDF hashes.

## Approval and future import

The live path is implemented but was not executed. Resolve review rows in the
mapping configuration and regenerate the preview first. Product overrides are
keyed by generated SKU, never by spreadsheet position:

```json
{
  "products": {
    "IMP-EXAMPLE": {
      "brand": "Confirmed brand",
      "acceptUnitMismatch": true,
      "allowMissingImage": true
    }
  }
}
```

Only set those flags after reviewing the respective source record. An optional
`existingSku` explicitly selects an already-confirmed database identifier.
An image entry uses `assetId` and `confirmed`; changing a verified native image
requires its reviewed `assetHash`. Changing the workbook/PDF requires renewed
source fingerprint review. The generated JSON retains all original cell values.

After preview approval, migration 005 can be applied through `npm run db:migrate`.
It adds only nullable `products.catalogue_details` JSON, preserving structured
size/flavour/case quantity, source unit price, original cells and provenance.
It reuses existing product, brand column, category hierarchy, image, inventory
and audit models. There is no separate brand table to duplicate.

Only a deliberate `--commit --approve <exact-preview-digest>` enables product
writes. The command rejects changed previews and unresolved review/invalid rows.
The importer takes a MySQL advisory lock and performs the complete catalogue
transactionally. Existing exact SKUs are no-ops, including prices, identifiers,
images and inventory. Retries create no duplicates; failures roll back all rows.
New products get independent stock of 20 cases and an initial stock movement.
A case of 12 has stock **20 cases**, not 240. Case-pack labels and the product
detail quantity/availability labels make the selling unit explicit. Admin VAT
confirmation and publication remain separate from import approval.

Rebuild after changing image assets. Parent-category editing/filter behaviour in
the existing admin remains a separate acceptance check before publishing imported
hierarchies. No deployment or browser automation was performed.

## Actual verification

- Full extraction + dry-run command completed successfully.
- `npm test`: 16 passed; the isolated integration entry intentionally skipped.
- `npm run test:integration`: 27 passed, zero failures/skips, using a temporary
  MySQL instance rather than the application database. Includes migration 005,
  independent flavour stock, idempotent retries and preserved stock/identifiers.
- `npm run build`: TypeScript and Vite production build passed, including 81
  product WebP assets.
- No lint script is configured.

## Implementation files

New: `server/catalogue-import/{extract,products,crops,store}.js`,
`server/catalogue-import/image-review.json`,
`server/migrations/005_catalogue_import.sql`, `scripts/products.js`,
`scripts/catalogue-image-review.js`, `test/catalogue-import.test.js`, this report,
the generated review artifacts and 81 `public/products/*.webp` files.

Modified: `package.json`, `server/migrate.js`, `src/App.tsx`,
`test/backend.test.js`, `README.md`, `.gitignore`.
