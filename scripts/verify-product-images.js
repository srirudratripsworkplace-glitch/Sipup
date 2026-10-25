import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { pool } from '../server/pool.js'
import { app } from '../server/index.js'

let server
try {
 const expected=JSON.parse(await readFile('reports/product-images/downloaded.json','utf8'))
 server=app.listen(0,'127.0.0.1')
 await new Promise(resolve=>server.once('listening',resolve))
 const base=`http://127.0.0.1:${server.address().port}`
 const products=[]
 for(let page=1;;page++) {
  const response=await fetch(`${base}/api/products?limit=48&page=${page}`)
  assert.equal(response.status,200)
  const data=await response.json()
  products.push(...data.products)
  if(page>=data.pages)break
 }
 assert.equal(products.length,162)
 assert.equal(new Set(products.map(p=>p.id)).size,162)
 for(const p of products) {
  const image=expected.find(row=>row.id===p.id)
  assert.ok(image,`Missing mapping for ${p.id}`)
  assert.equal(p.image_url,image.imageUrl,`Wrong primary image for ${p.name}`)
  const response=await fetch(`${base}/api/products/${p.slug}`)
  assert.equal(response.status,200)
  const detail=await response.json()
  const saved=detail.product??detail
  assert.equal(saved.image_url,image.imageUrl)
  const photos=saved.images??detail.images
  assert.equal(photos.length,1)
  assert.equal(photos[0].image_url,image.imageUrl)
  const photo=await fetch(`${base}${image.imageUrl}`)
  assert.equal(photo.status,200,`Image not served for ${p.name}`)
  assert.match(photo.headers.get('content-type'),/^image\/webp/)
  const bytes=Buffer.from(await photo.arrayBuffer())
  assert.equal(createHash('sha256').update(bytes).digest('hex'),image.sha256)
 }
 const result={verifiedAt:new Date().toISOString(),publicProducts:products.length,correctPrimaryImages:162,correctDetailGalleries:162,httpImagesVerified:162,missingImages:0}
 await writeFile('reports/product-images/http-verification.json',JSON.stringify(result,null,2))
 console.log(JSON.stringify(result,null,2))
} finally {if(server)await new Promise(resolve=>server.close(resolve));await pool.end()}
