import 'dotenv/config'
import { pool } from './pool.js'

const products = [
  ['Classic Cola 330ml', 'classic-cola-330ml', 'DRK-001', 'SipUp Picks', 'Drinks', 'A crisp, classic cola in a convenient single-serve can.', 'https://images.unsplash.com/photo-1554866585-cd94860890b7?auto=format&fit=crop&w=900&q=85', 960, 840, 180, 1, '24 × 330ml', true],
  ['Orange Soda 330ml', 'orange-soda-330ml', 'DRK-002', 'SipUp Picks', 'Drinks', 'Bright citrus flavour with a refreshing fizz.', 'https://images.unsplash.com/photo-1624517452488-04869289c4ca?auto=format&fit=crop&w=900&q=85', 960, null, 120, 1, '24 × 330ml', true],
  ['Sparkling Water 500ml', 'sparkling-water-500ml', 'DRK-003', 'SipUp Picks', 'Drinks', 'Lightly sparkling water for an easy refresh.', 'https://images.unsplash.com/photo-1608270586620-248524c67de9?auto=format&fit=crop&w=900&q=85', 480, null, 240, 1, '12 × 500ml', true],
  ['Energy Drink 250ml', 'energy-drink-250ml', 'DRK-004', 'SipUp Picks', 'Energy', 'A bold, chilled pick-me-up in a compact can.', 'https://images.unsplash.com/photo-1622543925917-763c34d1a86e?auto=format&fit=crop&w=900&q=85', 1080, null, 96, 1, '24 × 250ml', true],
  ['Sea Salt Crisps', 'sea-salt-crisps', 'SNK-001', 'SipUp Picks', 'Snacks', 'Golden, crunchy crisps with a classic sea-salt finish.', 'https://images.unsplash.com/photo-1566478989037-eec170784d0b?auto=format&fit=crop&w=900&q=85', 899, 799, 200, 1, '20 × 40g', true],
  ['Chocolate Wafer Bar', 'chocolate-wafer-bar', 'SNK-002', 'SipUp Picks', 'Snacks', 'Crisp wafer layered with smooth chocolate.', 'https://images.unsplash.com/photo-1621939514649-280e2aa2f9a0?auto=format&fit=crop&w=900&q=85', 1440, null, 160, 1, '24 bars', true],
  ['Fruit Chews', 'fruit-chews', 'SWT-001', 'SipUp Picks', 'Sweets', 'Colourful fruit chews for a little everyday treat.', 'https://images.unsplash.com/photo-1582058091505-f87a2e55a40f?auto=format&fit=crop&w=900&q=85', 840, null, 80, 1, '12 × 100g', true],
  ['Ginger Beer 330ml', 'ginger-beer-330ml', 'DRK-005', 'SipUp Picks', 'Drinks', 'A lively ginger kick with a smooth, warming finish.', 'https://images.unsplash.com/photo-1543255006-d6395b6f1171?auto=format&fit=crop&w=900&q=85', 720, null, 72, 1, '12 × 330ml', true],
  ['Cola Zero 330ml', 'cola-zero-330ml', 'DRK-006', 'SipUp Picks', 'Drinks', 'A familiar cola taste with no sugar, ready to chill and serve.', 'https://images.unsplash.com/photo-1622483767028-3f66f32aef97?auto=format&fit=crop&w=900&q=85', 960, 880, 120, 1, '24 × 330ml', false],
  ['Lemon Lime Soda 330ml', 'lemon-lime-soda-330ml', 'DRK-007', 'SipUp Picks', 'Drinks', 'Zesty lemon and lime with a crisp sparkling finish.', 'https://images.unsplash.com/photo-1513558161293-cdaf765edfd7?auto=format&fit=crop&w=900&q=85', 900, null, 96, 1, '24 × 330ml', false],
  ['Still Water 500ml', 'still-water-500ml', 'DRK-008', 'SipUp Picks', 'Drinks', 'Everyday still water in a convenient single-serve bottle.', 'https://images.unsplash.com/photo-1548839140-29a749e1cf4d?auto=format&fit=crop&w=900&q=85', 420, 380, 240, 1, '12 × 500ml', false],
  ['BBQ Ridged Crisps', 'bbq-ridged-crisps', 'SNK-003', 'SipUp Picks', 'Snacks', 'Crunchy ridged crisps with a smoky barbecue-style seasoning.', 'https://images.unsplash.com/photo-1573080496219-bb080dd4f877?auto=format&fit=crop&w=900&q=85', 899, 799, 144, 1, '20 × 40g', false],
  ['Roasted Salted Peanuts', 'roasted-salted-peanuts', 'SNK-004', 'SipUp Picks', 'Snacks', 'Roasted peanuts with a simple salted finish for savoury shelves.', 'https://images.unsplash.com/photo-1567892737950-30c4db37cd89?auto=format&fit=crop&w=900&q=85', 1250, null, 96, 1, '12 × 150g', false],
  ['Sweet & Salty Popcorn', 'sweet-salty-popcorn', 'SNK-005', 'SipUp Picks', 'Snacks', 'A light, crunchy popcorn mix with sweet and savoury notes.', 'https://images.unsplash.com/photo-1578849278619-e73505e9610f?auto=format&fit=crop&w=900&q=85', 1080, 980, 100, 1, '12 × 80g', false],
  ['Gummy Bears', 'gummy-bears', 'SWT-002', 'SipUp Picks', 'Sweets', 'Colourful fruit-flavoured gummy sweets in a shareable bag.', 'https://images.unsplash.com/photo-1582058091505-f87a2e55a40f?auto=format&fit=crop&w=900&q=85', 960, 850, 100, 1, '12 × 150g', false],
  ['Fruit Lollies', 'fruit-lollies', 'SWT-003', 'SipUp Picks', 'Sweets', 'A bright assortment of fruit lollies for the counter display.', 'https://images.unsplash.com/photo-1581798459219-318e76aecc7b?auto=format&fit=crop&w=900&q=85', 720, null, 120, 1, '24 lollies', false],
  ['Sour Fruit Gummies', 'sour-fruit-gummies', 'SWT-004', 'SipUp Picks', 'Sweets', 'Chewy fruit gummies with a tangy sugar coating.', 'https://images.unsplash.com/photo-1582058091505-f87a2e55a40f?auto=format&fit=crop&w=900&q=85', 1080, 950, 84, 1, '12 × 150g', false],
  ['Caramel Bites', 'caramel-bites', 'SWT-005', 'SipUp Picks', 'Sweets', 'Soft caramel-style bites individually wrapped for easy sharing.', 'https://images.unsplash.com/photo-1606313564200-e75d5e30476c?auto=format&fit=crop&w=900&q=85', 1320, null, 72, 1, '24 pieces', false],
  ['Sugar Free Energy 250ml', 'sugar-free-energy-250ml', 'NRG-002', 'SipUp Picks', 'Energy', 'A crisp, sugar-free energy drink in a compact chilled can.', 'https://images.unsplash.com/photo-1622543925917-763c34d1a86e?auto=format&fit=crop&w=900&q=85', 1080, 990, 120, 1, '24 × 250ml', false],
  ['Tropical Energy 250ml', 'tropical-energy-250ml', 'NRG-003', 'SipUp Picks', 'Energy', 'Tropical fruit-inspired flavour with a lively sparkling finish.', 'https://images.unsplash.com/photo-1622543925917-763c34d1a86e?auto=format&fit=crop&w=900&q=85', 1080, null, 96, 1, '24 × 250ml', false],
  ['Berry Energy 250ml', 'berry-energy-250ml', 'NRG-004', 'SipUp Picks', 'Energy', 'A bold berry-style energy drink for a colourful fridge range.', 'https://images.unsplash.com/photo-1622543925917-763c34d1a86e?auto=format&fit=crop&w=900&q=85', 1080, 990, 96, 1, '24 × 250ml', false],
  ['Citrus Energy 250ml', 'citrus-energy-250ml', 'NRG-005', 'SipUp Picks', 'Energy', 'Bright citrus-style flavour in a convenient wholesale case.', 'https://images.unsplash.com/photo-1622543925917-763c34d1a86e?auto=format&fit=crop&w=900&q=85', 1080, null, 72, 1, '24 × 250ml', false],
]

