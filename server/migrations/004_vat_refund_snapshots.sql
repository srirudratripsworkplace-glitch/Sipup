CREATE TABLE IF NOT EXISTS refund_tax_lines (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  refund_id BIGINT UNSIGNED NOT NULL,
  order_item_id BIGINT UNSIGNED NULL,
  delivery_breakdown_id BIGINT UNSIGNED NULL,
  quantity INT UNSIGNED NOT NULL,
  vat_treatment ENUM('standard','reduced','zero','exempt') NOT NULL,
  vat_rate DECIMAL(5,2) NULL,
  net_gbp DECIMAL(12,2) NOT NULL,
  vat_gbp DECIMAL(12,2) NOT NULL,
  gross_gbp DECIMAL(12,2) NOT NULL,
  CONSTRAINT refund_tax_refund_fk FOREIGN KEY (refund_id) REFERENCES refunds(id),
  CONSTRAINT refund_tax_item_fk FOREIGN KEY (order_item_id) REFERENCES order_items(id),
  CONSTRAINT refund_tax_delivery_fk FOREIGN KEY (delivery_breakdown_id) REFERENCES order_vat_breakdowns(id),
  CONSTRAINT refund_tax_source_ck CHECK ((order_item_id IS NULL) <> (delivery_breakdown_id IS NULL)),
  CONSTRAINT refund_tax_amount_ck CHECK (quantity > 0 AND net_gbp >= 0 AND vat_gbp >= 0 AND gross_gbp = net_gbp + vat_gbp),
  INDEX refund_tax_item_idx (order_item_id),
  INDEX refund_tax_delivery_idx (delivery_breakdown_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
