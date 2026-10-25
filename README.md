# SipUp

For PDF product image extraction and the read-only bulk import preview, see
[CATALOGUE_IMPORT.md](CATALOGUE_IMPORT.md). All 162 catalogue products are now imported
as drafts; see [the current import result](CATALOGUE_INTEGRATION_RESULT.md).

For the implemented product-level VAT workflow, migrations, test commands and
remaining catalogue review, see [VAT_IMPLEMENTATION.md](VAT_IMPLEMENTATION.md).

SipUp is a React, TypeScript and Express storefront for wholesale drinks and snacks. It uses MySQL 8/InnoDB for persistent products, stock, customer details, bookings, order lines, payments and refunds. A booking is saved before the confirmation screen offers the configured WhatsApp handoff; opening WhatsApp does not confirm acceptance or payment.

## Requirements

- Node.js 20.19+ (22 LTS recommended)
- MySQL 8.0+

## Local development

1. Install dependencies: `npm install`.
2. Create a MySQL database and application user, then copy `.env.example` to `.env`. Set `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, a random `JWT_SECRET` of at least 32 characters, `ADMIN_EMAIL` and an `ADMIN_PASSWORD` of at least 12 characters. Keep `.env` private.
3. Apply the schema: `npm run db:migrate`.
4. Optionally load development catalogue examples: `npm run db:seed`. Existing product SKUs are not overwritten.
5. Start Vite and the API together: `npm run dev`.
6. Open `http://localhost:5173`; create an account through **Store / Customer Login** to place bookings. Staff use `/staff/login`; store admins use `/admin/login`.

The first server start creates the configured admin account if it does not exist. Changing `ADMIN_PASSWORD` later does not rotate an existing account. Change credentials through a controlled database/password-reset procedure.

## Staff accounts and attributed sales

- Apply migration `007_staff_accounts` using `npm run db:migrate`. Existing orders remain unassigned; no staff accounts or default passwords are created automatically.
- In **Admin → Staff & Sales** (`/admin/staff`), create staff names, login emails and passwords (at least 12 characters). Grant **View own sales**, **View inventory**, and optionally **Adjust inventory**. Editing inventory requires viewing permission. Staff cannot access administrator routes, payments, customer account management or other staff members' sales.
- Staff use the separate `/staff/login` entrance. Accounts use hashed passwords and revocable eight-hour sessions with a staff-specific cookie and token audience. Permissions and active status are checked on every API request. Password resets and deactivation revoke staff sessions. Inactive staff cannot be selected on new checkouts; historical orders remain linked to them.
- Customers choose a staff name or **None of the above** at checkout. The server validates active staff and saves their ID and name with the order. Original attribution survives checkout retries and later staff name changes. Staff can see their assigned bookings and product lines; admin can inspect each staff report and the separate unassigned report.
- Sales totals count confirmed, processing, dispatched and delivered orders. Bookings and cancelled orders are separate. Quantities are selling units (for example, cases); product revenue excludes VAT and delivery and is shown before refunds. These reports track order attribution, not commissions or collected payments.
- Stock adjustments require a reason and the expected previous quantity. They update inventory and its stock-movement audit in one transaction; concurrent changes are rejected so staff must refresh.
- `npm run test:integration` checks authentication boundaries, migrations, permissions, staff sales isolation and order attribution in a private MySQL instance. After `npm run build`, `npm run test:staff-ui` exercises the real desktop/mobile forms in Chrome against another private database; generated screenshots are ignored under `reports/staff/`.

## Database and business setup

