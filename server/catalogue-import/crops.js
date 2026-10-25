import sharp from 'sharp'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { hash } from './extract.js'

export async function applyCrops(inventory, mapping, output) {
  for (const crop of mapping.crops || []) {
    const parent = inventory.assets.find(a=>a.id===crop.parent)
    if(!parent || !/^[a-z0-9-]+$/i.test(crop.id)) throw new Error('Unknown or invalid crop asset.')
    const [left,top,width,height]=crop.rect
    if(![left,top,width,height].every(Number.isInteger) || left<0 || top<0 || width<1 || height<1
      || left+width>parent.pixelWidth || top+height>parent.pixelHeight) throw new Error(`Invalid crop: ${crop.id}`)
    const source=await readFile(join(output,'sources',`${parent.id}.png`))
    const webp=await sharp(source).extract({left,top,width,height}).resize({width:1000,height:1000,fit:'inside',withoutEnlargement:true}).webp({quality:88}).toBuffer()
    const digest=hash(webp),filename=`${digest}.webp`
    await writeFile(join(output,'images',filename),webp)
    inventory.assets.push({...parent,id:crop.id,filename,hash:digest,bytes:webp.length,pixelWidth:width,pixelHeight:height,
      crop:{parent:parent.id,rect:crop.rect},evidence:crop.evidence})
  }
  return inventory
}
