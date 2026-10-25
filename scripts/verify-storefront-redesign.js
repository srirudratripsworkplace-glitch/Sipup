import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { randomUUID, randomBytes } from 'node:crypto'
import { app } from '../server/index.js'
import { pool } from '../server/pool.js'

const output='reports/responsive'
await mkdir(output,{recursive:true})
const server=app.listen(0,'127.0.0.1')
await new Promise(resolve=>server.once('listening',resolve))
const base=`http://127.0.0.1:${server.address().port}`
let chrome, socket, temporaryCustomer
const errors=[],results=[]
try {
  chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',[
    '--headless=new','--remote-debugging-port=0','--no-first-run','--no-default-browser-check',
    '--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--disable-features=RendererCodeIntegrity',
    '--disable-background-networking',`--user-data-dir=${resolve(output,'chrome-profile')}`,'about:blank',
  ],{windowsHide:true,stdio:['ignore','ignore','pipe']})
  const endpoint=await new Promise((resolve,reject)=>{
    let logs=''
    const timeout=setTimeout(()=>reject(new Error('Chrome did not start within 20 seconds.')),20000)
    chrome.on('error',reject)
    chrome.stderr.on('data',chunk=>{
      logs+=chunk.toString()
      const match=logs.match(/DevTools listening on (ws:\/\/[^\s]+)/)
      if(match){clearTimeout(timeout);resolve(match[1])}
    })
  })
  console.log('Chrome started.')
  socket=new WebSocket(endpoint)
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject})
  let next=0,session
  const pending=new Map()
  socket.onmessage=event=>{
    const data=JSON.parse(event.data)
    if(data.id){const entry=pending.get(data.id);if(!entry)return;pending.delete(data.id);clearTimeout(entry.timeout);data.error?entry.reject(new Error(data.error.message)):entry.resolve(data.result)}
    if(data.method==='Runtime.exceptionThrown') errors.push(data.params.exceptionDetails.text+': '+data.params.exceptionDetails.exception?.description)
    if(data.method==='Runtime.consoleAPICalled'&&data.params.type==='error') errors.push(data.params.args.map(x=>x.value||x.description).join(' '))
  }
  const send=(method,params={},root=false)=>new Promise((resolve,reject)=>{
    const id=++next
    const timeout=setTimeout(()=>{pending.delete(id);reject(new Error(`Chrome command timed out: ${method}`))},15000)
    pending.set(id,{resolve,reject,timeout})
    socket.send(JSON.stringify({id,method,params,...(!root&&session?{sessionId:session}:{})}))
  })
  const {targetId}=await send('Target.createTarget',{url:'about:blank'},true)
  session=(await send('Target.attachToTarget',{targetId,flatten:true},true)).sessionId
  await send('Page.enable');await send('Runtime.enable');await send('Network.enable');await send('Network.clearBrowserCookies')
  const evaluate=async expression=>{
    const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true})
    if(result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text)
    return result.result.value
  }
  const until=async expression=>{
    const deadline=Date.now()+15000
    while(Date.now()<deadline){if(await evaluate(expression))return;await new Promise(resolve=>setTimeout(resolve,150))}
    throw new Error(`Timed out: ${expression}`)
  }
  const navigate=async path=>{
    await send('Page.navigate',{url:base+path})
    await until(`document.readyState==='complete' && !!document.querySelector('h1')`)
  }
  const viewport=async width=>send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<760})
  const screenshot=async(name,selector)=>{
    const box=await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height,scale:1}})()`)
    const {data}=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:box})
    await writeFile(`${output}/${name}.png`,Buffer.from(data,'base64'))
  }
  const assertNoOverflow=async name=>{
    const sizes=await evaluate(`({width:innerWidth,documentWidth:document.documentElement.scrollWidth})`)
    assert.ok(sizes.documentWidth<=sizes.width,`${name} overflows: ${JSON.stringify(sizes)}`)
    return sizes
  }
  const data=await fetch(base+'/api/products?limit=48').then(r=>r.json())
  const product=data.products.find(p=>p.stock_quantity>6&&p.units_per_case>1)
  assert.ok(product)
  const password=randomBytes(18).toString('hex')
  const email='ui-test-'+randomUUID()+'@example.invalid'
  const registration=await fetch(base+'/api/account/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Responsive UI Test',phone:'+4407000000000',email,password})})
  assert.equal(registration.status,201)
  temporaryCustomer=(await registration.json()).customer
  const fill=async(selector,value)=>evaluate('(()=>{const input=document.querySelector('+JSON.stringify(selector)+');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(input,'+JSON.stringify(value)+');input.dispatchEvent(new Event("input",{bubbles:true}));})()')
  const shot=async name=>{
    await evaluate('scrollTo({top:0,left:0,behavior:"instant"});new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
    const {data}=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false})
    await writeFile(output+'/'+name+'.png',Buffer.from(data,'base64'))
  }
  await viewport(390);await navigate('/shop')
  await evaluate("localStorage.removeItem('sipup-cart');localStorage.removeItem('sipup-vat-display');sessionStorage.removeItem('sipup-pending-bag')")
  await navigate('/shop')
  await until("document.querySelectorAll('.catalogue-card').length>0")
  await fill('.catalogue-card .card-stepper input',2)
  const chosenSlug=await evaluate("document.querySelector('.catalogue-card .product-name').getAttribute('href')")
  await evaluate("document.querySelector('.card-cart-button').click()")
  await until("location.pathname==='/account/login'&&!!document.querySelector('input[type=email]')")
  assert.equal(await evaluate("JSON.parse(localStorage.getItem('sipup-cart')||'[]').length"),0)
  assert.equal(await evaluate("JSON.parse(sessionStorage.getItem('sipup-pending-bag')).quantity"),2)
  await shot('guest-login-390')
  const redirect=await evaluate("new URLSearchParams(location.search).get('redirect')")
  assert.equal(redirect,'/shop')
  await evaluate("document.querySelector('.account-mode-switch a').click()")
  await until("location.pathname==='/account/register'&&!!document.querySelector('input[autocomplete=name]')")
  assert.equal(await evaluate("new URLSearchParams(location.search).get('redirect')"),redirect)
  await evaluate("document.querySelector('.account-mode-switch a').click()")
  await until("location.pathname==='/account/login'&&!!document.querySelector('input[type=email]')")
  await fill('input[type=email]',email);await fill('input[autocomplete=current-password]',password)
  await evaluate("document.querySelector('.login-card form').requestSubmit()")
  await until("location.pathname==='/shop'&&JSON.parse(localStorage.getItem('sipup-cart')||'[]').some(i=>i.quantity===2)")
  assert.equal(await evaluate("sessionStorage.getItem('sipup-pending-bag')"),null)
  console.log('Guest sign-in and pending quantity verified.')
  await navigate(chosenSlug)
  await until("!!document.querySelector('.pdp-info')")
  await evaluate("document.querySelector('[aria-label=\"Increase quantity\"]').click()")
  await until("+document.querySelector('.pdp-stepper input').value===2")
  await evaluate("document.querySelector('.pdp-add-button').click()")
  await until("JSON.parse(localStorage.getItem('sipup-cart')||'[]').some(i=>i.quantity===4)")
  await evaluate("document.querySelector('[aria-label=\"Enlarge product image\"]').click()")
  await until("document.querySelector('.pdp-image-dialog').open")
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27})
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27})
  await until("!document.querySelector('.pdp-image-dialog').open")
  const screens=[320,360,390,430,600,768,820,1024,1180,1440]
  for(const width of screens) {
    console.log('Checking '+width+'px phone/tablet/desktop layouts.')
    await viewport(width)
    const checks={width}
    for(const [name,path,ready] of [
      ['home','/',"document.querySelectorAll('.aisle-product').length===6&&document.querySelectorAll('.hero-art-product').length===3&&Array.from(document.querySelectorAll('.hero-art-product')).every(i=>i.complete&&i.naturalWidth>0)"],
      ['shop','/shop',"document.querySelectorAll('.catalogue-card').length>0"],
      ['product','/product/'+product.slug,"!!document.querySelector('.pdp-info')"],
      ['cart','/cart',"!!document.querySelector('.cart-row')"],
      ['checkout','/checkout',"!!document.querySelector('.checkout-grid')"],
      ['contact','/contact',"!!document.querySelector('.legal-page')"],
    ]) {
      await navigate(path);await until(ready)
      checks[name]=await assertNoOverflow(name+' '+width)
      if([390,820,1024,1440].includes(width)) await shot(name+'-'+width)
    }
    results.push(checks)
  }
  await viewport(390);await navigate('/')
  await evaluate("document.querySelector('[aria-label=\"Search products\"]').click()")
  await until("document.querySelector('.store-search-dialog').open")
  await fill('[aria-label=\"Search the SipUp range\"]','Fanta')
  await evaluate("document.querySelector('.store-search-dialog form').requestSubmit()")
  await until("location.pathname==='/shop'&&new URLSearchParams(location.search).get('search')==='Fanta'&&document.querySelectorAll('.product-name').length>0&&Array.from(document.querySelectorAll('.product-name')).every(e=>/fanta/i.test(e.textContent))")
  assert.equal(await evaluate('scrollY'),0)
  await shot('search-390')
  await evaluate("document.querySelector('[aria-label=\"Search products\"]').click()")
  await until("document.querySelector('.store-search-dialog').open")
  await fill('[aria-label=\"Search the SipUp range\"]','Monster')
  await evaluate("document.querySelector('.store-search-dialog form').requestSubmit()")
  await until("new URLSearchParams(location.search).get('search')==='Monster'&&document.querySelectorAll('.product-name').length>0&&Array.from(document.querySelectorAll('.product-name')).every(e=>/monster/i.test(e.textContent))")
  await fill('.catalog-tools input[type=search]','Haribo')
  await evaluate("document.querySelector('.catalog-tools').requestSubmit()")
  await until("new URLSearchParams(location.search).get('search')==='Haribo'&&document.querySelectorAll('.product-name').length>0&&Array.from(document.querySelectorAll('.product-name')).every(e=>/haribo/i.test(e.textContent))")
  console.log('Header, repeated searches, and catalogue search verified.')
  await navigate('/shop');await until("document.querySelectorAll('.catalogue-card').length>0")
  await evaluate("scrollTo(0,document.documentElement.scrollHeight);document.querySelector('.pagination button:last-child').click()")
  await until("document.querySelector('.pagination span').textContent.startsWith('Page 2')&&document.querySelectorAll('.catalogue-card').length>0&&scrollY===0")
  await evaluate('scrollTo(0,1500)')
  await until('scrollY>100')
  await evaluate("document.querySelector('.product-name').click()")
  await until("location.pathname.startsWith('/product/')&&!!document.querySelector('.pdp-info')")
  assert.equal(await evaluate('scrollY'),0)
  await until("document.querySelectorAll('.pdp-related-card').length>0")
  await evaluate('scrollTo(0,document.documentElement.scrollHeight)')
  await evaluate("document.querySelector('.pdp-related-card').click()")
  await until("!!document.querySelector('.pdp-info')&&scrollY===0")
  await viewport(820);await navigate('/')
  await evaluate("document.querySelector('.mobile-menu').click()")
  await until("document.querySelector('.mobile-menu').getAttribute('aria-expanded')==='true'")
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.main-nav')).display"),'flex')
  await shot('ipad-navigation-820')
  await evaluate("document.querySelector('.main-nav a').click()")
  await until("location.pathname==='/shop'&&document.querySelector('.mobile-menu').getAttribute('aria-expanded')==='false'")
  assert.notEqual(await evaluate('document.body.style.overflow'),'hidden')
  assert.equal(await evaluate('scrollY'),0)
  // Revoke the browser session. A previously signed-in shopper must be gated again.
  await evaluate("fetch('/api/account/logout',{method:'POST'})")
  await navigate('/product/'+product.slug)
  await until("!!document.querySelector('.pdp-info')")
  const savedCart=await evaluate("localStorage.getItem('sipup-cart')")
  await evaluate("document.querySelector('.pdp-add-button').click()")
  await until("location.pathname==='/account/login'&&!!document.querySelector('input[type=email]')")
  assert.equal(await evaluate("localStorage.getItem('sipup-cart')"),savedCart)
  for(const width of [320,390,768,820,1024]) {
    await viewport(width);await navigate('/account/login');await until("!!document.querySelector('.login-card form')")
    await assertNoOverflow('Login '+width)
    if(width===390||width===820) await shot('login-'+width)
    await navigate('/checkout');await until("!!document.querySelector('.account-gate')")
    await assertNoOverflow('Guest checkout '+width)
  }
  assert.deepEqual(errors,[],'Browser errors')
  const report={verifiedAt:new Date().toISOString(),viewports:results,guestAddRedirectsToLogin:true,guestCartUnchanged:true,productAndQuantityRestoredAfterLogin:true,registrationPreservesReturnPage:true,signedInAddWorks:true,expiredSessionBlocked:true,headerSearch:true,repeatedSearch:true,catalogueSearch:true,routeScrollResets:true,paginationStartsAtTop:true,relatedProductStartsAtTop:true,tabletMenuWorks:true,zoomAndEscape:true,browserErrors:errors}
  await writeFile(output+'/verification.json',JSON.stringify(report,null,2))
  console.log(JSON.stringify(report,null,2))
  await send('Browser.close',{},true).catch(()=>{})
} finally {
  socket?.close();chrome?.kill()
  server.closeAllConnections()
  await new Promise(resolve=>server.close(resolve))
  if(temporaryCustomer) {
    await pool.query('DELETE FROM customers WHERE id=? AND email=?',[temporaryCustomer.id,temporaryCustomer.email])
    console.log('Removed the disposable test customer and its sessions.')
  }
  await pool.end()
}
