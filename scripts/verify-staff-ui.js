// Run through: npm run test:staff-ui (requires a built client and Chrome).
import 'dotenv/config'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import mysql from 'mysql2/promise'
import bcrypt from 'bcryptjs'
import sharp from 'sharp'
import express from 'express'

if (process.env.SIPUP_TEST_MYSQL !== '1') throw new Error('Use the isolated MySQL test runner.')
const dbName = `sipup_staff_ui_${randomUUID().replaceAll('-', '')}`
const control = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER, password: process.env.DB_PASSWORD })
let pool, server, chrome, socket, created = false
const output = 'reports/staff'
const results = [], errors = []
try {
  await control.query(`CREATE DATABASE \`${dbName}\``); created = true
  process.env.DB_NAME = dbName; process.env.NODE_ENV = 'test'; process.env.COOKIE_SECURE = 'false'; process.env.SMTP_PASSWORD = ''
  const migrated = spawnSync(process.execPath, ['server/migrate.js'], { env: process.env, encoding: 'utf8', windowsHide: true })
  assert.equal(migrated.status, 0, migrated.stderr)
  ;({ pool } = await import('../server/pool.js'))
  await pool.query('INSERT INTO admins (email,password_hash) VALUES (?,?)', ['browser-admin@example.test', await bcrypt.hash('Browser-Admin-Password-123!', 4)])
  const { app } = await import('../server/index.js')
  app.use(express.static(resolve('dist')))
  app.get(/.*/, (_req, res) => res.sendFile(resolve('dist/index.html')))
  server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r))
  const base = `http://127.0.0.1:${server.address().port}`
  const request = async (path, method = 'GET', body, cookie) => {
    const response = await fetch(base + '/api' + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    const data = await response.json(); assert.ok(response.ok, `${path}: ${JSON.stringify(data)}`)
    return { data, cookie: response.headers.get('set-cookie')?.split(';')[0] }
  }
  const adminCookie = (await request('/auth/login', 'POST', { email: 'browser-admin@example.test', password: 'Browser-Admin-Password-123!' })).cookie
  const customerCookie = (await request('/account/register', 'POST', { name: 'Browser Store', phone: '07123456789', email: 'browser-customer@example.test', password: 'Browser-Customer-Password-123!' })).cookie
  const { storeImage } = await import('../server/product-media.js')
  const imageUrl = await storeImage(pool, await sharp({ create: { width: 20, height: 30, channels: 3, background: '#2a664b' } }).png().toBuffer())
  const product = (await request('/admin/products', 'POST', { name: 'Browser Test Drink', sku: 'BROWSER-DRINK', image_url: imageUrl, category: 'Drinks', price_pence: 1000, stock_quantity: 10, vat_treatment: 'standard', vat_confirmed: true, price_entry_mode: 'exclusive', is_published: true }, adminCookie)).data.product
  await mkdir(output, { recursive: true })
  chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check', '--no-sandbox', '--disable-gpu', '--disable-background-networking', `--user-data-dir=${resolve(output, 'chrome-profile')}`, 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
  const endpoint = await new Promise((done, reject) => {
    let logs = ''; const timer = setTimeout(() => reject(new Error('Chrome startup timed out')), 20000)
    chrome.on('error', reject); chrome.stderr.on('data', chunk => { logs += chunk; const match = logs.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) { clearTimeout(timer); done(match[1]) } })
  })
  socket = new WebSocket(endpoint); await new Promise((done, reject) => { socket.onopen = done; socket.onerror = reject })
  let next = 0, session
  const pending = new Map()
  socket.onmessage = event => {
    const data = JSON.parse(event.data)
    if (data.id) { const entry = pending.get(data.id); if (!entry) return; pending.delete(data.id); clearTimeout(entry.timer); data.error ? entry.reject(new Error(data.error.message)) : entry.done(data.result) }
    if (data.method === 'Runtime.exceptionThrown') errors.push(data.params.exceptionDetails.exception?.description || data.params.exceptionDetails.text)
  }
  const send = (method, params = {}, root = false) => new Promise((done, reject) => {
    const id = ++next; const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Chrome command timed out: ${method}`)) }, 15000)
    pending.set(id, { done, reject, timer }); socket.send(JSON.stringify({ id, method, params, ...(!root && session ? { sessionId: session } : {}) }))
  })
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' }, true)
  session = (await send('Target.attachToTarget', { targetId, flatten: true }, true)).sessionId
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable'); await send('Network.clearBrowserCookies')
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
    return result.result.value
  }
  const until = async expression => {
    for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await new Promise(r => setTimeout(r, 100)) }
    throw new Error(`Timed out: ${expression}; page: ${await evaluate('document.body.innerText')}`)
  }
  const navigate = async (path, ready) => { await send('Page.navigate', { url: base + path }); await until(`!!document.body && document.readyState==='complete' && location.pathname===${JSON.stringify(path)} && (${ready})`) }
  const setCookie = async cookie => { const split = cookie.indexOf('='); await send('Network.setCookie', { name: cookie.slice(0, split), value: cookie.slice(split + 1), url: base, httpOnly: true, sameSite: 'Strict' }) }
  const fill = async (selector, value) => evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.value=${JSON.stringify(String(value))};el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  const click = async text => evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)}).click()`)
  const capture = async name => {
    await evaluate('document.fonts.ready'); await evaluate('scrollTo(0,0);new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
    const sizes = await evaluate('({width:innerWidth,documentWidth:document.documentElement.scrollWidth})')
    assert.ok(sizes.documentWidth <= sizes.width, `${name} overflows: ${JSON.stringify(sizes)}`)
    const { data } = await send('Page.captureScreenshot', { format: 'png' }); await writeFile(`${output}/${name}.png`, Buffer.from(data, 'base64')); results.push({ name, ...sizes })
  }
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
  await setCookie(adminCookie)
  await navigate('/admin/staff', "!!document.querySelector('.staff-admin') && !document.body.innerText.includes('Loading staff')")
  await click('Add staff member')
  await fill('.staff-account-form [name=name]', 'Browser Salesperson'); await fill('.staff-account-form [name=email]', 'browser-staff@example.test'); await fill('.staff-account-form [name=password]', 'Browser-Staff-Password-123!')
  await evaluate("document.querySelector('[name=inventory_view]').click();document.querySelector('.staff-account-form form').requestSubmit()")
  await until("document.body.innerText.includes('Staff account saved.')")
  const member = (await request('/admin/staff', 'GET', undefined, adminCookie)).data.staff[0]
  assert.equal(member.permissions.inventory_view, true); assert.equal(member.permissions.inventory_manage, false)
  await capture('admin-staff-1440')
  await navigate('/staff/login', "!!document.querySelector('.login-card form')")
  await fill('[name=email]', member.email); await fill('[name=password]', 'Browser-Staff-Password-123!')
  await evaluate("document.querySelector('.login-card form').requestSubmit()")
  await until("location.pathname==='/staff' && !!document.querySelector('.staff-stats')")
  await capture('staff-sales-1440')
  await navigate('/staff/inventory', "document.body.innerText.includes('Browser Test Drink')")
  assert.equal(await evaluate("Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Adjust')"), false)
  await request(`/admin/staff/${member.id}`, 'PUT', { name: member.name, email: member.email, is_active: true, permissions: { ...member.permissions, inventory_manage: true } }, adminCookie)
  await navigate('/staff/inventory', "Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Adjust')")
  await click('Adjust'); await fill('[name=quantity]', 11); await fill('[name=reason]', 'Browser stock adjustment'); await evaluate("document.querySelector('.staff-stock-form').requestSubmit()")
  await until("document.body.innerText.includes('Stock updated for')")
  assert.equal(Number((await pool.query('SELECT stock_quantity FROM products WHERE id=?', [product.id])).rows[0].stock_quantity), 11)
  await capture('staff-inventory-1440')
  await setCookie(customerCookie)
  const checkout = async assigned => {
    await evaluate(`localStorage.setItem('sipup-cart',JSON.stringify([{product:${JSON.stringify(product)},quantity:${assigned ? 2 : 1}}]))`)
    await navigate('/checkout', "!!document.querySelector('[name=staff_id] option[value=\"" + member.id + "\"]')")
    assert.equal(await evaluate("document.querySelector('[name=staff_id]').value"), '')
    await evaluate("document.querySelectorAll('[name=preference]')[1].click()")
    await until("!!document.querySelector('.checkout-summary button:not(:disabled)') && !document.querySelector('.checkout-summary .inline-error')")
    if (assigned) await fill('[name=staff_id]', member.id)
    await capture(assigned ? 'checkout-assigned-390' : 'checkout-unassigned-390')
    await evaluate("document.querySelector('form.checkout-grid').requestSubmit()")
    await until("location.pathname.startsWith('/order-confirmation/')")
    const reference = await evaluate("location.pathname.split('/').pop()")
    const saved = (await pool.query('SELECT id,staff_id,staff_name FROM orders WHERE reference=?', [reference])).rows[0]
    assert.equal(saved.staff_id === null ? null : Number(saved.staff_id), assigned ? member.id : null)
    return saved
  }
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 1000, deviceScaleFactor: 1, mobile: true })
  const assigned = await checkout(true); await checkout(false)
  const assignedReference = (await pool.query('SELECT reference FROM orders WHERE id=?', [assigned.id])).rows[0].reference
  await navigate('/admin/orders', "!!document.querySelector('.click-row')")
  assert.equal(await evaluate("document.querySelector('.orders-panel th').textContent"), 'PRODUCTS')
  const rowText = await evaluate(`document.querySelector('[data-order-id="${assigned.id}"]').textContent`)
  assert.ok(rowText.includes(product.name)); assert.ok(!rowText.includes(assignedReference)); assert.ok(!rowText.includes(product.sku))
  assert.equal(await evaluate("document.querySelector('.order-product-thumbnail').getAttribute('href')"), imageUrl)
  await until("document.querySelector('.order-product-thumbnail img')?.naturalWidth>0")
  await send('Runtime.evaluate', { expression: "document.querySelector('a.order-product-thumbnail').click()", userGesture: true })
  let openedImage
  for (let attempt = 0; attempt < 30; attempt++) {
    openedImage = (await send('Target.getTargets', {}, true)).targetInfos.find(t => t.url === base + imageUrl)
    if (openedImage) break
    await new Promise(r => setTimeout(r,100))
  }
  assert.ok(openedImage, 'Thumbnail opens the full product image in a new tab')
  assert.equal(await evaluate("!!document.querySelector('.order-drawer')"), false)
  await send('Target.closeTarget', { targetId: openedImage.targetId }, true)
  for (const width of [390,1440]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height:1000,deviceScaleFactor:1,mobile:width<760 })
    await capture(`admin-order-products-${width}`)
  }
  await send('Emulation.setDeviceMetricsOverride', { width:390,height:1000,deviceScaleFactor:1,mobile:true })
  await evaluate(`document.querySelector('[data-order-id="${assigned.id}"] .order-product-name').click()`)
  await until("!!document.querySelector('.drawer-status-update select')")
  assert.equal(await evaluate("document.querySelector('.order-product-line a.order-product-thumbnail').getAttribute('href')"), imageUrl)
  await fill('.drawer-status-update select', 'confirmed')
  await until("document.querySelector('.order-email-status')?.textContent.includes('Pending')")
  assert.ok((await evaluate("document.querySelector('.order-email-status').textContent")).includes('Sender setup is required'))
  assert.equal(Number((await pool.query('SELECT stock_quantity FROM products WHERE id=?', [product.id])).rows[0].stock_quantity), 9)
  assert.equal((await pool.query('SELECT status FROM order_confirmation_emails WHERE order_id=?', [assigned.id])).rows[0].status, 'pending')
  await evaluate("document.querySelector('.order-email-status').scrollIntoView({block:'center'})")
  await capture('admin-confirmation-email-390')
  await navigate('/staff', "!!document.querySelector('.staff-stats')")
  assert.equal(await evaluate("document.querySelectorAll('.staff-stats strong')[1].textContent"), '2')
  assert.ok((await evaluate('document.body.innerText')).includes('Browser Test Drink'))
  await capture('staff-sales-390')
  await navigate('/staff/inventory', "document.body.innerText.includes('Browser Test Drink')"); await capture('staff-inventory-390')
  await navigate('/admin/staff', "!!document.querySelector('.staff-admin tbody tr')"); await capture('admin-staff-390')
  await fill('.staff-admin select', member.id); await until("!!document.querySelector('.staff-report .staff-stats')")
  assert.equal(await evaluate("document.querySelectorAll('.staff-report .staff-stats strong')[1].textContent"), '2')
  await fill('.staff-admin select', 'unassigned'); await until("document.querySelector('.staff-report h2')?.textContent==='Unassigned sales' && !!document.querySelector('.staff-stats')")
  assert.equal(await evaluate("document.querySelectorAll('.staff-report .staff-stats strong')[1].textContent"), '0')
  assert.equal(await evaluate("document.querySelectorAll('.staff-order').length"), 1)
  await request(`/admin/staff/${member.id}`, 'PUT', { name: member.name, email: member.email, is_active: true, permissions: { sales_view: false, inventory_view: true, inventory_manage: false } }, adminCookie)
  await evaluate("localStorage.setItem('sipup-theme','dark')")
  await navigate('/staff/login', "document.body.innerText.includes('Browser Test Drink') && !document.querySelector('.staff-stats')")
  assert.equal(await evaluate("Array.from(document.querySelectorAll('.staff-body nav a')).some(a=>a.textContent==='My sales')"), false)
  await capture('staff-inventory-only-dark-390')
  await evaluate("fetch('/api/staff/logout',{method:'POST'})")
  await navigate('/staff/login', "!!document.querySelector('.login-card form')"); await capture('staff-login-390')
  await evaluate("fetch('/api/account/logout',{method:'POST'})")
  await navigate('/account/login', "!!document.querySelector('h1')")
  assert.equal(await evaluate("!!document.querySelector('a[href=\"/staff/login\"]')"), true)
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] })
  await evaluate("localStorage.setItem('sipup-theme','light')")
  await navigate('/', "!!document.querySelector('.ticker-track')")
  const transform = () => evaluate("getComputedStyle(document.querySelector('.ticker-track')).transform")
  for (const width of [390, 1440]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width < 760 })
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 })
    const before = await transform(); await evaluate('new Promise(r=>setTimeout(r,300))'); assert.notEqual(await transform(), before)
    const groups = await evaluate("Array.from(document.querySelectorAll('.ticker-group')).map(el=>el.getBoundingClientRect().width)")
    assert.ok(Math.abs(groups[0] - groups[1]) < 0.01); assert.ok(groups[0] >= width)
    await evaluate("document.querySelector('.ticker-toggle').click()")
    await until("document.querySelector('.ticker').dataset.paused==='true'")
    await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
    const paused = await transform(); await evaluate('new Promise(r=>setTimeout(r,150))'); assert.equal(await transform(), paused)
    await evaluate("document.querySelector('.ticker-toggle').click()")
    await until("document.querySelector('.ticker').dataset.paused==='false'")
    await capture(`homepage-scrolling-ribbon-${width}`)
  }
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.ticker-track')).animationName"), 'none')
  assert.deepEqual(errors, [])
  await writeFile(`${output}/verification.json`, JSON.stringify({ checks: results, runtimeErrors: errors, workflows: ['admin creates staff', 'staff login', 'view-only inventory', 'permission grant', 'audited stock adjustment', 'assigned checkout', 'unassigned checkout', 'staff sales', 'admin sales reports', 'admin confirmation and email status', 'scrolling offers', 'pause and reduced motion'] }, null, 2))
  console.log(JSON.stringify({ browserChecksPassed: results.length, runtimeErrors: errors.length, isolatedDatabase: true }))
} finally {
  socket?.close(); chrome?.kill()
  if (server) await new Promise(r => server.close(r))
  if (pool) await pool.end()
  if (!/^sipup_staff_ui_[a-f0-9]{32}$/.test(dbName)) throw new Error('Unsafe test database cleanup refused.')
  if (created) await control.query(`DROP DATABASE \`${dbName}\``)
  await control.end()
}
