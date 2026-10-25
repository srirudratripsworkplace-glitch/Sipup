import { digest } from './products.js'

const gbp = (pence) => (pence / 100).toFixed(2)
async function category(connection, name, parentId = null, parentName = '') {
  const found = await connection.query('SELECT id FROM categories WHERE LOWER(TRIM(name))=LOWER(?) AND parent_id <=> ? LIMIT 1', [name,parentId])
  if (found.rowCount) return found.rows[0].id
  const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g,'-').slice(0,75)}-${digest([parentName,name]).slice(0,12)}`
  const result = await connection.query('INSERT INTO categories (name,slug,parent_id) VALUES (?,?,?) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)',[name,slug,parentId])
  return result.insertId
}

// The CLI never calls this without explicit --commit and the exact reviewed
// preview digest. Existing SKUs are intentionally a no-op, including inventory.
export async function applyPlan(pool, plan, approvalDigest, { includeReviewAsDrafts = false } = {}) {
  const { approvalDigest: expected, ...unsigned } = plan
  if (approvalDigest !== expected || digest(unsigned) !== expected) throw new Error('Approval digest does not match the reviewed preview.')
  if (plan.records.some(r=>!['ready','preserved',...(includeReviewAsDrafts?['review']:[])].includes(r.status))) throw new Error('Resolve every review/invalid row before committing, or explicitly import review rows as drafts.')
  if(plan.records.some(r=>!r.existingId && (!r.tax || !['exclusive','inclusive'].includes(r.priceMode)
    || !r.treatment || !Number.isSafeInteger(r.tax.netPence) || r.tax.netPence<0
    || r.errors.length || (r.priceMode==='inclusive' && r.warnings.some(w=>w.includes('not representable')))))) {
    throw new Error('Invalid or unresolved monetary data cannot be imported, including as drafts.')
  }
  const client = await pool.connect()
  let locked = false
  try {
    const lock = await client.query("SELECT GET_LOCK('sipup_catalogue_import',10) AS acquired")
    if (Number(lock.rows[0].acquired)!==1) throw new Error('Another catalogue import is running.')
    locked = true
    await client.query('BEGIN')
    let created = 0, preserved = 0
    for (const row of plan.records) {
      const existing = await client.query('SELECT id FROM products WHERE sku=? FOR UPDATE',[row.sku])
      if (existing.rowCount) { preserved++; continue }
      if (row.existingId) throw new Error('Previously matched existing product is no longer present.')
      const root = await category(client,row.category)
      const categoryId = row.subcategory ? await category(client,row.subcategory,root,row.category) : root
      const metadata = { source_name:row.sourceName,source_cells:row.raw,source_row:row.row,source_hash:plan.workbookHash,
        identity:row.key,size:row.size,flavour:row.flavour,units_per_case:row.units,selling_unit:'case',source_unit_price_pence:row.unitPricePence,
        price_mode:row.priceMode,source_vat:row.vatRaw,expiry_date:row.expiry,
        review_warnings:row.warnings, image_status:row.image?'matched':'requires_review',imported_as_draft:true }
      const result = await client.query(`INSERT INTO products
        (category_id,name,slug,sku,brand,description,price_gbp,vat_treatment,vat_rate,vat_confirmed,price_entry_mode,
        stock_quantity,min_quantity,pack_size,is_published,catalogue_details)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,20,1,?,FALSE,?)`,[categoryId,row.name,row.slug,row.sku,row.brand,'',gbp(row.tax.netPence),
        row.treatment,row.tax.rate,false,row.priceMode,`Case of ${row.units} × ${row.size}`,metadata])
      if (row.image) await client.query('INSERT INTO product_images (product_id,image_url,alt_text,sort_order) VALUES (?,?,?,0)',[result.insertId,`/products/${row.image.filename}`,row.name])
      await client.query('INSERT INTO stock_movements (product_id,quantity_delta,reason,actor) VALUES (?,20,?,?)',[result.insertId,'catalogue_import_initial_cases','catalogue-import'])
      await client.query('INSERT INTO audit_logs (action,entity_type,entity_id,details) VALUES (?,?,?,?)',['catalogue_import','product',result.insertId,{approvalDigest:expected,sku:row.sku,stock_cases:20,metadata}])
      created++
    }
    await client.query('INSERT INTO audit_logs (action,entity_type,details) VALUES (?,?,?)',[
      'catalogue_import_completed','catalogue_import',{approvalDigest:expected,workbookHash:plan.workbookHash,created,preserved,failed:0,summary:plan.summary}])
    await client.query('COMMIT')
    return {created,preserved}
  } catch(error) { await client.query('ROLLBACK'); throw error }
  finally { if(locked) await client.query("SELECT RELEASE_LOCK('sipup_catalogue_import')"); client.release() }
}
