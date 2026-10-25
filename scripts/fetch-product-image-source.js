import { readFile, writeFile } from 'node:fs/promises'
const file='reports/product-images/sources/individual.json'
let products=JSON.parse(await readFile(file,'utf8').catch(()=>'[]'))
for(const url of process.argv.slice(2)) {
 try {
  const r=await fetch(url+'.json',{signal:AbortSignal.timeout(20000)})
  if(!r.ok) throw new Error(`HTTP ${r.status}`)
  const {product:p}=await r.json()
  if(!p?.images?.length) throw new Error('No product images')
  const entry={title:p.title,handle:p.handle,body:p.body_html,variants:p.variants,images:p.images,url}
  products=products.filter(p=>p.url!==url);products.push(entry)
  console.log(`${p.title} | ${p.images[0].width}x${p.images[0].height}`)
 } catch(e) {console.log(`${url}: ${e.message}`)}
}
await writeFile(file,JSON.stringify(products,null,2))
