import { readFile, readdir, writeFile } from 'node:fs/promises'

const norm = s => s.toLowerCase().replace(/&/g,' and ').replace(/mike\s*(and)?\s*ike/g,'mike ike').replace(/\b(taxis)\b/g,'takis').replace(/jolly jose/g,'jolly joes').replace(/rancer/g,'rancher').replace(/sherbert/g,'sherbet').replace(/\bsor\b/g,'sour').replace(/7 leyer/g,'7 layer').replace(/smokey/g,'smoky').replace(/gold bears/g,'goldbears').replace(/[^a-z0-9.]+/g,' ').trim()
const tokens = s => norm(s).split(' ').filter(w=>w.length>1 && !['tb','cans','can','peg','bag','china','eu','malaysian','5pk','vh','and','kids','original'].includes(w) && !/\d/.test(w))
const products=JSON.parse(await readFile('reports/product-images/products.json','utf8'))
const sources=(await Promise.all((await readdir('reports/product-images/sources')).filter(f=>f.endsWith('.json')).map(async f=>JSON.parse(await readFile(`reports/product-images/sources/${f}`,'utf8'))))).flat()
for(const s of sources) {s.normalTitle=norm(s.title);s.terms=tokens(s.title);s.sizeText=norm(s.title+' '+s.body).replace(/\s/g,'')}
const result=products.map(p=>{
 const terms=tokens(p.name)
 const candidates=sources.map(s=>{
   const title=s.normalTitle, t=s.terms
   const hits=terms.filter(x=>t.includes(x)).length
   let score=hits/terms.length*100 - t.filter(x=>!terms.includes(x)).length*2
   if(!title.includes(terms[0])) score-=70
   const size=norm(p.catalogue_details.size).replace(/\s/g,'')
   if(s.sizeText.includes(size)) score+=12
   return {score:Math.round(score), title:s.title, url:s.url, image:s.images?.[0]?.src, width:s.images?.[0]?.width, height:s.images?.[0]?.height}
 }).filter(s=>s.image).sort((a,b)=>b.score-a.score).slice(0,6)
 return {id:p.id,name:p.name,size:p.catalogue_details.size,candidates}
})
await writeFile('reports/product-images/candidates.json',JSON.stringify(result,null,2))
console.log(result.map(p=>`${p.id}: ${p.name}\n${p.candidates.slice(0,3).map((c,i)=>`  ${i}: ${c.score} ${c.title} [${c.width}x${c.height}] ${c.url}`).join('\n')}`).join('\n'))
