import { pool } from '../server/pool.js'
import { mkdir, writeFile } from 'node:fs/promises'

try {
  const { rows } = await pool.query(`SELECT p.id,p.sku,p.name,p.pack_size,p.catalogue_details,
    (SELECT image_url FROM product_images WHERE product_id=p.id ORDER BY sort_order,id LIMIT 1) image
    FROM products p ORDER BY p.id`)
  await mkdir('reports/product-images', { recursive: true })
  await writeFile('reports/product-images/products.json', JSON.stringify(rows, null, 2))
  console.log(rows.map(p => `${p.id}: ${p.name} | ${p.pack_size}`).join('\n'))
} finally { await pool.end() }