try {
  await pool.query(`
    INSERT IGNORE INTO products
      (name, slug, sku, brand, category_id, description, price_gbp, sale_price_gbp,
       stock_quantity, min_quantity, pack_size, is_featured)
    VALUES ${products.map(() => '(?,?,?, ?, (SELECT id FROM categories WHERE name = ? LIMIT 1), ?, ?, ?, ?, ?, ?, ?)').join(',')}
  `, products.flatMap(([name, slug, sku, brand, category, description, image, price, sale, stock, minimum, pack, featured]) => [
    name, slug, sku, brand, category, description, (price / 100).toFixed(2),
    sale === null ? null : (sale / 100).toFixed(2), stock, minimum, pack, featured,
  ]))
  for (const product of products) {
    await pool.query(`
      INSERT INTO product_images (product_id, image_url, alt_text)
      SELECT id, ?, ? FROM products WHERE sku = ? AND NOT EXISTS
        (SELECT 1 FROM product_images pi WHERE pi.product_id = products.id)
    `, [product[6], product[0], product[2]])
    await pool.query(`
      INSERT INTO stock_movements (product_id, quantity_delta, reason, actor)
      SELECT p.id, p.stock_quantity, 'development_seed', 'seed'
      FROM products p WHERE p.sku = ? AND p.stock_quantity > 0 AND NOT EXISTS
        (SELECT 1 FROM stock_movements sm WHERE sm.product_id = p.id AND sm.reason = 'development_seed')
    `, [product[2]])
  }
  console.log('Development products are seeded (existing SKUs were preserved).')
} catch (error) {
  console.error('Seed failed:', error.message)
  process.exitCode = 1
} finally {
  await pool.end()
}
