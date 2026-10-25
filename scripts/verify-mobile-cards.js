import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { app } from '../server/index.js'
import { pool } from '../server/pool.js'

const output='reports/mobile-cards'
await mkdir(output,{recursive:true})
const server=app.listen(0,'127.0.0.1')
await new Promise(resolve=>server.once('listening',resolve))
const base=`http://127.0.0.1:${server.address().port}`
let chrome, socket
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
    await until(`document.readyState!=='loading' && !!document.querySelector('h1, .empty-state h2')`)
  }
  const viewport=async width=>send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<760})
  const screenshot=async(name,selector)=>{
    const box=await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:Math.min(r.height,1000),scale:1}})()`)
    const {data}=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:box})
    await writeFile(`${output}/${name}.png`,Buffer.from(data,'base64'))
  }
  const assertNoOverflow=async name=>{
    const sizes=await evaluate(`({width:innerWidth,documentWidth:document.documentElement.scrollWidth})`)
    assert.ok(sizes.documentWidth<=sizes.width,`${name} overflows: ${JSON.stringify(sizes)}`)
    return sizes
  }
  const data=await fetch(base+'/api/products?limit=48').then(r=>r.json())
  const product=data.products.find(p=>p.stock_quantity>0)
  for (const theme of ['light', 'dark']) {
    await viewport(390); await navigate('/')
    await evaluate(`localStorage.setItem('sipup-appearance',${JSON.stringify(theme)})`)
    for (const width of [280,320,360,390,430,600,760,768,820,1024,1101,1280,1440,1920]) {
      await viewport(width)
      for (const path of ['/', '/shop', '/product/'+product.slug, '/cart', '/checkout', '/account/login', '/contact']) {
        console.log(theme,width,path); await navigate(path)
        if (path==='/' || path==='/shop') await until("!!document.querySelector('.catalogue-card')")
        const sizes=await assertNoOverflow(theme+' '+width+' '+path)
        assert.equal(await evaluate('visualViewport.scale'),1)
        if(width<=760){
          assert.equal(await evaluate("[...document.querySelectorAll('input:not([type=checkbox]):not([type=radio]),select,textarea')].every(e=>parseFloat(getComputedStyle(e).fontSize)>=16)"),true)
        }
        if(path==='/') {
          await until("!!document.querySelector('.aisles-grid')" )
          const aisle=await evaluate(`(()=>{const grid=document.querySelector('.aisles-grid'),cards=[...grid.children],a=cards[0].getBoundingClientRect(),b=cards[1].getBoundingClientRect();return {sameRow:Math.abs(a.top-b.top)<2,scrolls:grid.scrollWidth>grid.clientWidth,overflow:getComputedStyle(grid).overflowX}})()`)
          assert.ok(aisle.sameRow)
          if(width<=760) {assert.ok(aisle.scrolls);assert.equal(aisle.overflow,'auto')}
          else assert.equal(aisle.scrolls,false)
          if(width===390&&theme==='light') { await screenshot('aisles-390','.aisles-section'); await screenshot('home-390','.hero') }
        }
        if(path==='/shop') {
          if(width===390) {
            assert.equal(await evaluate("getComputedStyle(document.querySelector('.mobile-bottom-nav')).display"),'grid')
            assert.equal(await evaluate("getComputedStyle(document.querySelector('.catalog-advanced-filters')).display"),'none')
            await evaluate("document.querySelector('.mobile-filter-toggle').click()")
            assert.equal(await evaluate("document.querySelector('.mobile-filter-toggle').getAttribute('aria-expanded')"),'true')
            assert.equal(await evaluate("getComputedStyle(document.querySelector('.catalog-advanced-filters')).display"),'grid')
            await assertNoOverflow('expanded filters '+theme)
            await evaluate("document.querySelector('.mobile-filter-toggle').click()")
          }
          const clipped=await evaluate("[...document.querySelectorAll('.catalogue-card .card-stepper, .catalogue-card .card-cart-button')].filter(e=>e.scrollWidth>e.clientWidth+1).length")
          assert.equal(clipped,0,`Clipped purchase controls at ${width}`)
          if([320,390,760,1440].includes(width)) await screenshot(theme+'-cards-'+width,'.product-grid')
          if(width===390){
            await evaluate("document.querySelector('.card-stepper button:last-child').click()")
            assert.equal(await evaluate("Number(document.querySelector('.card-stepper input').value)"),product.min_quantity+1)
          }
        }
        results.push({theme,width,path,...sizes})
      }
      console.log(theme,width,'passed')
    }
  }
  await viewport(390);await navigate('/')
  await evaluate("localStorage.removeItem('sipup-appearance');localStorage.setItem('sipup-theme','dark')")
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'dark'}]})
  await navigate('/')
  assert.equal(await evaluate('document.documentElement.dataset.theme'),'light')
  await evaluate("document.querySelector('.mobile-menu').click()")
  assert.equal(await evaluate("document.querySelector('.mobile-menu').getAttribute('aria-expanded')"),'true')
  await evaluate("document.querySelector('.mobile-menu-appearance .theme-toggle').click()")
  await until("document.documentElement.dataset.theme==='dark'")
  await navigate('/shop')
  assert.equal(await evaluate('document.documentElement.dataset.theme'),'dark')
  assert.deepEqual(errors,[])
  await writeFile(output+'/verification.json',JSON.stringify({noHorizontalOverflow:true,initialScale:1,mobileInputSize:16,aisleSwipe:true,results},null,2))
  await send('Browser.close',{},true).catch(()=>{})
} finally {
  socket?.close();chrome?.kill();server.closeAllConnections()
  await new Promise(resolve=>server.close(resolve));await pool.end()
}


