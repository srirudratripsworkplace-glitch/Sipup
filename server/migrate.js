import 'dotenv/config'
import { readFile } from 'node:fs/promises'
import { pool } from './pool.js'

try {
  const schema = await readFile(new URL('./schema.sql', import.meta.url), 'utf8')
  for (const statement of schema.split(/;\s*(?:\r?\n|$)/).map((item) => item.trim()).filter(Boolean)) {
    await pool.query(statement)
  }
  const phoneIndexes = await pool.query('SHOW INDEX FROM customers')
  const uniquePhoneIndex = phoneIndexes.rows.find((index) => index.Column_name === 'phone' && Number(index.Non_unique) === 0)
  if (uniquePhoneIndex) {
    if (!/^[A-Za-z0-9_]+$/.test(uniquePhoneIndex.Key_name)) {
      throw new Error('Unexpected customer phone index name; refusing to alter the index.')
    }
    await pool.query(`ALTER TABLE customers DROP INDEX \`${uniquePhoneIndex.Key_name}\``)
  }
  const refreshedIndexes = uniquePhoneIndex ? await pool.query('SHOW INDEX FROM customers') : phoneIndexes
  if (!refreshedIndexes.rows.some((index) => index.Key_name === 'customers_phone_idx')) {
    await pool.query('CREATE INDEX customers_phone_idx ON customers (phone)')
  }
  await pool.query(
    'INSERT IGNORE INTO schema_migrations (version) VALUES (?)',
    ['001_initial_mysql_schema'],
  )
  await pool.query(
    'INSERT IGNORE INTO schema_migrations (version) VALUES (?)',
    ['002_customer_accounts'],
  )
  const migrations = await pool.query('SELECT version FROM schema_migrations')
  const applied = new Set(migrations.rows.map((row) => row.version))
  if (!applied.has('003_product_level_vat')) {
    const productColumns = await pool.query('SHOW COLUMNS FROM products')
    const productColumnNames = new Set(productColumns.rows.map((column) => column.Field))
    if (!productColumnNames.has('vat_treatment')) {
      await pool.query("ALTER TABLE products ADD COLUMN vat_treatment ENUM('standard','reduced','zero','exempt') NULL")
    }
    if (!productColumnNames.has('vat_rate')) {
      await pool.query('ALTER TABLE products ADD COLUMN vat_rate DECIMAL(5,2) NULL')
    }
    if (!productColumnNames.has('vat_confirmed')) {
      await pool.query('ALTER TABLE products ADD COLUMN vat_confirmed BOOLEAN NOT NULL DEFAULT FALSE')
    }
    if (!productColumnNames.has('price_entry_mode')) {
      await pool.query("ALTER TABLE products ADD COLUMN price_entry_mode ENUM('exclusive','inclusive') NOT NULL DEFAULT 'exclusive'")
    }
    const orderColumns = await pool.query('SHOW COLUMNS FROM orders')
    const orderColumnNames = new Set(orderColumns.rows.map((column) => column.Field))
    if (!orderColumnNames.has('delivery_vat_treatment')) {
      await pool.query("ALTER TABLE orders ADD COLUMN delivery_vat_treatment ENUM('standard','reduced','zero','exempt') NULL")
    }
    if (!orderColumnNames.has('delivery_vat_rate')) {
      await pool.query('ALTER TABLE orders ADD COLUMN delivery_vat_rate DECIMAL(5,2) NULL')
    }
    if (!orderColumnNames.has('delivery_vat_gbp')) {
      await pool.query('ALTER TABLE orders ADD COLUMN delivery_vat_gbp DECIMAL(12,2) NOT NULL DEFAULT 0')
    }
    const itemColumns = await pool.query('SHOW COLUMNS FROM order_items')
    const itemColumnNames = new Set(itemColumns.rows.map((column) => column.Field))
    if (!itemColumnNames.has('vat_treatment')) {
      await pool.query("ALTER TABLE order_items ADD COLUMN vat_treatment ENUM('standard','reduced','zero','exempt') NULL")
    }
    if (!itemColumnNames.has('vat_rate')) {
      await pool.query('ALTER TABLE order_items ADD COLUMN vat_rate DECIMAL(5,2) NULL')
    }
    if (!itemColumnNames.has('price_entry_mode')) {
      await pool.query("ALTER TABLE order_items ADD COLUMN price_entry_mode ENUM('exclusive','inclusive') NULL")
    }
    if (!itemColumnNames.has('discount_gbp')) {
      await pool.query('ALTER TABLE order_items ADD COLUMN discount_gbp DECIMAL(12,2) NOT NULL DEFAULT 0')
    }
    if (!itemColumnNames.has('line_net_gbp')) {
      await pool.query('ALTER TABLE order_items ADD COLUMN line_net_gbp DECIMAL(12,2) NULL')
    }
    if (!itemColumnNames.has('line_vat_gbp')) {
      await pool.query('ALTER TABLE order_items ADD COLUMN line_vat_gbp DECIMAL(12,2) NULL')
    }
    if (!itemColumnNames.has('line_gross_gbp')) {
      await pool.query('ALTER TABLE order_items ADD COLUMN line_gross_gbp DECIMAL(12,2) NULL')
    }
    await pool.query(`CREATE TABLE IF NOT EXISTS order_vat_breakdowns (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      order_id BIGINT UNSIGNED NOT NULL,
      vat_treatment ENUM('standard','reduced','zero','exempt') NOT NULL,
      vat_rate DECIMAL(5,2) NULL,
      net_gbp DECIMAL(12,2) NOT NULL,
      vat_gbp DECIMAL(12,2) NOT NULL,
      gross_gbp DECIMAL(12,2) NOT NULL,
      is_delivery BOOLEAN NOT NULL DEFAULT FALSE,
      CONSTRAINT order_vat_breakdowns_order_fk FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
      INDEX order_vat_breakdowns_order_idx (order_id, is_delivery)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`)
    await pool.query('INSERT INTO schema_migrations (version) VALUES (?)', ['003_product_level_vat'])
  }
  if (!applied.has('004_vat_refund_snapshots')) {
    const columns = await pool.query('SHOW COLUMNS FROM order_items')
    if (!columns.rows.some((column) => column.Field === 'category_name')) {
      await pool.query('ALTER TABLE order_items ADD COLUMN category_name VARCHAR(100) NULL')
    }
    const sql = await readFile(new URL('./migrations/004_vat_refund_snapshots.sql', import.meta.url), 'utf8')
    for (const statement of sql.split(/;\s*(?:\r?\n|$)/).map((s) => s.trim()).filter(Boolean)) await pool.query(statement)
    const indexes = await pool.query('SHOW INDEX FROM products')
    if (!indexes.rows.some((index) => index.Key_name === 'products_vat_review_idx')) {
      await pool.query('CREATE INDEX products_vat_review_idx ON products (vat_confirmed, vat_treatment, is_published)')
    }
    await pool.query('INSERT INTO schema_migrations (version) VALUES (?)', ['004_vat_refund_snapshots'])
  }
  if (!applied.has('005_catalogue_import')) {
    const columns = await pool.query('SHOW COLUMNS FROM products')
    if (!columns.rows.some((column) => column.Field === 'catalogue_details')) {
      await pool.query('ALTER TABLE products ADD COLUMN catalogue_details JSON NULL')
    }
    await pool.query('INSERT INTO schema_migrations (version) VALUES (?)', ['005_catalogue_import'])
  }
  console.log('MySQL schema is up to date.')
} catch (error) {
  console.error('MySQL migration failed:', error.message)
  process.exitCode = 1
} finally {
  await pool.end()
}
