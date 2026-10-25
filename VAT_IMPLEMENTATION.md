# SipUp VAT implementation — 15 October 2026

The existing React/TypeScript/Vite, Express and MySQL application is retained.
Work was completed locally; nothing was deployed.

## Backend and database

- Product treatment is individually selected as standard (20%), reduced (5%),
  zero (0%) or exempt (null rate). Zero and exempt remain separate everywhere.
- Unclassified/unconfirmed products are excluded from public listings and rejected
  at checkout. Names and categories never determine a product's VAT treatment.
- Existing GBP DECIMAL prices are preserved. Product prices, promotions and bulk
  tiers use canonical whole-penny **net** amounts. The recorded entry convention
  describes how the admin entered a price, not how to reinterpret the stored net.
- Inclusive entry is converted once on save. An inclusive price that cannot
  round-trip through whole-penny net storage is rejected explicitly. For example,
  3p inclusive at 20% cannot be represented by this storage convention; choose an
  adjacent representable price or enter net. The form explains this limitation.
- Integer pence and round-half-up are used, with exact BigInt division in the
  rounding helper. Tax rounds once per discounted product line. A quantity total
  can differ by a penny from multiplying rounded gross unit prices; basket and
  checkout line amounts use the same line calculation.
- Checkout reloads prices, promotions, bulk tiers, classification, stock and store
  settings. Browser tax/rate/total claims never determine charges. An expected
  total is a comparison guard; a mismatch returns HTTP 409.
- Orders preserve name, SKU, quantity, net unit price, entry convention, discount,
  treatment, rate, net/VAT/gross lines, category name, delivery tax and treatment
  breakdowns. Existing orders are not recalculated from edited products.
- Idempotent retries return the saved order even after product pricing changes.
- Refunds on orders with tax snapshots must select original items/quantities or
  the original delivery charge. Tax uses saved amounts, not current product rates.
  Cumulative quantity allocations absorb rounding pennies in the final reversal.
  Order locking prevents concurrent over-refunds; payment limits still apply.
- Legacy cash refunds without tax snapshots remain possible, but appear as
  unallocated warnings rather than invented VAT figures.
- Migration 004 adds a nullable historical category snapshot, refund tax lines,
  source/amount constraints and a product VAT-review index. Its DDL tolerates
  rerunning after interruption. Migration 003 adds product/order VAT fields.
- Existing session authorization protects all admin reports and changes. Product
  price/classification changes retain before/after audit details and admin identity.
- Fixed an existing customer session helper that referenced an undefined response
  object instead of returning its token to the login/registration handlers.

## Admin and storefront

- Navigation includes Dashboard, Products, Categories, VAT & Pricing, Orders,
  Customers, Delivery & Collection, Reports and Settings. Existing order and
  settings screens are reused; category creation and customer data use real APIs.
- Product forms have live regular/promotional price previews and explicit
  classification confirmation. Changing treatment clears confirmation. Product
  tables show net, tax, gross, treatment and review status. Categories come from
  MySQL rather than a fixed list in the product form.
- Reports separate stock-value estimates from saved order tax. Filters include
  dates, fulfilment status, treatment and category. The original status-filter
  bug that discarded date conditions is fixed.
- Delivered orders are selected by default. Other statuses are explicitly
  selectable, with partial/full/current refund states shown separately.
- Refunds are separate positive adjustment rows to subtract from sales. Sales use
  order creation dates; refunds use refund dates. Date boundaries are UTC and
  labelled. These management reports do not implement tax-point accounting or
  constitute HMRC VAT returns.
- Category-filtered sales use saved category names, never current product
  categories. Delivery and older lines without category snapshots are excluded
  from category-filtered amounts. Recent rows show whole-order totals.
- Filtered CSV exports use the same report service as the dashboard, exact GBP
  formatting, discounts and separate refund rows. Legacy omissions are included.
- The accessible Ex. VAT / Inc. VAT buttons update shared product-card/search,
  detail, promotion, bulk-tier and cart presentation. Preference persists through
  navigation/refresh. It never edits products, quantities or order values.
