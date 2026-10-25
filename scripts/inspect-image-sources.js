import { readdir, readFile } from 'node:fs/promises'
const pattern = new RegExp(process.argv[2], 'i')
for(const f of await readdir('reports/product-images/sources')) {
 const items=JSON.parse(await readFile(`reports/product-images/sources/${f}`,'utf8'))
 for(const p of items.filter(p=>pattern.test(p.title))) console.log(`${p.title} | ${p.images?.[0]?.width}x${p.images?.[0]?.height} | ${p.url}`)
}
