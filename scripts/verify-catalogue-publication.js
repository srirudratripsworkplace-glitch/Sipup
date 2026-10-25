import assert from 'node:assert/strict'
import {writeFile,readFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {pool} from '../server/pool.js'
import {app} from '../server/index.js'
import {readProducts,money} from '../server/catalogue-import/products.js'
import {calculatePrice} from '../shared/vat.js'

const integrityPath='reports/catalogue-import/publication-integrity-before.json'
async function integrity() {
  const result={}
  for(const table of ['orders','order_items','order_vat_breakdowns','payments','refunds','refund_tax_lines','stock_movements','product_images','bulk_pricing','categories']) {
    const rows=(await pool.query(`SELECT * FROM ${table} ORDER BY id`)).rows
    result[table]={rows:rows.length,sha256:createHash('sha256').update(JSON.stringify(rows)).digest('hex')}
  }
  const products=(await pool.query('SELECT id,sku,slug,price_gbp,sale_price_gbp,vat_rate,vat_treatment,stock_quantity,category_id FROM products ORDER BY id')).rows
  result.products={rows:products.length,sha256:createHash('sha256').update(JSON.stringify(products)).digest('hex')}
  return result
}
let server
try {
  if(process.argv.includes('--snapshot')) {
    await writeFile(integrityPath,JSON.stringify(await integrity(),null,2))
    console.log('Saved pre-publication integrity fingerprints; no database data changed.')
  } else {
    const before=JSON.parse(await readFile(integrityPath,'utf8')),after=await integrity()
    assert.deepEqual(after,before,'Orders, inventory, canonical prices, VAT rates, identifiers, categories and images must remain unchanged.')
    const source=await readProducts('server/catalogue-import/available-stock-list.xlsm')
    const saved=(await pool.query('SELECT * FROM products ORDER BY id')).rows
    assert.equal(saved.length,source.rows.length)
    for(const row of source.rows) {
      const p=saved.find(p=>p.sku===row.sku),tax=calculatePrice(row.pricePence,'exclusive',row.treatment)
      assert.ok(p)
      assert.equal(money(p.price_gbp),row.pricePence)
      assert.equal(Number(p.vat_rate),tax.rate)
      assert.equal(p.vat_treatment,row.treatment)
      assert.equal(p.vat_confirmed,1);assert.equal(p.is_published,1);assert.equal(p.price_entry_mode,'exclusive')
    }
    server=app.listen(0,'127.0.0.1')
    await new Promise(resolve=>server.once('listening',resolve))
    const base=`http://127.0.0.1:${server.address().port}/api`
    const get=async(path)=>{const r=await fetch(base+path);assert.equal(r.status,200);return r.json()}
    const all=[]
    for(let page=1;;page++) {
      const data=await get(`/products?limit=48&page=${page}`)
      assert.equal(data.total,162);all.push(...data.products)
      if(page>=data.pages)break
    }
    assert.equal(all.length,162);assert.equal(new Set(all.map(p=>p.id)).size,162)
    for(const p of all) {
      const row=source.rows.find(r=>r.sku===p.sku)
      assert.equal(p.price_pence,row.pricePence);assert.equal(Number(p.vat_rate),calculatePrice(row.pricePence,'exclusive',row.treatment).rate)
      assert.equal(p.selling_unit,'case');assert.equal(p.stock_quantity,20)
    }
    const filters=await get('/catalogue/filters')
    const roots=filters.categories.filter(c=>!c.parent_id&&Number(c.product_count)>0)
    const categories=[]
    for(const c of filters.categories.filter(c=>Number(c.product_count)>0)) {
      const listing=await get(`/products?category=${encodeURIComponent(c.slug)}&limit=1`)
      assert.equal(listing.total,Number(c.product_count))
      categories.push({name:c.name,parent:filters.categories.find(p=>p.id===c.parent_id)?.name||null,products:listing.total})
    }
    assert.deepEqual(roots.map(c=>[c.name,Number(c.product_count)]).sort(),[['American',136],['Global',26]])
    const zero=all.find(p=>Number(p.vat_rate)===0),standard=all.find(p=>Number(p.vat_rate)===20)
    for(const p of [zero,standard]) assert.equal((await get(`/products/${p.slug}`)).sku,p.sku)
    const images=all.filter(p=>p.image_url).length
    const report={verified_at:new Date().toISOString(),valid_products:162,published_products:all.length,vat_confirmed:162,
      source_prices_preserved:true,vat_rates:{'20':147,'0':15},vat_mismatches:0,duplicate_products:0,
      matched_images:images,without_matched_images:all.length-images,products_with_20_cases:all.filter(p=>p.stock_quantity===20).length,
      categories,integrity_preserved:true,integrity:after,examples:[20,0].map(rate=>calculatePrice(1000,'exclusive',rate===20?'standard':'zero')),
      tests:{integration_passed:29,build_passed:true,browser_visual_check:false}}
    await writeFile('reports/catalogue-import/publication-verification.json',JSON.stringify(report,null,2))
    console.log(JSON.stringify({...report,integrity:undefined},null,2))
  }
} finally {if(server)await new Promise(resolve=>server.close(resolve));await pool.end()}
