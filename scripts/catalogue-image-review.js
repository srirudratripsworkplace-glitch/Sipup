// Rebuilds the source-pinned image review manifest from the inspected catalogue.
// Does not connect to MySQL or import products.
import { readProducts } from '../server/catalogue-import/products.js'
import { readFile, writeFile } from 'node:fs/promises'
const source=await readProducts('server/catalogue-import/available-stock-list.xlsm')
const inv=JSON.parse(await readFile('reports/catalogue-import/image-inventory.json','utf8'))
if(inv.pdfHash!=='e2c2b3aa15551104ea4c5b93f8dc8613d0e518819872f5f39fe0d10f4ac2361e') throw new Error('PDF changed; image review must be repeated.')
if(source.workbookHash!=='f3ac1925da789cfb239d7cf5da4ccb5ab125d94aabb23000fd4a4f3235592f47') throw new Error('Workbook changed; review associations before rebuilding.')
const mapping={workbookHash:source.workbookHash,pdfHash:inv.pdfHash,reviewNote:'Image associations inspected against packaging, nearby labels, headings and source pack identity. This does not approve any database import.',brands:{},images:{},products:{},crops:[]}
const entries=[[2,'p1-5'],[3,'p1-6'],[4,'p1-7'],[5,'p1-8'],[7,'p1-10'],[8,'p1-11'],[9,'p1-12'],[10,'p1-14'],[11,'p1-13'],[14,'p1-4'],[15,'p2-2'],[16,'p2-3'],[17,'p2-4'],[18,'p2-6'],[19,'p2-5'],[20,'p2-7'],[21,'p2-8'],[22,'p2-9'],[23,'p2-10'],[24,'p2-11'],[25,'p3-3'],[26,'p3-4'],[27,'p3-5'],[28,'p3-6'],[29,'p3-7'],[30,'p3-8'],[31,'p3-15'],[32,'p3-14'],[33,'p3-2'],[34,'p3-20'],[35,'p3-11'],[36,'p3-12'],[37,'p3-9'],[38,'p3-13'],[39,'p3-10'],[40,'p3-21'],[41,'p3-22'],[42,'p3-16'],[43,'p3-17'],[44,'p4-9'],[46,'p4-12'],[47,'p4-13'],[49,'p4-10'],[50,'p4-14'],[51,'p5-7'],[52,'p5-9'],[53,'p5-10'],[54,'p5-11'],[55,'p5-12'],[56,'p5-8'],[57,'p5-20'],[58,'p5-19'],[59,'p5-13'],[60,'p5-14'],[61,'p5-15'],[62,'p6-7'],[63,'p6-6'],[64,'p6-5'],[65,'p6-8'],[66,'p6-9'],[67,'p6-10'],[68,'p6-11'],[69,'p6-12'],[70,'p6-14'],[71,'p6-15'],[72,'p6-16'],[73,'p6-13']]
const inspectedIds={35:'p3-10',36:'p3-11',37:'p3-12',39:'p3-9',51:'p5-8',52:'p5-10',53:'p5-11',54:'p5-12',55:'p5-13',56:'p5-9',59:'p5-14',60:'p5-15',61:'p5-16'}
for(const[row,originalId]of entries){const id=inspectedIds[row]||originalId;const r=source.rows.find(r=>r.row===row);mapping.images[r.sku]={assetId:id,assetHash:inv.assets.find(a=>a.id===id).hash,confirmed:true,evidence:`Catalogue page ${id.split('-')[0].slice(1)}: packaging/flavour inspected against heading; ${r.size}, case ${r.units}.`}}
const crops=[
  [152,'p7-1',[165,302,155,460]],[153,'p7-1',[530,315,160,455]],[154,'p7-1',[890,300,165,465]],
  [155,'p7-1',[160,975,160,440]],[156,'p7-1',[495,950,180,460]],[157,'p7-1',[890,965,165,450]],
  [142,'p11-1',[108,318,302,425]],[143,'p11-1',[438,317,329,429]],[144,'p11-1',[800,318,322,435]],
  [145,'p11-1',[248,950,312,408]],[146,'p11-1',[637,950,300,410]],
  [147,'p12-1',[107,365,311,410],false],[148,'p12-1',[468,360,294,405],false],[149,'p12-1',[803,360,309,405],false],
  [150,'p12-1',[204,1005,311,413],false],[151,'p12-1',[663,998,312,410],false],
  [158,'p15-1',[423,529,345,498]],[137,'p16-1',[775,260,375,392]],[136,'p16-1',[192,939,346,387]],
  [139,'p16-1',[395,261,360,391],false],
]
for(const[row,parent,rect,confirmed=true]of crops){const r=source.rows.find(r=>r.row===row);const id=`crop-row-${row}`;const evidence=confirmed?`Product packaging and matching flavour/pack caption inspected on page ${parent.split('-')[0].slice(1)}; crop excludes surrounding text.`:'Candidate crop: source weight/name differs from catalogue label; requires administrator review.';mapping.crops.push({id,parent,rect,evidence});mapping.images[r.sku]={assetId:id,confirmed,evidence}}
for(const[row,id,reason]of [[6,'p1-9','Source Jolly Jose differs from packaging Jolly Joes.'],[12,'p1-15','Embedded image includes a catalogue caption; crop needs review.'],[13,'p1-3','Packaging weight differs from heading/source.'],[45,'p4-11','Source Strawberry differs from packaging Strawberry Kiwi.']]){const r=source.rows.find(r=>r.row===row);mapping.images[r.sku]={assetId:id,confirmed:false,evidence:reason}}
mapping.brands={
  'Mike & Ike TB':'Mike & Ike','Hot Tamales':'Hot Tamales','Airheads':'Airheads','Laffy Taffy':'Laffy Taffy',
  'Fanta Cans':'Fanta','Coca Cola':'Coca-Cola','Sprite Chill':'Sprite','Pepsi':'Pepsi','Dr Pepper':'Dr Pepper','7up':'7UP',
  'Malaysian Fanta Can':'Fanta','Mirinda Can':'Mirinda','Fanta':'Fanta','Monster':'Monster','Monster Java':'Monster',
  'China Fanta':'Fanta','China Fanta EU':'Fanta','Gushers':'Gushers','Roll ups':'Fruit Roll-Ups','Faygo':'Faygo',
  'Pascall Cadbury':'Pascall / Cadbury','Samyang Noodles 5pk':'Samyang',
}
await writeFile('server/catalogue-import/image-review.json',JSON.stringify(mapping,null,2))
console.log(JSON.stringify({associations:Object.keys(mapping.images).length,verified:Object.values(mapping.images).filter(x=>x.confirmed).length,crops:mapping.crops.length}))
