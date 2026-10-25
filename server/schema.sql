CREATE TABLE IF NOT EXISTS schema_migrations (
  version VARCHAR(64) NOT NULL PRIMARY KEY,
  applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS admins (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(254) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS admin_sessions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  admin_id BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at DATETIME NOT NULL,
  revoked_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT admin_sessions_admin_fk FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE CASCADE,
  INDEX admin_sessions_expiry_idx (admin_id, expires_at, revoked_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS categories (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  parent_id BIGINT UNSIGNED NULL,
  name VARCHAR(100) NOT NULL,
  slug VARCHAR(120) NOT NULL UNIQUE,
  description VARCHAR(500) NOT NULL DEFAULT '',
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT categories_parent_fk FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE SET NULL,
  INDEX categories_parent_sort_idx (parent_id, sort_order, name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS products (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  category_id BIGINT UNSIGNED NULL,
  name VARCHAR(160) NOT NULL,
  slug VARCHAR(160) NOT NULL UNIQUE,
  sku VARCHAR(80) NOT NULL UNIQUE,
  brand VARCHAR(100) NOT NULL DEFAULT '',
  description TEXT NOT NULL,
  price_gbp DECIMAL(10,2) NOT NULL,
  sale_price_gbp DECIMAL(10,2) NULL,
  vat_treatment ENUM('standard','reduced','zero','exempt') NULL,
  vat_rate DECIMAL(5,2) NULL,
  vat_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  price_entry_mode ENUM('exclusive','inclusive') NOT NULL DEFAULT 'exclusive',
  stock_quantity INT UNSIGNED NOT NULL DEFAULT 0,
  min_quantity INT UNSIGNED NOT NULL DEFAULT 1,
  pack_size VARCHAR(100) NOT NULL DEFAULT '',
  is_published BOOLEAN NOT NULL DEFAULT TRUE,
  is_featured BOOLEAN NOT NULL DEFAULT FALSE,
  is_new BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT products_category_fk FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL,
  CONSTRAINT products_price_ck CHECK (price_gbp >= 0),
  CONSTRAINT products_sale_price_ck CHECK (sale_price_gbp IS NULL OR (sale_price_gbp >= 0 AND sale_price_gbp <= price_gbp)),
  INDEX products_catalogue_idx (is_published, category_id, created_at),
  INDEX products_stock_idx (is_published, stock_quantity)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS product_media (
  sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  mime_type VARCHAR(40) NOT NULL,
  image_data MEDIUMBLOB NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;


CREATE TABLE IF NOT EXISTS product_images (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  product_id BIGINT UNSIGNED NOT NULL,
  image_url VARCHAR(1000) NOT NULL,
  alt_text VARCHAR(200) NOT NULL DEFAULT '',
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT product_images_product_fk FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  INDEX product_images_sort_idx (product_id, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS product_variants (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  product_id BIGINT UNSIGNED NOT NULL,
  sku VARCHAR(80) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  attributes JSON NOT NULL,
  price_gbp DECIMAL(10,2) NULL,
  stock_quantity INT UNSIGNED NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT variants_product_fk FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  INDEX variants_product_idx (product_id, is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS bulk_pricing (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  product_id BIGINT UNSIGNED NOT NULL,
  min_quantity INT UNSIGNED NOT NULL,
  unit_price_gbp DECIMAL(10,2) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT bulk_pricing_product_fk FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  CONSTRAINT bulk_pricing_min_ck CHECK (min_quantity > 0),
  CONSTRAINT bulk_pricing_price_ck CHECK (unit_price_gbp >= 0),
  UNIQUE KEY bulk_pricing_tier_uq (product_id, min_quantity)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS customers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  phone VARCHAR(30) NOT NULL,
  email VARCHAR(254) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX customers_phone_idx (phone),
  INDEX customers_email_idx (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS customer_accounts (
  customer_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  email VARCHAR(254) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT customer_accounts_customer_fk FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS customer_sessions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  customer_id BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at DATETIME NOT NULL,
  revoked_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT customer_sessions_account_fk FOREIGN KEY (customer_id) REFERENCES customer_accounts(customer_id) ON DELETE CASCADE,
  INDEX customer_sessions_expiry_idx (customer_id, expires_at, revoked_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS orders (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  customer_id BIGINT UNSIGNED NOT NULL,
  reference VARCHAR(40) NOT NULL UNIQUE,
  idempotency_key CHAR(36) NULL UNIQUE,
  status ENUM('booking','confirmed','processing','dispatched','delivered','cancelled') NOT NULL DEFAULT 'booking',
  subtotal_gbp DECIMAL(12,2) NOT NULL,
  vat_gbp DECIMAL(12,2) NOT NULL DEFAULT 0,
  delivery_gbp DECIMAL(12,2) NOT NULL DEFAULT 0,
  delivery_vat_treatment ENUM('standard','reduced','zero','exempt') NULL,
  delivery_vat_rate DECIMAL(5,2) NULL,
  delivery_vat_gbp DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_gbp DECIMAL(12,2) NOT NULL,
  admin_notes TEXT NOT NULL,
  stock_deducted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT orders_customer_fk FOREIGN KEY (customer_id) REFERENCES customers(id),
  CONSTRAINT orders_totals_ck CHECK (subtotal_gbp >= 0 AND vat_gbp >= 0 AND delivery_gbp >= 0 AND total_gbp >= 0),
  INDEX orders_created_status_idx (created_at, status),
  INDEX orders_customer_date_idx (customer_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS delivery_details (
  order_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  preference ENUM('delivery','collection') NOT NULL,
  address VARCHAR(300) NOT NULL DEFAULT '',
  postcode VARCHAR(16) NOT NULL DEFAULT '',
  customer_notes TEXT NOT NULL,
  CONSTRAINT delivery_order_fk FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS order_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  order_id BIGINT UNSIGNED NOT NULL,
  product_id BIGINT UNSIGNED NULL,
  variant_id BIGINT UNSIGNED NULL,
  product_name VARCHAR(160) NOT NULL,
  sku VARCHAR(80) NOT NULL,
  quantity INT UNSIGNED NOT NULL,
  unit_price_gbp DECIMAL(10,2) NOT NULL,
  line_total_gbp DECIMAL(12,2) NOT NULL,
  vat_treatment ENUM('standard','reduced','zero','exempt') NULL,
  vat_rate DECIMAL(5,2) NULL,
  price_entry_mode ENUM('exclusive','inclusive') NULL,
  discount_gbp DECIMAL(12,2) NOT NULL DEFAULT 0,
  line_net_gbp DECIMAL(12,2) NULL,
  line_vat_gbp DECIMAL(12,2) NULL,
  line_gross_gbp DECIMAL(12,2) NULL,
  CONSTRAINT order_items_order_fk FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT order_items_product_fk FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL,
  CONSTRAINT order_items_variant_fk FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE SET NULL,
  CONSTRAINT order_items_quantity_ck CHECK (quantity > 0),
  INDEX order_items_order_idx (order_id),
  INDEX order_items_product_idx (product_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS order_vat_breakdowns (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS payments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  order_id BIGINT UNSIGNED NOT NULL,
  amount_gbp DECIMAL(12,2) NOT NULL,
  method ENUM('cash','bank_transfer','card','other') NOT NULL,
  paid_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reference VARCHAR(120) NOT NULL DEFAULT '',
  notes VARCHAR(1000) NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT payments_order_fk FOREIGN KEY (order_id) REFERENCES orders(id),
  CONSTRAINT payments_amount_ck CHECK (amount_gbp > 0),
  INDEX payments_order_date_idx (order_id, paid_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS stock_movements (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  product_id BIGINT UNSIGNED NOT NULL,
  variant_id BIGINT UNSIGNED NULL,
  order_id BIGINT UNSIGNED NULL,
  quantity_delta INT NOT NULL,
  reason VARCHAR(120) NOT NULL,
  actor VARCHAR(254) NOT NULL DEFAULT 'system',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT stock_movements_product_fk FOREIGN KEY (product_id) REFERENCES products(id),
  CONSTRAINT stock_movements_variant_fk FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE SET NULL,
  CONSTRAINT stock_movements_order_fk FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL,
  INDEX stock_movements_product_date_idx (product_id, created_at),
  INDEX stock_movements_order_idx (order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS refunds (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  order_id BIGINT UNSIGNED NOT NULL,
  payment_id BIGINT UNSIGNED NULL,
  amount_gbp DECIMAL(12,2) NOT NULL,
  method ENUM('cash','bank_transfer','card','other') NOT NULL,
  refunded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reference VARCHAR(120) NOT NULL DEFAULT '',
  notes VARCHAR(1000) NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT refunds_order_fk FOREIGN KEY (order_id) REFERENCES orders(id),
  CONSTRAINT refunds_payment_fk FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE SET NULL,
  CONSTRAINT refunds_amount_ck CHECK (amount_gbp > 0),
  INDEX refunds_order_date_idx (order_id, refunded_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS order_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  order_id BIGINT UNSIGNED NOT NULL,
  event_type VARCHAR(50) NOT NULL,
  details JSON NOT NULL,
  actor VARCHAR(254) NOT NULL DEFAULT 'system',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT order_events_order_fk FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  INDEX order_events_order_date_idx (order_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  admin_id BIGINT UNSIGNED NULL,
  action VARCHAR(80) NOT NULL,
  entity_type VARCHAR(60) NOT NULL,
  entity_id BIGINT UNSIGNED NULL,
  details JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT audit_admin_fk FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE SET NULL,
  INDEX audit_entity_idx (entity_type, entity_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS settings (
  `key` VARCHAR(80) NOT NULL PRIMARY KEY,
  `value` JSON NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT IGNORE INTO categories (name, slug, sort_order) VALUES
  ('Drinks','drinks',1),('Snacks','snacks',2),('Sweets','sweets',3),('Energy','energy',4);

INSERT IGNORE INTO settings (`key`, `value`) VALUES
  ('store', JSON_OBJECT('name','SipUp','tagline','Good stock. Good energy.','whatsapp_number','','email','','phone','','address','','currency','GBP','delivery_vat_treatment',NULL,'delivery_charge_pence',0,'free_delivery_threshold_pence',0,'minimum_order_pence',0,'business_hours','','announcement','Wholesale favourites, ready when you are.')),
  ('homepage', JSON_OBJECT('hero_title','Good stock.\nGood energy.','hero_copy','A better way to keep your shelves full. Discover the drinks and snacks your customers come back for.','hero_image','','promo_message','Stock up on the good stuff','featured_heading','The SipUp essentials'));
