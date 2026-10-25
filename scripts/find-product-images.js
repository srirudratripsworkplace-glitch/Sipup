import { mkdir, writeFile } from 'node:fs/promises'

const stores = process.argv.slice(2)
await mkdir('reports/product-images/sources', { recursive: true })
for (const store of stores) {
  const products = []
  try {
    for (let page = 1; page <= 30; page++) {
      const response = await fetch(`https://${store}/products.json?limit=250&page=${page}`, { signal: AbortSignal.timeout(30000) })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = await response.json()
      if (!data.products?.length) break
      products.push(...data.products.map(p => ({ title: p.title, handle: p.handle, body: p.body_html, variants: p.variants?.map(v => ({ title: v.title, sku: v.sku, grams: v.grams })), images: p.images, url: `https://${store}/products/${p.handle}` })))
      if (data.products.length < 250) break
    }
    await writeFile(`reports/product-images/sources/${store}.json`, JSON.stringify(products, null, 2))
    console.log(`${store}: ${products.length} products`)
  } catch (e) { console.log(`${store}: ${e.message}`) }
}
