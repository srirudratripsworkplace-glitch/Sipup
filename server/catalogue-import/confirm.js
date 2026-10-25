import { calculatePrice } from '../../shared/vat.js'
import { money } from './products.js'

// Confirmation changes visibility and price-entry metadata only. Canonical net
// prices, per-row tax rates, stock, identifiers and historical orders are untouched.
export async function confirmCatalogue(pool, source, {commit=false}={}) {
  if(!source.rows.length || new Set(source.rows.map(r=>r.sku)).size!==source.rows.length) throw new Error('Empty or duplicate source identities.')
  const client=await pool.connect()
  let locked=false
  try {
    const lock=await client.query("SELECT GET_LOCK('sipup_catalogue_import',10) AS acquired")
    if(Number(lock.rows[0].acquired)!==1) throw new Error('Another catalogue operation is running.')
    locked=true
    await client.query('BEGIN')
    const validated=[]
    for(const row of source.rows) {
      if(row.errors.length || !row.treatment || !Number.isSafeInteger(row.pricePence) || row.pricePence<=0) throw new Error(`Invalid Excel row ${row.row}.`)
      const saved=(await client.query('SELECT p.*,c.is_active AS category_active FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.sku=? FOR UPDATE',[row.sku])).rows[0]
      if(!saved) throw new Error(`Missing imported product ${row.sku}.`)
      const metadata=typeof saved.catalogue_details==='string'?JSON.parse(saved.catalogue_details):saved.catalogue_details
      const tax=calculatePrice(row.pricePence,'exclusive',row.treatment)
      if(metadata?.source_hash!==source.workbookHash || metadata?.source_row!==row.row || metadata?.identity!==row.key) throw new Error(`Source provenance mismatch: ${row.sku}.`)
      if(money(saved.price_gbp)!==row.pricePence || (saved.vat_rate===null || Number(saved.vat_rate)!==tax.rate) || saved.vat_treatment!==row.treatment) throw new Error(`Saved net price/VAT differs from Excel: ${row.sku}.`)
      if(!saved.name?.trim() || !saved.slug || !saved.category_active || metadata.units_per_case!==row.units || metadata.selling_unit!=='case') throw new Error(`Required product data invalid: ${row.sku}.`)
      validated.push({row,saved,metadata,tax})
    }
    const result={products:validated.length,standard:validated.filter(v=>v.tax.rate===20).length,zero:validated.filter(v=>v.tax.rate===0).length,
      newly_published:validated.filter(v=>!v.saved.is_published).length,confirmed:true,committed:commit,workbookHash:source.workbookHash,
      records:validated.map(({row,saved,tax})=>({id:saved.id,sku:row.sku,source_row:row.row,net_pence:row.pricePence,vat_rate:tax.rate,vat_pence:tax.vatPence,gross_pence:tax.grossPence,stock_cases:saved.stock_quantity}))}
    if(commit) {
      for(const {saved,metadata} of validated) {
        if(saved.is_published && saved.vat_confirmed && saved.price_entry_mode==='exclusive' && metadata.vat_confirmation?.workbookHash===source.workbookHash) continue
        const details={...metadata,price_mode:'exclusive',vat_confirmation:{basis:'Owner confirmed Excel prices exclude VAT; use each source row VAT rate.',workbookHash:source.workbookHash,confirmed_at:new Date().toISOString()}}
        await client.query("UPDATE products SET vat_confirmed=TRUE,is_published=TRUE,price_entry_mode='exclusive',catalogue_details=? WHERE id=?",[details,saved.id])
        await client.query('INSERT INTO audit_logs (action,entity_type,entity_id,details) VALUES (?,?,?,?)',['catalogue_vat_confirmed','product',saved.id,{before:{vat_confirmed:saved.vat_confirmed,is_published:saved.is_published,price_entry_mode:saved.price_entry_mode},confirmation:details.vat_confirmation}])
      }
      await client.query('INSERT INTO audit_logs (action,entity_type,details) VALUES (?,?,?)',['catalogue_publication_completed','catalogue_import',result])
      await client.query('COMMIT')
    } else await client.query('ROLLBACK')
    return result
  } catch(error) { await client.query('ROLLBACK');throw error }
  finally { if(locked) await client.query("SELECT RELEASE_LOCK('sipup_catalogue_import')");client.release() }
}
