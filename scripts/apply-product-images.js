import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { pool } from '../server/pool.js'
import { persistImageUrl } from '../server/product-media.js'

const directory='reports/product-images'
const hash=value=>createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value)).digest('hex')
const commit=process.argv.includes('--commit')
let connection
try {
 const images=JSON.parse(await readFile(`${directory}/downloaded.json`,'utf8'))
 const review=JSON.parse(await readFile(`${directory}/visual-review.json`,'utf8'))
 if(images.length!==162 || new Set(images.map(p=>p.id)).size!==images.length) throw new Error('Expected 162 unique product image mappings.')
 if(review.manifestHash!==hash(images) || review.reviewed!==162) throw new Error('Image manifest differs from the visually reviewed version.')
 for(const p of images) {
  if(p.status!=='downloaded'||!/^\/products\/web\/\d+-[a-f0-9]{16}\.webp$/.test(p.imageUrl)) throw new Error(`Unready image ${p.id}`)
  const bytes=await readFile(`public${p.imageUrl}`)
  if(hash(bytes)!==p.sha256) throw new Error(`Image hash changed: ${p.id}`)
  const metadata=await sharp(bytes).metadata()
  if(metadata.format!=='webp'||metadata.width!==p.width||metadata.height!==p.height) throw new Error(`Invalid image ${p.id}`)
 }
 connection=await pool.connect()
 await connection.query('START TRANSACTION')
 const current=(await connection.query('SELECT * FROM products ORDER BY id FOR UPDATE')).rows
 for(const p of images) {
  const saved=current.find(row=>row.id===p.id)
  if(!saved||saved.sku!==p.sku||saved.name!==p.name) throw new Error(`Product identity changed: ${p.id}`)
 }
 const tableNames=(await connection.query('SHOW TABLES')).rows.map(row=>Object.values(row)[0])
 const protectedTables=['products','product_variants','stock_movements','orders','order_items','order_vat_breakdowns','payments','refunds','refund_tax_lines','categories','bulk_pricing','order_tax_snapshots','order_item_tax_snapshots'].filter(t=>tableNames.includes(t))
 async function fingerprints() {
  const result={}
  for(const table of protectedTables) {
   const rows=(await connection.query(`SELECT * FROM \`${table}\``)).rows
   result[table]={count:rows.length,sha256:hash(rows.map(row=>JSON.stringify(row)).sort())}
  }
  return result
 }
 const before=await fingerprints()
 const priorImages=(await connection.query('SELECT * FROM product_images ORDER BY id')).rows
 const backupFile=`${directory}/database-backup-${new Date().toISOString().replace(/[:.]/g,'-')}.json`
 if(commit) {
  await writeFile(backupFile,JSON.stringify({createdAt:new Date().toISOString(),protectedTables:before,images:priorImages},null,2))
  for(const p of images) {
   await connection.query('DELETE FROM product_images WHERE product_id=?',[p.id])
   await connection.query('INSERT INTO product_images (product_id,image_url,alt_text,sort_order) VALUES (?,?,?,0)',[p.id,await persistImageUrl(connection,p.imageUrl),p.name])
  }
 }
 const saved=(await connection.query('SELECT product_id,image_url,alt_text FROM product_images ORDER BY product_id,sort_order,id')).rows
 if(commit) for(const p of images) {
  const rows=saved.filter(row=>row.product_id===p.id)
  if(rows.length!==1||rows[0].image_url!==await persistImageUrl(connection,p.imageUrl)||rows[0].alt_text!==p.name) throw new Error(`Saved mapping verification failed: ${p.id}`)
 }
 const after=await fingerprints()
 if(JSON.stringify(before)!==JSON.stringify(after)) throw new Error('Product or business data changed unexpectedly.')
 await connection.query(commit?'COMMIT':'ROLLBACK')
 const report={mode:commit?'applied':'dry-run',completedAt:new Date().toISOString(),products:images.length,localFilesVerified:images.length,
  previousImageRows:priorImages.length,savedImageRows:saved.length,protectedDataUnchanged:true,before,after,...(commit?{backupFile}:{})}
 await writeFile(`${directory}/${commit?'application-result':'application-preview'}.json`,JSON.stringify(report,null,2))
 console.log(JSON.stringify(report,null,2))
} catch(e) {
 if(connection)await connection.query('ROLLBACK').catch(()=>{})
 console.error(e.message);process.exitCode=1
} finally {connection?.release();await pool.end()}
