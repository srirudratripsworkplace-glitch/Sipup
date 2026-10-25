import { readFile, writeFile } from 'node:fs/promises'
import { createCanvas, loadImage } from '@napi-rs/canvas'

const rows=JSON.parse(await readFile('reports/product-images/downloaded.json','utf8'))
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
for(let start=0;start<rows.length;start+=24) {
 const batch=rows.slice(start,start+24)
 const canvas=createCanvas(1500,1200),ctx=canvas.getContext('2d')
 ctx.fillStyle='#fff';ctx.fillRect(0,0,1500,1200)
 for(let n=0;n<batch.length;n++) {
  const p=batch[n],x=(n%6)*250,y=Math.floor(n/6)*300
  ctx.strokeStyle='#ddd';ctx.strokeRect(x,y,250,300)
  if(p.imageUrl) {
   const image=await loadImage(`public${p.imageUrl}`)
   const scale=Math.min(224/image.width,220/image.height)
   ctx.drawImage(image,x+(250-image.width*scale)/2,y+8+(220-image.height*scale)/2,image.width*scale,image.height*scale)
  }
  ctx.fillStyle='#111';ctx.font='bold 13px Arial'
  const words=`${p.id}: ${p.name}`.split(' ')
  let line='',lineY=y+245
  for(const word of words) {
   if(ctx.measureText(`${line} ${word}`).width>233) {ctx.fillText(line,x+8,lineY);lineY+=15;line=word}
   else line+=(line?' ':'')+word
  }
  ctx.fillText(line,x+8,lineY)
  ctx.font='12px Arial';ctx.fillStyle='#555';ctx.fillText(`Photo: ${p.sourceSize} | ${p.width}×${p.height}`,x+8,y+288)
 }
 await writeFile(`reports/product-images/review-${Math.floor(start/24)+1}.png`,canvas.toBuffer('image/png'))
}
const html=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SipUp product image review</title><style>body{font:15px system-ui;margin:32px;color:#1b2924;background:#f5f6f3}h1{font-size:28px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:20px}article{background:white;padding:18px;border-radius:12px;border:1px solid #ddd}img{width:100%;height:260px;object-fit:contain}p{line-height:1.5}small{color:#52645c}a{color:#176541}.note{color:#825009}</style><h1>SipUp: product image review</h1><p>${rows.length} products. Photos downloaded from linked supplier listings. Where sizes differ, the same flavour packaging is used with the owner's permission. The listed selling size and case quantity are unchanged.</p><div class="grid">${rows.map(p=>`<article><img loading="lazy" src="../../public${escape(p.imageUrl)}" alt="${escape(p.name)}"><h2>${escape(p.name)}</h2><p>Catalog: <b>${escape(p.catalogueSize)}</b><br>Source packaging: <b>${escape(p.sourceSize)}</b></p><p class="note">${escape(p.note)}</p><p><a href="${escape(p.sourcePage)}" target="_blank" rel="noreferrer">${escape(p.sourceTitle)}</a></p><small>${p.width} × ${p.height} · ${Math.round(p.bytes/1024)} KB</small></article>`).join('')}</div></html>`
await writeFile('reports/product-images/review.html',html)
const csv=[['id','sku','product','catalogue_size','source_packaging_size','source_title','source_page','source_image','local_image','notes'],...rows.map(p=>[p.id,p.sku,p.name,p.catalogueSize,p.sourceSize,p.sourceTitle,p.sourcePage,p.sourceImage,p.imageUrl,p.note])].map(row=>row.map(v=>`"${String(v??'').replaceAll('"','""')}"`).join(',')).join('\r\n')
await writeFile('reports/product-images/image-sources.csv',csv)
console.log(`Created review.html, image-sources.csv and ${Math.ceil(rows.length/24)} contact sheets.`)
