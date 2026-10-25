import 'dotenv/config'
import { parseArgs } from 'node:util'
import { readFile, mkdir, copyFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { readProducts, makePlan, writeReports, digest } from '../server/catalogue-import/products.js'
import { extractCatalogue } from '../server/catalogue-import/extract.js'
import { applyPlan } from '../server/catalogue-import/store.js'
import { applyCrops } from '../server/catalogue-import/crops.js'
import { pool } from '../server/pool.js'

const {values: options} = parseArgs({ options: {
  workbook:{type:'string',default:'import-data/available-stock-list.xlsm'},
  catalogue:{type:'string',default:'import-data/Sipup_Combined_Catalogue.zip'},
  output:{type:'string',default:'reports/catalogue-import'},
  mapping:{type:'string'}, 'price-mode':{type:'string'},
  'dry-run':{type:'boolean',default:true}, commit:{type:'boolean',default:false}, approve:{type:'string'},
  'reuse-images':{type:'boolean',default:false},
  'include-review-as-drafts':{type:'boolean',default:false},
} })
try {
  if (options.commit && process.argv.includes('--dry-run')) throw new Error('Choose --dry-run or --commit, not both.')
  if (options['price-mode'] && !['exclusive','inclusive'].includes(options['price-mode'])) throw new Error('Price mode must be exclusive or inclusive.')
  const source = await readProducts(options.workbook)
  const inventory = options['reuse-images'] ? JSON.parse(await readFile(join(options.output,'image-inventory.json'),'utf8')) : await extractCatalogue(options.catalogue,options.output)
  if (options['reuse-images']) {
    const { hash } = await import('../server/catalogue-import/extract.js')
    if (hash(await readFile(options.catalogue))!==inventory.zipHash) throw new Error('Cached images do not match this catalogue ZIP.')
  }
  const mappings = options.mapping ? JSON.parse(await readFile(options.mapping,'utf8')) : {}
  if (options.mapping && (mappings.pdfHash!==inventory.pdfHash || mappings.workbookHash!==source.workbookHash)) throw new Error('Image mapping does not match workbook/PDF fingerprints.')
  await applyCrops(inventory,mappings,options.output)
  const existing = await pool.query('SELECT id,sku,slug,name,stock_quantity FROM products')
  const variants = await pool.query('SELECT sku FROM product_variants')
  const plan = makePlan(source,inventory,existing.rows,mappings,options['price-mode'] || null)
  for(const row of plan.records) {
    if(variants.rows.some(v=>v.sku===row.sku)) {row.status='invalid';row.warnings.push('SKU collides with an existing variant.')}
    if(existing.rows.some(p=>p.slug===row.slug&&p.sku!==row.sku)) {row.status='invalid';row.warnings.push('Slug collides with an existing product.')}
  }
  // Include source paths in the digest shown for approval.
  delete plan.approvalDigest
  plan.inputs={workbook:resolve(options.workbook),catalogue:resolve(options.catalogue)}
  plan.importPolicy={includeReviewAsDrafts:options['include-review-as-drafts']}
  plan.approvalDigest=digest(plan)
  await writeReports(plan,options.output)
  // Publishing image files is independent of writing product/inventory rows.
  // Only visually reviewed matches are copied; filenames are content hashes.
  await mkdir('public/products',{recursive:true})
  for(const row of plan.records.filter(r=>r.image)) {
    const { hash }=await import('../server/catalogue-import/extract.js')
    const path=join(options.output,'images',row.image.filename)
    if(hash(await readFile(path))!==row.image.hash) throw new Error('Image content differs from reviewed asset.')
    await copyFile(path,join('public/products',row.image.filename))
  }
  if(options.commit) {
    if(!options.approve) throw new Error('Live import requires --approve with the exact reviewed preview digest.')
    // No migration or schema creation is performed by either import mode.
    const columns=await pool.query("SHOW COLUMNS FROM products LIKE 'catalogue_details'")
    if(!columns.rowCount) throw new Error('Apply migration 005 after preview approval before live import.')
    if(options.approve!==plan.approvalDigest) throw new Error('Preview has changed since approval; review the new reports.')
    const result=await applyPlan(pool,plan,options.approve,{includeReviewAsDrafts:options['include-review-as-drafts']})
    await writeFile(join(options.output,'import-result.json'),JSON.stringify(result,null,2))
    console.log(JSON.stringify(result,null,2))
  } else console.log(JSON.stringify({mode:'DRY RUN — no database writes',...plan.summary,approvalDigest:plan.approvalDigest,reports:resolve(options.output)},null,2))
} catch(error) { console.error(error.message);process.exitCode=1 }
finally {await pool.end()}
