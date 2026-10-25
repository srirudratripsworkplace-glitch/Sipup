import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import sharp from 'sharp'

const directory='reports/product-images'
const selections=JSON.parse(await readFile(`${directory}/selection.json`,'utf8'))
await mkdir(`${directory}/originals`,{recursive:true})
await mkdir('public/products/web',{recursive:true})
const errors=[]
let next=0
async function worker() {
 while(next<selections.length) {
  const p=selections[next++]
  try {
   const originalPath=`${directory}/originals/${p.id}.image`
   let data
   // Reuse only bytes from this exact source URL.
   const cached=JSON.parse(await readFile(`${directory}/originals/${p.id}.json`,'utf8').catch(()=>'null'))
   if(cached?.url===p.sourceImage) data=await readFile(originalPath)
   else {
    const response=await fetch(p.sourceImage,{signal:AbortSignal.timeout(30000)})
    if(!response.ok) throw new Error(`HTTP ${response.status}`)
    data=Buffer.from(await response.arrayBuffer())
    await sharp(data).metadata() // Reject HTML/challenge/error responses.
    await writeFile(originalPath,data)
    await writeFile(`${directory}/originals/${p.id}.json`,JSON.stringify({url:p.sourceImage}))
   }
   const original=await sharp(data).metadata()
   // Remove empty canvas around the photograph so packaging stays readable on cards.
   const output=await sharp(data).rotate().trim({threshold:8}).resize({width:1600,height:1600,fit:'inside',withoutEnlargement:true}).webp({quality:92,effort:5}).toBuffer()
   const metadata=await sharp(output).metadata()
   p.sha256=createHash('sha256').update(output).digest('hex')
   p.imageUrl=`/products/web/${p.id}-${p.sha256.slice(0,16)}.webp`
   await writeFile(`public${p.imageUrl}`,output)
   Object.assign(p,{width:metadata.width,height:metadata.height,originalWidth:original.width,originalHeight:original.height,bytes:output.length,status:'downloaded'})
  } catch(e) {p.status='download_failed';p.error=e.message;errors.push({id:p.id,error:e.message})}
 }
}
await Promise.all(Array.from({length:6},worker))
await writeFile(`${directory}/downloaded.json`,JSON.stringify(selections,null,2))
console.log(JSON.stringify({downloaded:selections.filter(p=>p.status==='downloaded').length,errors},null,2))
if(errors.length)process.exitCode=1