- The public storefront defaults to inclusive display. Inclusive prices remain
  visible when selecting exclusive display, without assuming business status.

## Run locally

```powershell
npm.cmd run db:migrate
npm.cmd run dev
```

Vite: `http://localhost:5173`; admin: `/admin/login`.
Use existing private `.env` settings. Do not commit secrets or run the optional
seed against production to resolve classifications.

```powershell
npm.cmd test
npm.cmd run test:integration
npm.cmd run build
```

The integration command requires a local MySQL 8 `mysqld` executable on PATH,
or `MYSQLD_PATH` pointing to it. It initializes an isolated temporary MySQL server,
uses a random test-only root password and test database, then shuts down and
removes its own directory. It never writes test orders to the configured app DB.
The ordinary unit command intentionally skips database integration unless invoked
through this runner. The build includes the TypeScript check. No lint script is
configured.

## Deployment prerequisites and verification limits

Final executed validation:

| Command | Actual result |
| --- | --- |
| `npm.cmd test` | 10 passed, 1 integration entry intentionally skipped |
| `npm.cmd run test:integration` | 20 passed, 0 failed, 0 skipped; temporary server cleaned up |
| `npm.cmd run build` | TypeScript and Vite production build passed |
| `npm.cmd run db:migrate` | Applied successfully to the configured MySQL database |
| Lint | No lint script configured |
| Browser automation | Unavailable; not run |

- The configured database has migrations 001–004 applied. Both fresh installation
  and upgrade from a reconstructed pre-VAT schema are exercised in isolated tests,
  including a repeat migration and unchanged legacy prices.
- **All 22 existing products still require VAT classification.** They remain
  unavailable for sale until an administrator confirms treatment and prices.
  SKUs: DRK-001–DRK-008, SNK-001–SNK-005, SWT-001–SWT-005,
  NRG-002–NRG-005. No classification has been invented.
- Confirm the VAT treatment of the actual delivery supply in Settings. A nonzero
  fee with unconfigured treatment blocks delivery checkout. Free delivery and
  collection have no added delivery VAT. The current system supports one explicitly
  configured delivery treatment, not automatic mixed-basket delivery apportionment;
  if the actual supply requires apportionment, that needs an additional reviewed
  implementation before enabling paid delivery for it.
- Payment processing remains the existing external-payment ledger/WhatsApp booking
  flow. No card gateway or automated HMRC filing has been added.
- Browser automation was unavailable. Shared presentation/preference tests and the
  TypeScript/production build verify logic, but mobile layouts, keyboard flow and
  browser interactions still need manual acceptance testing before deployment.

## Files changed or added in this work

Modified: `.gitignore`, `package.json`, `server/index.js`, `server/migrate.js`,
`shared/vat.js`, `shared/vat.d.ts`, `src/App.tsx`, `src/index.css`,
`test/vat.test.js`, `README.md`, `IMPLEMENTATION.md`.

Added: `server/migrations/004_vat_refund_snapshots.sql`, `server/refund-tax.js`,
`server/vat-report.js`, `shared/storefront-pricing.js`,
`shared/storefront-pricing.d.ts`, `scripts/mysql-integration.js`,
`test/backend.test.js`, `VAT_IMPLEMENTATION.md`.

The production build also regenerates ignored `dist/` output and TypeScript build
metadata. This checkout has no Git metadata, so no commit or diff is available.

## Reference review

The [Maaab catalogue](https://maaab.co.uk/) was inspected for its pricing-switch
experience. SipUp retains its existing branding. Public pricing strategy was
reviewed against [CMA price transparency guidance](https://www.gov.uk/government/publications/price-transparency-cma209).
Classification and delivery review references:
[HMRC food products](https://www.gov.uk/guidance/food-products-and-vat-notice-70114),
[HMRC postage and delivery](https://www.gov.uk/guidance/vat-on-postage-delivery-and-direct-marketing-notice-70024).