- `server/schema.sql` defines the MySQL 8/InnoDB schema. `npm run db:migrate` can be safely re-run; it creates missing tables, records schema versions, and maintains a non-unique customer-phone lookup index.
- GBP amounts are stored as `DECIMAL`, and the API exposes integer pence for the storefront. Product prices, VAT and business settings are reloaded while the order is created. Client monetary claims never determine charges; a supplied expected total is checked against the authoritative server total.
- Orders and order items are persisted before the WhatsApp handoff. Bookings, confirmed orders and payments are distinct. The dashboard reports recorded payments less refunds separately from booking and order values.
- Customers must create an account or sign in before checkout. Customer passwords are hashed, sessions are stored and revocable, and the API enforces authentication on order creation.
- Stock is deducted once when an order first enters a confirmed fulfilment state and restored if the order is cancelled.
- Payment and refund entries are separate ledger records. Payment processing is not integrated; admins record payments and refunds received outside SipUp.
- Configure the WhatsApp number in **Admin → Settings** using its international country code (digits are recommended). The number is not hardcoded in the source.
- Configure VAT and delivery settings only after owner review. Starter legal pages are review placeholders, not legal advice or approved policy text.
- Product image uploads are stored as WebP binary contents in MySQL `product_media`; `product_images` links products to `/api/product-media/<sha256>` URLs. The API serves image bytes with immutable caching. Upload cover and gallery images through the admin product editor (up to 5 MB per file). Explicit HTTPS URLs remain supported as externally hosted images.
- To migrate an existing file-based catalogue, run `npm run db:migrate` then `npm run db:images` while its original `public/products/` files are available. This stores and byte-verifies all WebP assets and changes image references in one transaction; reruns are safe. Product details, pricing, stock and orders are untouched. The local originals from the initial migration are archived in ignored `import-data/product-image-backup/`; the shop needs no product image files in its frontend build.
- Deployment and database backups must include `product_media` as well as `products` and `product_images`. GitHub contains application code; it does not contain the running database. Import scripts may generate temporary files in `public/products/`, but catalogue import saves their contents into MySQL before linking them to products.
- The optional development seed provides 22 sample products across Drinks, Snacks, Sweets and Energy, with product photos, regular prices and selected discount prices. Existing SKUs and admin-edited prices are preserved.

## Order confirmation and Gmail email

