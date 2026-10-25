import 'dotenv/config'
import test from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import bcrypt from 'bcryptjs'
import sharp from 'sharp'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { makePlan, identity } from '../server/catalogue-import/products.js'
import { applyPlan } from '../server/catalogue-import/store.js'
import { confirmCatalogue } from '../server/catalogue-import/confirm.js'

test('MySQL migrations and authenticated VAT workflows in an isolated database', { timeout: 120_000, skip: process.env.SIPUP_TEST_MYSQL !== '1' }, async (t) => {
  const dbName = `sipup_vat_test_${randomUUID().replaceAll('-', '')}`
  const connection = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    ssl: process.env.DB_SSL === 'true' ? { minVersion: 'TLSv1.2' } : undefined })
  let pool, server, created = false
  try {
    await connection.query(`CREATE DATABASE \`${dbName}\``)
    created = true
    process.env.DB_NAME = dbName
    await connection.query(`USE \`${dbName}\``)
    // Reproduce the pre-VAT schema, then exercise the actual upgrade script.
    const schema = await readFile(new URL('../server/schema.sql', import.meta.url), 'utf8')
    for (let statement of schema.split(/;\s*(?:\r?\n|$)/).map((s) => s.trim()).filter(Boolean)) {
      if (statement.startsWith('CREATE TABLE IF NOT EXISTS order_vat_breakdowns')) continue
      if (statement.startsWith('CREATE TABLE IF NOT EXISTS products ')) statement = statement.split('\n').filter((line) => !/vat_treatment|vat_rate|vat_confirmed|price_entry_mode/.test(line)).join('\n')
      if (statement.startsWith('CREATE TABLE IF NOT EXISTS orders ')) statement = statement.split('\n').filter((line) => !/delivery_vat_|staff_id|staff_name|orders_staff_/.test(line)).join('\n')
      if (statement.startsWith('CREATE TABLE IF NOT EXISTS order_items ')) statement = statement.split('\n').filter((line) => !/vat_treatment|vat_rate|price_entry_mode|discount_gbp|line_net_gbp|line_vat_gbp|line_gross_gbp/.test(line)).join('\n')
      await connection.query(statement)
    }
    await connection.query(`INSERT INTO products (name,slug,sku,description,price_gbp,stock_quantity)
      VALUES ('Legacy product','legacy','LEGACY','Unclassified legacy fixture',10.00,10)`)
    const [legacyBefore] = await connection.query('SELECT price_gbp FROM products WHERE sku=?', ['LEGACY'])
    const migrate = () => {
      const run = spawnSync(process.execPath, ['server/migrate.js'], { env: process.env, encoding: 'utf8' })
      assert.equal(run.status, 0, run.stderr)
    }
    migrate()
    ;({ pool } = await import('../server/pool.js'))
    const { app, orderEmails } = await import('../server/index.js')
    const legacy = await pool.query('SELECT * FROM products WHERE sku=?', ['LEGACY'])
    assert.equal(legacy.rows[0].price_gbp, legacyBefore[0].price_gbp)
    await t.test('migration repeats without changing legacy prices or classifying products', async () => {
      migrate()
      const after = await pool.query('SELECT * FROM products WHERE sku=?', ['LEGACY'])
      assert.equal(after.rows[0].price_gbp, legacy.rows[0].price_gbp)
      assert.equal(after.rows[0].vat_treatment, null)
      assert.equal(after.rows[0].vat_confirmed, 0)
      const versions = await pool.query('SELECT version FROM schema_migrations')
      assert.equal(versions.rowCount, 8)
    })
    await pool.query('INSERT INTO admins (email,password_hash) VALUES (?,?)', ['admin@example.test', await bcrypt.hash('Test-Password-123!', 4)])
    server = app.listen(0, '127.0.0.1')
    await new Promise((resolve) => server.once('listening', resolve))
    const base = `http://127.0.0.1:${server.address().port}/api`
    const request = async (path, method = 'GET', body, cookie, extra = {}) => {
      const response = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...extra },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
      const raw = await response.text()
      let data; try { data = JSON.parse(raw) } catch { data = raw }
      return { status: response.status, data, cookie: response.headers.get('set-cookie')?.split(';')[0] }
    }
    let adminCookie, customerCookie, uploadedImage
    await t.test('admin routes reject public requests and customer sessions', async () => {
      assert.equal((await request('/admin/vat/dashboard')).status, 401)
      assert.equal((await request('/admin/vat/export.csv')).status, 401)
      assert.equal((await request('/admin/products/price-preview', 'POST', {})).status, 401)
      const login = await request('/auth/login', 'POST', { email: 'admin@example.test', password: 'Test-Password-123!' })
      assert.equal(login.status, 200); adminCookie = login.cookie
      const register = await request('/account/register', 'POST', { name: 'Test Customer', phone: '07123456789', email: 'customer@example.test', password: 'Customer-Test-123!' })
      assert.equal(register.status, 201, JSON.stringify(register.data)); customerCookie = register.cookie
      assert.equal((await request('/admin/products', 'GET', undefined, customerCookie)).status, 401)
      assert.equal((await request('/orders', 'POST', {})).status, 401)
    })
    await t.test('image uploads require admin, validate contents, deduplicate and serve database bytes', async () => {
      const bytes = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#ff8800' } }).png().toBuffer()
      const upload = (body, cookie = adminCookie, type = 'image/png') => fetch(`${base}/admin/product-media`, {
        method: 'POST', headers: { 'Content-Type': type, Cookie: cookie || '' }, body,
      })
      assert.equal((await upload(bytes, '')).status, 401)
      assert.equal((await upload(bytes, customerCookie)).status, 401)
      assert.equal((await upload(Buffer.from('fake png'))).status, 400)
      assert.equal((await upload(Buffer.from('<svg/>'), adminCookie, 'image/svg+xml')).status, 400)
      assert.equal((await upload(Buffer.alloc(5 * 1024 * 1024 + 1))).status, 413)
      const response = await upload(bytes)
      assert.equal(response.status, 201)
      uploadedImage = (await response.json()).image_url
      assert.match(uploadedImage, /^\/api\/product-media\/[a-f0-9]{64}$/)
      assert.equal((await (await upload(bytes)).json()).image_url, uploadedImage)
      const row = (await pool.query('SELECT * FROM product_media WHERE sha256 = ?', [uploadedImage.split('/').pop()])).rows[0]
      const image = await fetch(`http://127.0.0.1:${server.address().port}${uploadedImage}`)
      assert.equal(image.status, 200)
      assert.equal(image.headers.get('content-type'), 'image/webp')
      assert.match(image.headers.get('cache-control'), /immutable/)
      assert.deepEqual(Buffer.from(await image.arrayBuffer()), row.image_data)
      assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/api/product-media/${'0'.repeat(64)}`)).status, 404)
      const { persistImageUrl } = await import('../server/product-media.js')
      await assert.rejects(persistImageUrl(pool, `/api/product-media/${'0'.repeat(64)}`), /no longer exists/)
      await assert.rejects(persistImageUrl(pool, '/products/../../.env'), /Invalid local/)
    })
    const productBody = (sku, price, treatment = 'standard') => ({ name: `Test ${sku}`, sku, category: 'Test category',
      price_pence: price, vat_treatment: treatment, vat_confirmed: true, price_entry_mode: 'exclusive', stock_quantity: 100 })
    const ids = []
    await t.test('product CRUD validates classification and normalizes inclusive/promotional/bulk prices', async () => {
      assert.equal((await request('/admin/products', 'POST', { ...productBody('BAD', 1000), vat_treatment: null }, adminCookie)).status, 400)
      assert.equal((await request('/admin/products', 'POST', { ...productBody('ROUND', 3), price_entry_mode: 'inclusive' }, adminCookie)).status, 400)
      assert.equal((await request('/admin/products','POST',{...productBody('BAD_IMAGE',1000),image_url:'javascript:alert(1)'},adminCookie)).status,400)
      for (const body of [productBody('A', 1000), productBody('B', 500, 'zero'), productBody('C', 800), productBody('D', 1000, 'exempt')]) {
        const result = await request('/admin/products', 'POST', body, adminCookie)
        assert.equal(result.status, 201, JSON.stringify(result.data))
      }
      const inclusive = await request('/admin/products', 'POST', { ...productBody('INCLUSIVE', 1200),image_url:uploadedImage, price_entry_mode: 'inclusive', sale_price_pence: 960,
        bulk_prices: [{ min_quantity: 10, unit_price_pence: 840 }] }, adminCookie)
      assert.equal(inclusive.status, 201, JSON.stringify(inclusive.data))
      const products = (await request('/admin/products', 'GET', undefined, adminCookie)).data.products
      for (const sku of ['A','B','C','D','INCLUSIVE']) ids.push(Number(products.find((p) => p.sku === sku).id))
      const normalized = products.find((p) => p.sku === 'INCLUSIVE')
      assert.equal(normalized.image_url, uploadedImage); assert.equal(normalized.images[0].image_url, uploadedImage)
      assert.equal(normalized.price_pence, 1000); assert.equal(normalized.sale_price_pence, 800)
      assert.equal(normalized.bulk_prices[0].unit_price_pence, 700)
      const publicProducts = (await request('/products')).data.products
      assert.ok(!publicProducts.some((p) => p.sku === 'LEGACY'))
    })
    const checkout = { customer: { preference: 'collection' }, items: ids.slice(0, 3).map((productId) => ({ productId, quantity: 1 })) }
    let orderId, reference
    const key = randomUUID()
    await t.test('server quotes mixed VAT, ignores forged amounts and rejects stale totals', async () => {
      const quote = await request('/checkout/preview', 'POST', { ...checkout, total_pence: 1, vat_rate: 0 }, customerCookie)
      assert.equal(quote.status, 200, JSON.stringify(quote.data)); assert.equal(quote.data.total_pence, 2660)
      assert.equal(quote.data.vat_pence, 360)
      assert.equal((await request('/checkout/preview', 'POST', { customer: { preference: 'collection' }, items: [{ productId: Number(legacy.rows[0].id), quantity: 1 }] }, customerCookie)).status, 400)
      assert.equal((await request('/orders', 'POST', { ...checkout, expected_total_pence: 1 }, customerCookie, { 'Idempotency-Key': key })).status, 409)
      const created = await request('/orders', 'POST', { ...checkout, expected_total_pence: 2660 }, customerCookie, { 'Idempotency-Key': key })
      assert.equal(created.status, 201, JSON.stringify(created.data)); reference = created.data.reference
      orderId = Number((await pool.query('SELECT id FROM orders WHERE reference=?', [reference])).rows[0].id)
      const promotional = await request('/checkout/preview', 'POST', { customer: { preference: 'collection' }, items: [{ productId: ids[4], quantity: 10 }] }, customerCookie)
      assert.equal(promotional.data.total_pence, 8400)
      assert.equal(promotional.data.items[0].unit_price_pence, 700)
    })
    await t.test('delivery requires explicit tax configuration; collection remains free', async () => {
      await request('/admin/settings/store', 'PUT', { name: 'SipUp', delivery_charge_pence: 500 }, adminCookie)
      const delivery = { ...checkout, customer: { preference: 'delivery' } }
      assert.equal((await request('/checkout/preview', 'POST', delivery, customerCookie)).status, 400)
      await request('/admin/settings/store', 'PUT', { name: 'SipUp', delivery_charge_pence: 500, delivery_vat_treatment: 'reduced' }, adminCookie)
      assert.equal((await request('/checkout/preview', 'POST', delivery, customerCookie)).data.total_pence, 3185)
      assert.equal((await request('/checkout/preview', 'POST', checkout, customerCookie)).data.total_pence, 2660)
      const exempt = await request('/checkout/preview', 'POST', { customer: { preference: 'collection' }, items: [{ productId: ids[3], quantity: 1 }] }, customerCookie)
      assert.equal(exempt.data.total_pence, 1000)
      assert.equal(exempt.data.vat_breakdowns[0].vat_treatment, 'exempt')
      assert.equal(exempt.data.vat_breakdowns[0].vat_rate, null)
    })
    await t.test('admin order rows include product images and can be found by product name', async () => {
      await pool.query('INSERT INTO product_images (product_id,image_url,alt_text,sort_order) VALUES (?,?,?,0)', [ids[0],uploadedImage,'Test A'])
      const result = await request('/admin/orders?search=Test%20A','GET',undefined,adminCookie)
      assert.equal(result.status,200)
      const order = result.data.orders.find(o => o.id === orderId)
      assert.ok(order)
      assert.equal(order.items.find(i => i.sku === 'A').image_url,uploadedImage)
      assert.equal(order.items.find(i => i.sku === 'B').image_url,'')
      const detail = await request(`/admin/orders/${orderId}`,'GET',undefined,adminCookie)
      assert.equal(detail.data.order.items.find(i => i.sku === 'A').image_url,uploadedImage)
      const missing = await request('/admin/orders?search=NO-SUCH-PRODUCT-NAME','GET',undefined,adminCookie)
      assert.equal(missing.data.total,0)
    })
    await t.test('order snapshots survive product edits; idempotent retries return the original order', async () => {
      const original = await request(`/admin/orders/${orderId}`, 'GET', undefined, adminCookie)
      assert.equal((await request(`/admin/products/${ids[0]}`, 'PUT', productBody('A', 2000, 'exempt'), adminCookie)).status, 200)
      const after = await request(`/admin/orders/${orderId}`, 'GET', undefined, adminCookie)
      // Images follow the current catalogue; historical names, quantities and tax/price snapshots stay fixed.
      const snapshots = items => items.map(({ image_url: _currentImage, ...snapshot }) => snapshot)
      assert.deepEqual(snapshots(after.data.order.items), snapshots(original.data.order.items))
      assert.equal(original.data.order.items.find(item => item.sku === 'A').image_url,uploadedImage)
      assert.equal(after.data.order.items.find(item => item.sku === 'A').image_url,'')
      const audit = await pool.query("SELECT details FROM audit_logs WHERE entity_id=? AND entity_type='product' AND action='product_updated'", [ids[0]])
      assert.ok(audit.rowCount > 0)
      const retry = await request('/orders', 'POST', checkout, customerCookie, { 'Idempotency-Key': key })
      assert.equal(retry.status, 200); assert.equal(retry.data.reference, reference); assert.equal(retry.data.total_pence, 2660)
    })
    await t.test('status changes deduct stock once and refunds reverse original tax', async () => {
      for (const status of ['confirmed', 'delivered']) assert.equal((await request(`/admin/orders/${orderId}/status`, 'PATCH', { status }, adminCookie)).status, 200)
      assert.equal(Number((await pool.query('SELECT stock_quantity FROM products WHERE id=?', [ids[1]])).rows[0].stock_quantity), 99)
      assert.equal((await request(`/admin/orders/${orderId}/payments`, 'POST', { type: 'payment', amount_pence: 2660, method: 'cash' }, adminCookie)).status, 201)
      const sources = (await request(`/admin/orders/${orderId}`, 'GET', undefined, adminCookie)).data.refund_sources
      const source = sources.find((s) => s.name === 'Test A').source
      const body = { type: 'refund', amount_pence: 1200, method: 'cash', refund_lines: [{ source, quantity: 1 }] }
      assert.equal((await request(`/admin/orders/${orderId}/payments`, 'POST', { ...body, amount_pence: 1000 }, adminCookie)).status, 400)
      assert.equal((await request(`/admin/orders/${orderId}/payments`, 'POST', body, adminCookie)).status, 201)
      assert.equal((await request(`/admin/orders/${orderId}/payments`, 'POST', body, adminCookie)).status, 400)
      const tax = (await pool.query('SELECT * FROM refund_tax_lines')).rows[0]
      assert.equal(tax.vat_treatment, 'standard'); assert.equal(tax.vat_gbp, '2.00')
    })
    await t.test('filtered dashboard, refund adjustments and CSV reconcile', async () => {
      const report = await request('/admin/vat/dashboard?from=2000-01-01&to=2099-12-31&status=delivered', 'GET', undefined, adminCookie)
      assert.equal(report.status, 200, JSON.stringify(report.data))
      assert.equal(report.data.orders.reduce((s, r) => s + r.gross_pence, 0), 2660)
      assert.equal(report.data.refunds[0].vat_pence, 200)
      assert.equal(report.data.refund_states[0].refund_state, 'partial')
      const empty = await request('/admin/vat/dashboard?from=2000-01-01&to=2000-01-02&status=delivered', 'GET', undefined, adminCookie)
      assert.deepEqual(empty.data.orders, [])
      const csv = await request('/admin/vat/export.csv?status=delivered', 'GET', undefined, adminCookie)
      assert.equal(csv.status, 200); assert.match(csv.data, /refunds,standard,20,No,10.00,2.00,12.00/)
      assert.equal((await request('/admin/vat/dashboard?from=2026-10-15&to=2026-01-01', 'GET', undefined, adminCookie)).status, 400)
      const category = await request('/admin/vat/dashboard?category=Test%20category', 'GET', undefined, adminCookie)
      assert.equal(category.data.orders.reduce((sum, row) => sum + row.gross_pence, 0), 2660)
      assert.equal(category.data.refunds[0].gross_pence, 1200)
      assert.equal((await request('/admin/vat/dashboard?category=Other', 'GET', undefined, adminCookie)).data.orders.length, 0)
    })
    await t.test('cancellation restores stock once, and unpublishing preserves historical items', async () => {
      const sources = (await request(`/admin/orders/${orderId}`, 'GET', undefined, adminCookie)).data.refund_sources.filter((s) => s.quantity > s.refunded_quantity)
      const full = await request(`/admin/orders/${orderId}/payments`, 'POST', { type: 'refund', amount_pence: 1460, method: 'cash', refund_lines: sources.map((s) => ({ source: s.source, quantity: 1 })) }, adminCookie)
      assert.equal(full.status, 201, JSON.stringify(full.data))
      const report = await request('/admin/vat/dashboard', 'GET', undefined, adminCookie)
      assert.equal(report.data.refund_states[0].refund_state, 'full')
      assert.equal((await request(`/admin/orders/${orderId}/status`, 'PATCH', { status: 'cancelled' }, adminCookie)).status, 200)
      assert.equal(Number((await pool.query('SELECT stock_quantity FROM products WHERE id=?', [ids[1]])).rows[0].stock_quantity), 100)
      assert.equal((await request(`/admin/products/${ids[1]}`, 'DELETE', undefined, adminCookie)).status, 204)
      const old = await request(`/admin/orders/${orderId}`, 'GET', undefined, adminCookie)
      assert.equal(old.data.order.items.length, 3)
      assert.equal(old.data.order.total_pence, 2660)
    })
    await t.test('catalogue import creates 20 cases per flavour and retries preserve inventory and identifiers', async () => {
      const source = {workbookHash:'test',rows:['Cherry','Orange'].map((flavour,index)=>{
        const r={name:'Catalogue fixture',size:'330ml',units:12,flavour,category:'American',subcategory:'Drinks',row:index+2,
          raw:['Catalogue fixture','330ml',12,flavour,12,0.2,'American','Drinks',1,null],pricePence:1200,unitPricePence:100,
          treatment:'standard',vatRaw:0.2,vatFormat:'0%',expiry:null,errors:[],unitMismatch:false}
        return {...r,...identity(r)}
      })}
      const mappings={brands:{'Catalogue fixture':'Fixture'},products:Object.fromEntries(source.rows.map(r=>[r.sku,{allowMissingImage:true}]))}
      const plan=makePlan(source,{pdfHash:'test',pages:[],assets:[]},[],mappings,'exclusive')
      assert.equal(plan.summary.proposedInitialCases,40)
      assert.deepEqual(await applyPlan(pool,plan,plan.approvalDigest),{created:2,preserved:0})
      const saved=await pool.query('SELECT sku,slug,stock_quantity,catalogue_details,is_published FROM products WHERE sku IN (?,?)',source.rows.map(r=>r.sku))
      assert.equal(saved.rowCount,2)
      assert.ok(saved.rows.every(r=>r.stock_quantity===20 && !r.is_published))
      await pool.query('UPDATE products SET stock_quantity=13 WHERE sku=?',[source.rows[0].sku])
      assert.deepEqual(await applyPlan(pool,plan,plan.approvalDigest),{created:0,preserved:2})
      const after=await pool.query('SELECT stock_quantity,slug FROM products WHERE sku=?',[source.rows[0].sku])
      assert.equal(after.rows[0].stock_quantity,13)
      assert.equal(after.rows[0].slug,saved.rows.find(r=>r.sku===source.rows[0].sku).slug)
      const metadata=typeof saved.rows[0].catalogue_details==='string'?JSON.parse(saved.rows[0].catalogue_details):saved.rows[0].catalogue_details
      assert.equal(metadata.units_per_case,12);assert.equal(metadata.selling_unit,'case')
      await assert.rejects(()=>applyPlan(pool,plan,'unapproved'),/Approval digest/)
      const reviewSource={workbookHash:'review-test',rows:[{...source.rows[0],flavour:'Review flavour',...identity({...source.rows[0],flavour:'Review flavour'})}]}
      const reviewPlan=makePlan(reviewSource,{pdfHash:'test',pages:[],assets:[]},[],{},'exclusive')
      assert.equal(reviewPlan.records[0].status,'review')
      await assert.rejects(()=>applyPlan(pool,reviewPlan,reviewPlan.approvalDigest),/review\/invalid/)
      assert.deepEqual(await applyPlan(pool,reviewPlan,reviewPlan.approvalDigest,{includeReviewAsDrafts:true}),{created:1,preserved:0})
      const reviewSaved=await pool.query('SELECT is_published,vat_confirmed,stock_quantity,catalogue_details FROM products WHERE sku=?',[reviewSource.rows[0].sku])
      assert.equal(reviewSaved.rows[0].is_published,0);assert.equal(reviewSaved.rows[0].vat_confirmed,0)
      assert.equal(reviewSaved.rows[0].stock_quantity,20)
      const caseProduct=(await request('/admin/products','GET',undefined,adminCookie)).data.products.find(p=>p.sku===source.rows[1].sku)
      assert.equal(caseProduct.selling_unit,'case');assert.equal(caseProduct.units_per_case,12)
      assert.equal(caseProduct.flavour,'Orange');assert.ok(!('catalogue_details' in caseProduct))
      const publish={...productBody(caseProduct.sku,1200),name:caseProduct.name,category_id:caseProduct.category_id,brand:'Fixture',stock_quantity:20,pack_size:caseProduct.pack_size}
      assert.equal((await request(`/admin/products/${caseProduct.id}`,'PUT',publish,adminCookie)).status,200)
      const listed=await request('/products?category=American&brand=Fixture&search=Catalogue&limit=1&page=1')
      assert.equal(listed.status,200,JSON.stringify(listed.data));assert.equal(listed.data.total,1)
      assert.equal(listed.data.products[0].sku,caseProduct.sku)
      assert.equal((await request('/products?brand=Unknown')).data.total,0)
      const filters=await request('/catalogue/filters');assert.ok(filters.data.brands.includes('Fixture'))
      const basket={customer:{preference:'collection'},items:[{productId:caseProduct.id,quantity:3}],expected_total_pence:4320}
      const sale=await request('/orders','POST',basket,customerCookie,{'Idempotency-Key':randomUUID()})
      assert.equal(sale.status,201,JSON.stringify(sale.data))
      const saleId=(await pool.query('SELECT id FROM orders WHERE reference=?',[sale.data.reference])).rows[0].id
      for(const status of ['confirmed','processing'])assert.equal((await request(`/admin/orders/${saleId}/status`,'PATCH',{status},adminCookie)).status,200)
      assert.equal((await pool.query('SELECT stock_quantity FROM products WHERE id=?',[caseProduct.id])).rows[0].stock_quantity,17)
      const oversell=await request('/checkout/preview','POST',{...basket,items:[{productId:caseProduct.id,quantity:18}]},customerCookie)
      assert.equal(oversell.status,400)
      assert.equal((await request('/admin/import-history')).status,401)
      const history=await request('/admin/import-history','GET',undefined,adminCookie)
      assert.equal(history.status,200);assert.ok(history.data.imports.length>=1)
    })
    await t.test('source VAT confirmation publishes mixed rates without changing net prices, inventory or orders',async()=>{
      const source={workbookHash:'confirm-fixture',rows:[20,0].map((rate,index)=>{
        const r={name:'Confirmation fixture',size:'100g',units:12,flavour:`Rate ${rate}`,category:'Global',subcategory:'Candys',row:index+2,
          raw:[],pricePence:1000,unitPricePence:null,treatment:rate===20?'standard':'zero',vatRaw:rate/100,vatFormat:'0%',expiry:null,errors:[],unitMismatch:false}
        return {...r,...identity(r)}
      })}
      const plan=makePlan(source,{pdfHash:'test',pages:[],assets:[]},[],{},'exclusive')
      await applyPlan(pool,plan,plan.approvalDigest,{includeReviewAsDrafts:true})
      const snapshot=async()=>JSON.stringify((await pool.query('SELECT * FROM orders ORDER BY id')).rows)
      const orders=await snapshot()
      const preview=await confirmCatalogue(pool,source)
      assert.equal(preview.newly_published,2)
      assert.equal((await pool.query('SELECT SUM(is_published) AS n FROM products WHERE sku IN (?,?)',source.rows.map(r=>r.sku))).rows[0].n,'0')
      const result=await confirmCatalogue(pool,source,{commit:true})
      assert.deepEqual(result.records.map(r=>r.gross_pence),[1200,1000])
      assert.deepEqual(result.records.map(r=>r.vat_rate),[20,0])
      assert.equal(result.standard,1);assert.equal(result.zero,1)
      await pool.query('UPDATE products SET stock_quantity=17 WHERE sku=?',[source.rows[0].sku])
      const again=await confirmCatalogue(pool,source,{commit:true})
      assert.equal(again.newly_published,0);assert.equal(again.records[0].stock_cases,17)
      assert.equal(await snapshot(),orders)
      const saved=(await pool.query('SELECT price_gbp,vat_rate,vat_confirmed,is_published,price_entry_mode FROM products WHERE sku IN (?,?) ORDER BY vat_rate DESC',source.rows.map(r=>r.sku))).rows
      assert.deepEqual(saved.map(r=>Number(r.vat_rate)),[20,0])
      assert.ok(saved.every(r=>r.price_gbp==='10.00'&&r.vat_confirmed===1&&r.is_published===1&&r.price_entry_mode==='exclusive'))
      await pool.query('UPDATE products SET vat_rate=20,vat_treatment=? WHERE sku=?',['standard',source.rows[1].sku])
      await assert.rejects(()=>confirmCatalogue(pool,source,{commit:true}),/differs from Excel/)
      await pool.query('UPDATE products SET vat_rate=0,vat_treatment=? WHERE sku=?',['zero',source.rows[1].sku])
    })
    await t.test('admin manages parent categories and repeated subcategory names while rejecting hierarchy cycles',async()=>{
      assert.equal((await request('/admin/categories','POST',{name:'Blocked'})).status,401)
      const create=async(name,parent_id=null)=>{
        const result=await request('/admin/categories','POST',{name,parent_id},adminCookie)
        assert.equal(result.status,201,JSON.stringify(result.data))
        return result.data.categories.find(c=>c.name===name&&c.parent_id===parent_id)
      }
      const first=await create('Region One'),second=await create('Region Two')
      const child=await create('Candy',first.id),other=await create('Candy',second.id)
      assert.notEqual(child.slug,other.slug)
      assert.equal((await request(`/admin/categories/${first.id}`,'PUT',{name:first.name,parent_id:child.id},adminCookie)).status,400)
      const edited=await request(`/admin/categories/${child.id}`,'PUT',{name:'Sweets',parent_id:second.id,description:'Updated from admin',sort_order:2},adminCookie)
      assert.equal(edited.status,200,JSON.stringify(edited.data))
      const row=edited.data.categories.find(c=>c.id===child.id)
      assert.equal(row.parent_id,second.id);assert.equal(row.slug,child.slug);assert.equal(row.sort_order,2)
      const filters=(await request('/catalogue/filters')).data
      const global=filters.categories.find(c=>c.name==='Global'&&!c.parent_id)
      assert.equal(Number(global.product_count),2)
    })


    await t.test('confirmation reduces 20 cases to 15 once and queues an email that retries independently', async t => {
      // Isolate worker assertions from emails queued by the earlier workflow fixtures.
      await pool.query("UPDATE order_confirmation_emails SET status='cancelled' WHERE status='pending'")
      let ready = false, failSend = false
      const delivered = []
      t.mock.method(orderEmails, 'isConfigured', () => ready)
      t.mock.method(orderEmails, 'send', async message => {
        if (failSend) throw Object.assign(new Error('Private provider detail must not be stored'), { code: 'EAUTH' })
        delivered.push(message); return { accepted: [message.to] }
      })
      const create = await request('/admin/products', 'POST', { ...productBody('CASE-EMAIL',1000), stock_quantity: 20 }, adminCookie)
      assert.equal(create.status, 201); const product = create.data.product
      await pool.query('UPDATE products SET catalogue_details=? WHERE id=?', [{ selling_unit: 'case', units_per_case: 12 },product.id])
      const book = async (quantity, productId = product.id) => {
        const result = await request('/orders', 'POST', { customer: { preference: 'collection' }, items: [{ productId, quantity }] }, customerCookie, { 'Idempotency-Key': randomUUID() })
        assert.equal(result.status, 201, JSON.stringify(result.data))
        return Number((await pool.query('SELECT id FROM orders WHERE reference=?',[result.data.reference])).rows[0].id)
      }
      const stock = async () => Number((await pool.query('SELECT stock_quantity FROM products WHERE id=?',[product.id])).rows[0].stock_quantity)
      const change = (id,status) => request(`/admin/orders/${id}/status`,'PATCH',{status},adminCookie)
      const email = async id => (await pool.query('SELECT * FROM order_confirmation_emails WHERE order_id=?',[id])).rows[0]
      const id = await book(5)
      assert.equal(await stock(),20); assert.equal(await email(id),undefined)
      assert.equal((await change(id,'confirmed')).status,200)
      assert.equal(await stock(),15); assert.equal((await email(id)).status,'pending')
      assert.equal((await email(id)).recipient,'customer@example.test')
      const repeat = await Promise.all([change(id,'confirmed'),change(id,'confirmed')])
      assert.ok(repeat.every(r=>r.status===200)); assert.equal(await stock(),15)
      assert.equal((await pool.query('SELECT * FROM stock_movements WHERE order_id=? AND reason=?',[id,'order_confirmed'])).rowCount,1)
      assert.equal((await pool.query('SELECT * FROM order_confirmation_emails WHERE order_id=?',[id])).rowCount,1)
      assert.equal((await change(id,'booking')).status,409)
      assert.equal((await request(`/admin/orders/${id}/confirmation-email/retry`,'POST',{},customerCookie)).status,401)
      assert.equal((await request(`/admin/orders/${id}/confirmation-email/retry`,'POST',{},adminCookie)).status,409)
      await orderEmails.drain(); assert.equal(delivered.length,0); assert.equal((await email(id)).attempts,0)
      const detail = (await request(`/admin/orders/${id}`,'GET',undefined,adminCookie)).data
      assert.equal(detail.confirmation_email.configured,false); assert.equal(detail.confirmation_email.status,'pending')
      // The queued message retains the original order lines and prices after product edits.
      await pool.query('UPDATE products SET name=?,price_gbp=? WHERE id=?',['Changed after booking',99,product.id])
      ready = true; failSend = true
      await orderEmails.drain(1)
      assert.equal((await email(id)).status,'failed'); assert.equal((await email(id)).last_error,'EAUTH')
      assert.equal((await email(id)).attempts,1); assert.equal(await stock(),15)
      await orderEmails.drain(1); assert.equal((await email(id)).attempts,1) // retry backoff
      assert.equal((await request(`/admin/orders/${id}/confirmation-email/retry`,'POST',{},adminCookie)).status,200)
      failSend = false
      await Promise.all([orderEmails.drain(1),orderEmails.drain(1)])
      assert.equal(delivered.length,1); assert.equal((await email(id)).status,'sent')
      assert.match(delivered[0].subject,/confirmed/); assert.match(delivered[0].text,/5 cases/)
      assert.match(delivered[0].text,/Test CASE-EMAIL/); assert.match(delivered[0].text,/\u00a350\.00/)
      assert.ok(!delivered[0].text.includes('Changed after booking')); assert.equal(delivered[0].to,'customer@example.test')
      assert.equal((await request(`/admin/orders/${id}/confirmation-email/retry`,'POST',{},adminCookie)).status,409)
      await orderEmails.drain(); assert.equal(delivered.length,1)
      assert.equal((await change(id,'delivered')).status,200); assert.equal(await stock(),15)
      assert.equal((await change(id,'cancelled')).status,200); assert.equal(await stock(),20)
      const cancelled = await book(1)
      await change(cancelled,'confirmed'); await change(cancelled,'cancelled')
      assert.equal((await email(cancelled)).status,'cancelled')
      await orderEmails.drain(); assert.equal(delivered.length,1); assert.equal(await stock(),20)
      // Two bookings can be placed against the same stock; confirmation must never oversell it.
      const a = await book(15), b = await book(15)
      const confirmed = await Promise.all([change(a,'confirmed'),change(b,'confirmed')])
      assert.deepEqual(confirmed.map(r=>r.status).sort(),[200,409]); assert.equal(await stock(),5)
      assert.equal((await pool.query('SELECT * FROM order_confirmation_emails WHERE order_id IN (?,?)',[a,b])).rowCount,1)
    })
    await t.test('insufficient stock rolls back every product deduction and creates no confirmation email',async()=>{
      const products=[]
      for(const sku of ['ROLLBACK-ONE','ROLLBACK-TWO']) {
        const result=await request('/admin/products','POST',{...productBody(sku,1000),stock_quantity:20},adminCookie)
        assert.equal(result.status,201);products.push(result.data.product.id)
      }
      const booking=await request('/orders','POST',{customer:{preference:'collection'},items:products.map(productId=>({productId,quantity:5}))},customerCookie,{'Idempotency-Key':randomUUID()})
      assert.equal(booking.status,201)
      const id=(await pool.query('SELECT id FROM orders WHERE reference=?',[booking.data.reference])).rows[0].id
      await pool.query('UPDATE products SET stock_quantity=2 WHERE id=?',[products[1]])
      assert.equal((await request(`/admin/orders/${id}/status`,'PATCH',{status:'confirmed'},adminCookie)).status,409)
      const rows=(await pool.query('SELECT id,stock_quantity FROM products WHERE id IN (?,?) ORDER BY id',products)).rows
      assert.deepEqual(rows.map(r=>r.stock_quantity),[20,2])
      const order=(await pool.query('SELECT status,stock_deducted FROM orders WHERE id=?',[id])).rows[0]
      assert.equal(order.status,'booking');assert.equal(order.stock_deducted,0)
      assert.equal((await pool.query('SELECT * FROM order_confirmation_emails WHERE order_id=?',[id])).rowCount,0)
      assert.equal((await pool.query('SELECT * FROM stock_movements WHERE order_id=?',[id])).rowCount,0)
    })

    await t.test('admin manages isolated staff logins, checkout attribution and scoped sales', async (t) => {
      const password = 'Staff-Test-Password-123!'
      const access = { sales_view: true, inventory_view: true, inventory_manage: false }
      const first = { name: 'Staff One', email: 'one@staff.example.test', password, is_active: true, permissions: access }
      const second = { ...first, name: 'Staff Two', email: 'two@staff.example.test', permissions: { ...access, inventory_view: false } }
      let firstId, secondId, firstCookie, secondCookie, productId, assignedOrder, pendingOrder, cancelledOrder
      const staffLogin = email => request('/staff/login', 'POST', { email, password })
      const updateFirst = body => request(`/admin/staff/${firstId}`, 'PUT', { ...first, password: undefined, ...body }, adminCookie)
      await t.test('only admin creates accounts and staff credentials cannot enter other account areas', async () => {
        assert.equal((await request('/admin/staff', 'POST', first, customerCookie)).status, 401)
        assert.equal((await request('/admin/staff', 'GET')).status, 401)
        assert.equal((await request('/staff/register', 'POST', first)).status, 404)
        const a = await request('/admin/staff', 'POST', first, adminCookie)
        assert.equal(a.status, 201, JSON.stringify(a.data)); firstId = a.data.id
        const b = await request('/admin/staff', 'POST', second, adminCookie)
        assert.equal(b.status, 201); secondId = b.data.id
        assert.equal((await request('/admin/staff', 'POST', first, adminCookie)).status, 409)
        assert.equal((await request('/admin/staff', 'POST', { ...first, email: 'invalid@example.test', permissions: { sales_view: true, inventory_manage: true, inventory_view: false } }, adminCookie)).status, 400)
        const aLogin = await staffLogin(first.email); assert.equal(aLogin.status, 200); firstCookie = aLogin.cookie
        const bLogin = await staffLogin(second.email); assert.equal(bLogin.status, 200); secondCookie = bLogin.cookie
        assert.equal(aLogin.data.staff.password_hash, undefined)
        assert.equal((await request('/admin/staff', 'GET', undefined, firstCookie)).status, 401)
        assert.equal((await request('/admin/products', 'GET', undefined, firstCookie.replace('sipup_staff_session=', 'sipup_session='))).status, 401)
        assert.equal((await request('/account/me', 'GET', undefined, firstCookie)).status, 401)
        assert.equal((await request('/staff/me', 'GET', undefined, customerCookie.replace('sipup_customer_session=', 'sipup_staff_session='))).status, 401)
        assert.equal((await request('/staff/sales', 'GET', undefined, customerCookie)).status, 401)
        assert.equal((await request('/staff/sales', 'GET', undefined, adminCookie)).status, 401)
        const choices = await request('/checkout/staff', 'GET', undefined, customerCookie)
        assert.equal(choices.status, 200)
        assert.deepEqual(choices.data.staff.find(m => m.id === firstId), { id: firstId, name: first.name })
        assert.equal((await request('/checkout/staff')).status, 401)
        const members = (await request('/admin/staff', 'GET', undefined, adminCookie)).data.staff
        assert.equal(members.length, 2); assert.ok(members.every(m => !('password_hash' in m)))
      })
      await t.test('inventory permissions apply on the server and stock adjustments are audited with concurrency checks', async () => {
        const create = await request('/admin/products', 'POST', productBody('STAFF-SALES-FIXTURE', 1000), adminCookie)
        assert.equal(create.status, 201)
        productId = (await pool.query('SELECT id FROM products WHERE sku=?', ['STAFF-SALES-FIXTURE'])).rows[0].id
        assert.equal((await request('/staff/inventory', 'GET', undefined, secondCookie)).status, 403)
        assert.equal((await request('/staff/inventory', 'GET', undefined, firstCookie)).status, 200)
        const change = { quantity: 105, expected_quantity: 100, reason: 'Stock received' }
        assert.equal((await request(`/staff/inventory/${productId}`, 'PATCH', change, firstCookie)).status, 403)
        assert.equal((await updateFirst({ permissions: { ...access, inventory_manage: true } })).status, 200)
        assert.equal((await request(`/staff/inventory/${productId}`, 'PATCH', change, firstCookie)).status, 200)
        assert.equal((await request(`/staff/inventory/${productId}`, 'PATCH', change, firstCookie)).status, 409)
        assert.equal((await request(`/staff/inventory/${productId}`, 'PATCH', { ...change, quantity: -1, expected_quantity: 105 }, firstCookie)).status, 400)
        const movement = (await pool.query('SELECT quantity_delta, actor FROM stock_movements WHERE product_id=? AND reason=?', [productId, change.reason])).rows
        assert.equal(movement.length, 1); assert.equal(movement[0].quantity_delta, 5); assert.equal(movement[0].actor, `staff:${firstId}:Staff One`)
        assert.equal((await updateFirst({ permissions: { ...access, inventory_view: false } })).status, 200)
        assert.equal((await request('/staff/inventory', 'GET', undefined, firstCookie)).status, 403)
        const product = (await pool.query('SELECT price_gbp,stock_quantity FROM products WHERE id=?', [productId])).rows[0]
        assert.equal(product.price_gbp, '10.00'); assert.equal(product.stock_quantity, 105)
      })
      const orderBody = (staffId, quantity = 1) => ({ customer: { preference: 'collection' }, items: [{ productId, quantity }], staff_id: staffId })
      const book = async (staffId, quantity, status) => {
        const key = randomUUID()
        const result = await request('/orders', 'POST', orderBody(staffId, quantity), customerCookie, { 'Idempotency-Key': key })
        assert.equal(result.status, 201, JSON.stringify(result.data))
        const id = (await pool.query('SELECT id FROM orders WHERE reference=?', [result.data.reference])).rows[0].id
        if (status) assert.equal((await request(`/admin/orders/${id}/status`, 'PATCH', { status }, adminCookie)).status, 200)
        return { id, key, saved: result.data }
      }
      await t.test('checkout assigns the chosen active staff or nobody and retries keep the original attribution', async () => {
        assert.equal((await request('/orders', 'POST', orderBody(999999), customerCookie, { 'Idempotency-Key': randomUUID() })).status, 400)
        assert.equal((await request('/orders', 'POST', orderBody(-1), customerCookie, { 'Idempotency-Key': randomUUID() })).status, 400)
        assignedOrder = await book(firstId, 3, 'confirmed')
        assert.equal(assignedOrder.saved.staff_id, firstId); assert.equal(assignedOrder.saved.staff_name, first.name)
        await book(secondId, 5, 'confirmed')
        const unassigned = await book(null, 2, 'confirmed')
        assert.equal(unassigned.saved.staff_id, null); assert.equal(unassigned.saved.staff_name, '')
        pendingOrder = await book(firstId, 4)
        cancelledOrder = await book(firstId, 6, 'cancelled')
        const retry = await request('/orders', 'POST', orderBody(secondId, 3), customerCookie, { 'Idempotency-Key': assignedOrder.key })
        assert.equal(retry.status, 200); assert.equal(retry.data.staff_id, firstId); assert.equal(retry.data.staff_name, first.name)
        const detail = await request(`/admin/orders/${assignedOrder.id}`, 'GET', undefined, adminCookie)
        assert.equal(detail.data.order.staff_name, first.name)
        const history = await request('/account/orders', 'GET', undefined, customerCookie)
        assert.equal(history.data.orders.find(o => Number(o.id) === assignedOrder.id).staff_name, first.name)
      })
      await t.test('staff see only their own orders and confirmed quantities while admin sees every staff report', async () => {
        const own = (await request(`/staff/sales?staff_id=${secondId}`, 'GET', undefined, firstCookie)).data
        assert.equal(own.summary.assigned_orders, 3); assert.equal(own.summary.confirmed_orders, 1)
        assert.equal(own.summary.pending_orders, 1); assert.equal(own.summary.cancelled_orders, 1)
        assert.equal(own.summary.quantity_sold, 3); assert.equal(own.summary.sales_pence, 3000)
        assert.equal(own.products.length, 1); assert.equal(own.products[0].quantity, 3)
        assert.equal(own.orders.length, 3)
        assert.ok(own.orders.every(o => o.staff_name === first.name)); assert.ok(own.orders.every(o => !('customer_email' in o)))
        const other = (await request('/staff/sales', 'GET', undefined, secondCookie)).data
        assert.equal(other.summary.quantity_sold, 5); assert.equal(other.orders.length, 1)
        const admin = await request(`/admin/staff/${firstId}/sales`, 'GET', undefined, adminCookie)
        assert.deepEqual(admin.data.summary, own.summary)
        const none = (await request('/admin/staff/unassigned/sales', 'GET', undefined, adminCookie)).data
        assert.ok(none.orders.every(o => !o.staff_name)); assert.ok(none.summary.quantity_sold >= 2)
        const members = (await request('/admin/staff', 'GET', undefined, adminCookie)).data.staff
        assert.equal(members.find(m => m.id === firstId).quantity_sold, 3)
        assert.equal(members.find(m => m.id === secondId).quantity_sold, 5)
        assert.equal((await request(`/admin/staff/${secondId}/sales`, 'GET', undefined, firstCookie)).status, 401)
        assert.equal((await request('/staff/sales?page=0', 'GET', undefined, firstCookie)).status, 400)
        assert.equal((await updateFirst({ permissions: { ...access, sales_view: false } })).status, 200)
        assert.equal((await request('/staff/sales', 'GET', undefined, firstCookie)).status, 403)
      })
      await t.test('renaming preserves order history, resetting passwords revokes sessions and deactivation blocks checkout', async () => {
        const newPassword = 'New-Staff-Password-456!'
        assert.equal((await updateFirst({ name: 'Renamed Staff', password: newPassword })).status, 200)
        assert.equal((await request('/staff/me', 'GET', undefined, firstCookie)).status, 401)
        assert.equal((await staffLogin(first.email)).status, 401)
        const login = await request('/staff/login', 'POST', { email: first.email, password: newPassword })
        assert.equal(login.status, 200); firstCookie = login.cookie
        const historical = (await request(`/admin/staff/${firstId}/sales`, 'GET', undefined, adminCookie)).data
        assert.ok(historical.orders.every(o => o.staff_name === 'Staff One'))
        assert.equal((await updateFirst({ name: 'Renamed Staff', is_active: false })).status, 200)
        assert.equal((await request('/staff/me', 'GET', undefined, firstCookie)).status, 401)
        assert.equal((await request('/staff/login', 'POST', { email: first.email, password: newPassword })).status, 401)
        assert.equal((await request('/orders', 'POST', orderBody(firstId), customerCookie, { 'Idempotency-Key': randomUUID() })).status, 400)
        const choices = (await request('/checkout/staff', 'GET', undefined, customerCookie)).data.staff
        assert.ok(!choices.some(m => m.id === firstId))
        assert.equal((await request(`/admin/staff/${firstId}/sales`, 'GET', undefined, adminCookie)).data.summary.quantity_sold, 3)
        const retry = await request('/orders', 'POST', orderBody(null, 3), customerCookie, { 'Idempotency-Key': assignedOrder.key })
        assert.equal(retry.status, 200); assert.equal(retry.data.staff_name, 'Staff One')
        assert.equal((await request('/staff/logout', 'POST', {}, secondCookie)).status, 200)
        assert.equal((await request('/staff/me', 'GET', undefined, secondCookie)).status, 401)
      })
    })

  } finally {
    if (server) await new Promise((resolve) => server.close(resolve))
    if (pool) await pool.end()
    if (!/^sipup_vat_test_[a-f0-9]{32}$/.test(dbName)) throw new Error('Unsafe test database cleanup refused.')
    try { if (created) await connection.query(`DROP DATABASE IF EXISTS \`${dbName}\``) }
    finally { await connection.end() }
  }
})
