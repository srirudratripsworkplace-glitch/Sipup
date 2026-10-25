import ExcelJS from 'exceljs'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { calculatePrice } from '../../shared/vat.js'

export const clean = (v) => String(v ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ')
export const digest = (v) => createHash('sha256').update(typeof v === 'string' ? v : JSON.stringify(v)).digest('hex')
const slugify = (v) => clean(v).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')
export function identity(source) {
  const key = JSON.stringify([clean(source.name).toLowerCase(),clean(source.size).toLowerCase(),Number(source.units),clean(source.flavour).toLowerCase()])
  const hash = digest(key)
  return { key, hash, sku: `IMP-${hash.slice(0,20).toUpperCase()}`,
    slug: `${slugify(`${source.name} ${source.flavour} ${source.size} ${source.units} pack`).slice(0,120)}-${hash.slice(0,20)}` }
}
export function money(value) {
  const text = clean(value).replace(/^£\s*/, '')
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null
  const [whole, fraction=''] = text.split('.')
  const pence = Number(whole)*100 + Number(fraction.padEnd(2,'0'))
  return Number.isSafeInteger(pence) && pence <= 1_000_000_000 ? pence : null
}
export function treatment(value, format = '') {
  const text = clean(value).toLowerCase()
  if (['exempt','zero rated','zero-rated','standard','reduced'].includes(text)) return ({exempt:'exempt','zero rated':'zero','zero-rated':'zero',standard:'standard',reduced:'reduced'})[text]
  let rate = Number(text.replace('%',''))
  if (!text || !Number.isFinite(rate)) return null
  if (typeof value === 'number' && format.includes('%')) rate *= 100
  return ({20:'standard',5:'reduced',0:'zero'})[rate] || null
}
export async function readProducts(path) {
  const bytes = await readFile(path)
  if (!bytes.length) throw new Error(`Workbook is empty: ${path}. Supply --workbook with a populated file.`)
  if (bytes.length > 20_000_000) throw new Error('Workbook exceeds 20MB.')
  const workbook = new ExcelJS.Workbook()
  // ExcelJS reads cell data from OOXML; it does not execute VBA/macros.
  await workbook.xlsx.load(bytes)
  const sheet = workbook.getWorksheet('Stock List')
  if (!sheet) throw new Error('Stock List worksheet was not found.')
  if (sheet.rowCount > 20_000) throw new Error('Worksheet exceeds 20,000 rows.')
  const headers = ['product/brand','size','unitspercase','flavour/variant','price','vat','category','subcategory','unitprice','expirydate']
  headers.forEach((expected,i) => { if (clean(sheet.getRow(1).getCell(i+1).text).toLowerCase().replace(/\s/g,'') !== expected) throw new Error(`Unexpected column ${i+1}.`) })
  const rows = []; let skipped = 0
  sheet.eachRow((row,n) => {
    if (n === 1) return
    const raw = Array.from({ length: 10 }, (_,i) => row.getCell(i+1).value)
    if (!raw.some((v) => v !== null && clean(v))) { skipped++; return }
    const errors = []
    if (raw.some((v) => v && typeof v === 'object')) errors.push('Formula/complex cell requires review; not evaluated.')
    const [name,size,units,flavour,price,vat,category,subcategory,unitPrice,expiry] = raw
    if (!clean(name)) errors.push('Product name missing.')
    if (!Number.isInteger(Number(units)) || Number(units) < 1) errors.push('Invalid units per case.')
    const pricePence = money(price), unitPricePence = unitPrice == null || !clean(unitPrice) ? null : money(unitPrice)
    if (pricePence === null || pricePence === 0) errors.push('Invalid case price.')
    if (unitPrice != null && clean(unitPrice) && unitPricePence === null) errors.push('Invalid informational unit price.')
    if (!clean(category) || !clean(size)) errors.push('Category or size missing.')
    if (expiry != null && !['','-'].includes(clean(expiry))) errors.push('Nonblank expiry date needs explicit date parsing/review.')
    const source = { name: clean(name), size: clean(size), units: Number(units), flavour: clean(flavour), category: clean(category), subcategory: clean(subcategory) }
    const id = identity(source)
    rows.push({ ...source, ...id, row: n, raw, pricePence, unitPricePence, treatment: treatment(vat,row.getCell(6).numFmt),
      vatRaw: vat, vatFormat: row.getCell(6).numFmt, expiry: null, errors,
      unitMismatch: unitPricePence !== null && pricePence !== null && Math.abs(Math.round(pricePence / source.units)-unitPricePence)>1 })
  })
  return { rows, workbookHash: createHash('sha256').update(bytes).digest('hex'), sheet: sheet.name, skipped }
}

export const csv = (rows) => rows.map((row) => row.map((cell) => {
  let value = typeof cell === 'object' && cell !== null ? JSON.stringify(cell) : String(cell ?? '')
  if (/^[=+@\-\t\r]/.test(value)) value = `'${value}`
  return `"${value.replaceAll('"','""')}"`
}).join(',')).join('\r\n')+'\r\n'

export function makePlan(source, inventory, existing, mappings = {}, priceMode = null) {
  const duplicates = new Set(source.rows.filter((r,i,all) => all.some((s,j) => i!==j && s.key===r.key)).map((r) => r.key))
  const records = source.rows.map((r) => {
    const override = mappings.products?.[r.sku] || {}
    const sku = override.existingSku || r.sku
    const found = existing.find((p) => p.sku === sku)
    if (override.existingSku && !found) throw new Error(`Confirmed existing SKU not found: ${sku}`)
    const warnings = [...r.errors]
    if (duplicates.has(r.key)) warnings.push('Duplicate product identity.')
    if (!priceMode) warnings.push('Confirm inclusive/exclusive price mode.')
    if (!r.treatment) warnings.push('Unresolved VAT treatment.')
    if (r.unitMismatch && !override.acceptUnitMismatch) warnings.push('Source unit price differs from case price / units; review required.')
    const brand = clean(override.brand || mappings.brands?.[r.name] || '')
    if (!brand) warnings.push('Separate brand requires review; source name preserved.')
    const tax = priceMode && r.treatment && r.pricePence!==null ? calculatePrice(r.pricePence,priceMode,r.treatment) : null
    if (tax && priceMode==='inclusive' && calculatePrice(tax.netPence,'exclusive',r.treatment).grossPence!==r.pricePence) warnings.push('Inclusive price is not representable by canonical whole-penny net price.')
    const match = mappings.images?.[r.sku] || {}
    const asset = inventory.assets.find((a) => a.id===match.assetId)
    if(asset && match.assetHash && match.assetHash!==asset.hash) throw new Error(`Reviewed image changed for ${r.sku}.`)
    const image = asset && match.confirmed === true ? asset : null
    const candidates = suggestImages(r,inventory)
    if(asset && !image) candidates.unshift({assetId:asset.id,page:asset.page,label:match.evidence || 'Explicit unconfirmed candidate'})
    if (!image && !override.allowMissingImage) warnings.push(candidates.length ? 'Image association requires review.' : 'No matching image identified.')
    return { ...r, generatedSku: r.sku, sku, slug: found?.slug || r.slug, existingId: found?.id || null,
      action: found ? 'preserve_existing' : 'create', brand, name: clean([r.name,r.flavour,r.size].filter(Boolean).join(' ')),
      sourceName:r.name, priceMode, tax, initialStockCases: found ? null : 20,
      existingStock: found?.stock_quantity ?? null, image, candidates, warnings,
      status: r.errors.length || duplicates.has(r.key) ? 'invalid' : found ? 'preserved' : warnings.length ? 'review' : 'ready' }
  })
  const summary = { productRecords:records.length, structurallyValid:records.filter(r=>!r.errors.length).length,
    newProducts: records.filter(r=>!r.existingId).length, existingProducts:records.filter(r=>r.existingId).length,
    duplicateRecords:records.filter(r=>duplicates.has(r.key)).length,
    matchedImages:records.filter(r=>r.image).length, missingImages:records.filter(r=>!r.image).length,
    ambiguousImages:records.filter(r=>!r.image&&r.candidates.length).length,
    unmatchedProducts:records.filter(r=>!r.image&&!r.candidates.length).length,
    brandIssues:records.filter(r=>!r.brand).length, priceDiscrepancies:records.filter(r=>r.unitMismatch).length,
    vatIssues:records.filter(r=>!r.treatment).length, sourceVatUnconfirmed:records.filter(r=>!mappings.products?.[r.generatedSku]?.vatConfirmed).length,
    ready:records.filter(r=>r.status==='ready').length, requiresReview:records.filter(r=>r.status==='review').length,
    proposedInitialCases:records.filter(r=>!r.existingId).length*20 }
  const plan = { version:1, workbookHash:source.workbookHash, pdfHash:inventory.pdfHash, priceMode, summary, records }
  return { ...plan, approvalDigest: digest(plan) }
}

// Suggestions only. A flavour found elsewhere on a page never confirms an image.
export function suggestImages(product, inventory) {
  const normalize = (s) => clean(s).toLowerCase().replace(/&/g,'and').replace(/[^a-z0-9]/g,'')
  const flavour = normalize(product.flavour)
  if (!flavour) return []
  const candidates=[]
  for(const page of inventory.pages) {
    const context=normalize(page.texts.map(t=>t.text).join(' '))
    if (!context.includes(normalize(product.size))) continue
    for(const label of page.texts.filter(t=>normalize(t.text)===flavour)) {
      for(const asset of inventory.assets.filter(a=>a.page===page.page)) {
        const gap=asset.y-label.y, dx=Math.abs((asset.x+asset.width/2)-(label.x+label.width/2))
        if(gap>=-2 && gap<65 && dx<Math.max(asset.width/2,45)) candidates.push({assetId:asset.id,page:page.page,label:label.text,gap,dx})
      }
    }
  }
  return candidates.sort((a,b)=>(a.gap+a.dx)-(b.gap+b.dx)).slice(0,5)
}

export async function writeReports(plan, output) {
  await mkdir(output,{recursive:true})
  await writeFile(join(output,'preview.json'),JSON.stringify(plan,null,2))
  const header=['excel_row','sku','name','source_price_gbp','source_unit_price_gbp','price_mode','source_vat','vat_treatment','units_per_case','new_stock_cases','existing_stock_preserved','status','warnings']
  await writeFile(join(output,'products-preview.csv'),csv([header,...plan.records.map(r=>[r.row,r.sku,r.name,r.raw[4],r.raw[8],r.priceMode,r.vatRaw,r.treatment,r.units,r.initialStockCases,r.existingStock,r.status,r.warnings])]))
  await writeFile(join(output,'product-image-mapping.csv'),csv([['sku','name','status','image_asset_id','image_url','suggested_assets'],...plan.records.map(r=>[r.sku,r.name,r.image?'confirmed':'requires_review',r.image?.id,r.image?`/products/${r.image.filename}`:'',r.candidates.map(c=>c.assetId)])]))
  await writeFile(join(output,'unmatched-products.csv'),csv([['sku','name','reason'],...plan.records.filter(r=>!r.image&&!r.candidates.length).map(r=>[r.sku,r.name,'No sufficiently specific image suggestion'])]))
  await writeFile(join(output,'ambiguous-matches.csv'),csv([['sku','name','suggestions','reason'],...plan.records.filter(r=>!r.image&&r.candidates.length).map(r=>[r.sku,r.name,r.candidates,'Catalogue label proximity is a suggestion; confirm brand, size and flavour visually'])]))
  await writeFile(join(output,'summary.json'),JSON.stringify({ ...plan.summary,approvalDigest:plan.approvalDigest },null,2))
  const escape = (v) => String(v??'').replace(/[&<>"']/g,(s)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]))
  const cards=plan.records.map(r=>`<tr><td>${r.row}<br><code>${escape(r.sku)}</code></td><td>${escape(r.name)}<br><small>Brand: ${escape(r.brand||'Needs review')} · ${escape(r.category)} / ${escape(r.subcategory)}</small></td><td>${r.image?`<a href="images/${r.image.filename}"><img loading="lazy" src="images/${r.image.filename}" alt="${escape(r.name)}"></a><small>Inspected match</small>`:'No confirmed image'}${!r.image&&r.candidates[0]?`<small>Candidate: ${escape(r.candidates[0].assetId)} (unconfirmed)</small>`:''}</td><td>£${escape(r.raw[4])} / case<br><small>${r.units} × ${escape(r.size)}<br>Source unit price: ${r.raw[8]==null?'not supplied':'£'+escape(r.raw[8])}<br>Price mode: ${escape(r.priceMode||'UNCONFIRMED')}</small></td><td>${escape(r.treatment)}<br><small>Source: ${escape(r.vatRaw)} (${escape(r.vatFormat)})<br>Classification not confirmed for sale</small></td><td>${r.existingId?`Preserve ${r.existingStock}`:'20'} cases</td><td>${escape(r.status)}<ul>${r.warnings.map(w=>`<li>${escape(w)}</li>`).join('')}</ul></td></tr>`).join('')
  await writeFile(join(output,'preview.html'),`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>SipUp import preview</title><style>body{font:15px system-ui;margin:28px;color:#172b25;background:#fafaf5}h1{margin-bottom:8px}table{width:100%;border-collapse:collapse;background:white}th,td{padding:12px;border:1px solid #ddd;text-align:left;vertical-align:top}img{width:130px;height:140px;object-fit:contain}small{display:block;margin:6px 0;color:#526158}code{font-size:11px}li{margin:6px 0}input{padding:12px;margin:16px 0;width:min(500px,90%)}.scroll{overflow:auto}</style><h1>SipUp catalogue preview</h1><p>DRY RUN. No database changes. New products propose 20 cases each. Existing stock is preserved.</p><p>${plan.summary.productRecords} products · ${plan.summary.matchedImages} inspected image matches · ${plan.summary.priceDiscrepancies} price discrepancies</p><p>Approval digest: <code>${plan.approvalDigest}</code></p><input aria-label="Search products" placeholder="Search name, SKU or warnings" oninput="document.querySelectorAll('tbody tr').forEach(r=>r.hidden=!r.textContent.toLowerCase().includes(this.value.toLowerCase()))"><div class="scroll"><table><thead><tr><th>ROW / SKU</th><th>PRODUCT</th><th>IMAGE</th><th>SOURCE PRICES</th><th>VAT</th><th>STOCK</th><th>REVIEW</th></tr></thead><tbody>${cards}</tbody></table></div></html>`)
}