- Booking an order leaves stock unchanged. When admin changes it to **Confirmed** (or a later fulfilment status), the transaction locks the order and deducts its selling quantities once: 20 cases minus a confirmed 5-case booking leaves 15 cases. Repeated confirmation does not deduct again. Insufficient stock rolls back the entire confirmation. Cancellation restores deducted stock once; confirmed orders cannot return to the booking stage.
- Migration `008_order_confirmation_emails` adds a durable confirmation email queue. The email and stock change are saved in the same transaction. The message snapshots the customer's address, order lines, quantities and totals; later product edits do not change it. Email failures leave the order confirmed and its inventory correct.
- Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD` and `MAIL_FROM` in the private `.env` or hosting environment. For the requested sender, use `smtp.gmail.com`, port `465`, secure `true`, user `srirudralimited@gmail.com`, and `MAIL_FROM=SipUp <srirudralimited@gmail.com>`. `SMTP_PASSWORD` must be a Gmail app password, not the normal account password. [Google's app-password setup](https://support.google.com/accounts/answer/185833) requires 2-Step Verification and describes accounts where this option is unavailable. Do not commit credentials.
- Restart the API after configuring the sender. The server starts the email worker automatically, checks pending messages every 30 seconds, and wakes it on confirmation. Missing credentials leave emails pending. Failed attempts retry with increasing delays (up to 10 attempts); admin order details show pending/sent/failed status and offer an authorized retry. Already sent messages cannot be manually resent through this action. Cancellation suppresses confirmations that have not started sending.
- A **Sent** status means the email provider accepted the message; it is not an inbox-delivery receipt. SMTP delivery can be repeated if a process stops after the provider accepts a message but before the database records success. Each order has one queue record and a stable Message-ID to limit duplicates; stock is never deducted by the email worker.
- `npm run test:integration` verifies 20-to-15 stock deduction, concurrent confirmation, rollback, immutable email contents and retry behavior with a fake sender. It never requires or sends through real Gmail credentials. The browser checks also confirm the admin stock/status workflow and the scrolling ribbon's pause and reduced-motion behavior.

## Hostinger deployment (Node.js hosting with MySQL)

1. Choose a Hostinger Node.js plan/runtime supporting Node 20.19+ or Node 22, and provision a MySQL 8 database. Create a dedicated database user with access only to the SipUp database.
2. In Hostinger's database panel, record the database host, port, database name, username and password. Set them as `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER` and `DB_PASSWORD` in the Node.js app environment. Set `DB_SSL=true` only when the provider requires TLS; use its supported MySQL SSL configuration.
3. Deploy the source (including `server/`, `src/` and package manifests). Set `NODE_ENV=production`, `CLIENT_ORIGIN` to the HTTPS storefront origin, `COOKIE_SECURE=true`, a unique random `JWT_SECRET` of at least 32 characters, and strong initial admin credentials. Never upload `.env` to source control.
4. Install with `npm ci`, run `npm run db:migrate`, and build with `npm run build`.
5. Set the app's start command to `npm start` (`server/index.js`) and use the port supplied by Hostinger. Express serves `dist/` and `/api` from the same origin in production.
6. Check `/api/health`, sign in, configure store contact/WhatsApp/VAT/delivery settings, review products and stock, and complete the legal policy text before accepting orders.
7. Enable automated MySQL backups and test restoring one into a separate staging database before launch. Avoid logging customer payment credentials or secrets.

## Safe migration from the legacy PostgreSQL installation

The application now targets MySQL. No legacy PostgreSQL database is configured or migrated by this repository; do not point the new application at production data during testing. The old PostgreSQL database should remain untouched until the MySQL copy is validated.

1. **Back up first.** Take a PostgreSQL custom-format dump with `pg_dump -Fc`, store it securely, and test restoring it to a separate PostgreSQL staging database. Keep a second independent backup.
2. **Prepare staging.** Create a separate MySQL 8 staging database, run `npm run db:migrate` twice to verify repeatability, and keep the source PostgreSQL database read-only during data extraction.
3. **Map and import.** Map source customers, products, categories, images, stock, bookings, order-line snapshots, payments, refunds, settings and event history into their normalized MySQL tables. Convert GBP amounts to exact two-decimal values, preserve public order references and timestamps, and retain deleted-product order snapshots. Do not import password hashes unless their format and authentication compatibility have been verified; create/reset admin access securely.
4. **Validate before cutover.** Compare row counts by entity and order status, stock totals, order references, order totals, payment/refund sums, and representative customer/order histories. Check the dashboard's recorded paid revenue and outstanding totals against independently calculated source values. Run checkout, idempotency retry, status/stock, payment, refund and CSV workflows in staging.
5. **Cut over deliberately.** Schedule a short write freeze, take a final PostgreSQL dump, import the delta using the same validated mapping, and repeat reconciliation. Switch application credentials only after business-owner sign-off. Keep the PostgreSQL backup and original database read-only for an agreed rollback period; never drop or overwrite the source as part of import.

The repository does not contain a generic PostgreSQL-to-MySQL importer because legacy schemas and payment semantics vary; tailor and test a one-off importer against the actual source schema and a restored backup rather than guessing column mappings.

## Main routes

- Storefront: `/`, `/shop`, `/category/:category`, `/product/:slug`, `/cart`, `/checkout`
- Customer accounts: `/account/register`, `/account/login`, `/account`
- Booking handoff: `/order-confirmation/:reference`
- Admin: `/admin/login`, `/admin`, `/admin/orders`, `/admin/products`, `/admin/categories`, `/admin/customers`, `/admin/vat-pricing`, `/admin/reports`, `/admin/delivery`, `/admin/settings`
- Public API: `/api/products`, `/api/categories`, `/api/settings`, `/api/account/register`, `/api/account/login`
- Customer API: `/api/account/me`, `/api/account/orders`, authenticated `POST /api/orders`
- Protected API: `/api/admin/*`, `/api/auth/me`

WhatsApp is only a communication handoff. It is not proof that the seller accepted the booking or received payment.
