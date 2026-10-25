# VAT implementation plan

1. Inspect existing MySQL schema and preserve stored prices and historical orders.
2. Complete backend validation, exact rounding, checkout, refund snapshots and reports.
3. Run repeatable migrations and integration tests against a separate test database.
4. Connect existing admin forms, reports and storefront presentation to the verified backend.
5. Run all tests and the TypeScript/production build; document outstanding business configuration.

Inspection: React/TypeScript/Vite frontend, Express ES modules, MySQL 8 with
`server/migrate.js`, cookie/session authentication and Node's built-in test runner.
VAT code was already present, but the configured database had not received migration
003. Prices are DECIMAL GBP in MySQL and integer pence in the API. Saved product
prices are canonical net amounts; price_entry_mode records the entry convention.
No AGENTS.md or Git repository was found in this checkout. No deployment is planned.

Implementation and backend verification are finished. Final isolated MySQL/unit
suite: 20 passed, zero failures/skips. TypeScript and production build passed.
See VAT_IMPLEMENTATION.md for the complete change report, run commands, remaining
22 product classifications, delivery configuration and browser verification limits.
