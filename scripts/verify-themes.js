import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { app } from '../server/index.js'
import { pool } from '../server/pool.js'

const output='reports/themes'
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
    await until(`document.readyState==='complete' && !!document.querySelector('h1, .empty-state h2')`)
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
  const product=data.products.find(p=>p.stock_quantity>0)
  const contrastAudit=()=>{
    const rgb=value=>(value.match(/[\d.]+/g)||[]).map(Number)
    const luminance=c=>c.slice(0,3).map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4}).reduce((sum,x,i)=>sum+x*[.2126,.7152,.0722][i],0)
    const failures=[]
    for(const el of document.querySelectorAll('body *')){
      if(![...el.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())||el.closest('svg')||el.disabled)continue
      const rect=el.getBoundingClientRect(),style=getComputedStyle(el)
      if(!rect.width||!rect.height||style.visibility==='hidden')continue
      let bg=[255,255,255],layers=[],image=false
      for(let node=el;node;node=node.parentElement){const s=getComputedStyle(node);if(s.backgroundImage!=='none')image=true;layers.push(rgb(s.backgroundColor))}
      if(image)continue
      for(const c of layers.reverse()){const a=c[3]??1;bg=bg.map((x,i)=>x*(1-a)+(c[i]||0)*a)}
      const fg=rgb(style.color),a=fg[3]??1,actual=fg.slice(0,3).map((x,i)=>x*a+bg[i]*(1-a))
      const l1=luminance(actual),l2=luminance(bg),ratio=(Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05)
      const large=parseFloat(style.fontSize)>=24||(parseFloat(style.fontSize)>=18.66&&parseInt(style.fontWeight)>=700)
      if(ratio<(large?3:4.5))failures.push({tag:el.tagName,cls:el.className,text:el.textContent.trim().slice(0,65),ratio:+ratio.toFixed(2),color:style.color,bg})
    }
    return failures
  }
  for(const theme of ['light','dark']){
    await viewport(390);await navigate('/')
    await evaluate(`localStorage.setItem('sipup-theme',${JSON.stringify(theme)})`)
    await navigate('/')
    await until(`document.documentElement.dataset.theme===${JSON.stringify(theme)} && !!document.querySelector('.aisle-card')`)
    for(const width of [320,360,390,430,768,820,1024,1101,1440]){
      await viewport(width)
      for(const path of ['/', '/shop','/product/'+product.slug,'/cart','/checkout','/account/login','/contact']){
        console.log(theme,width,path)
        await navigate(path)
        if(path==='/shop')await until("!!document.querySelector('.catalogue-card')")
        if(path.startsWith('/product/'))await until("!!document.querySelector('.pdp-info')")
        await assertNoOverflow(theme+' '+width+' '+path)
        assert.equal(await evaluate('visualViewport.scale'),1)
        if(width<=1100){
          const small=await evaluate(`Array.from(document.querySelectorAll('input:not([type=checkbox]):not([type=radio]),select,textarea')).filter(el=>el.getBoundingClientRect().width&&parseFloat(getComputedStyle(el).fontSize)<16).map(el=>el.className)`)
          assert.deepEqual(small,[], 'Small mobile inputs on '+path)
        }
        if(width===390||width===1440){
          const failures=await evaluate('('+contrastAudit.toString()+')()')
          results.push({theme,width,path,contrastFailures:failures})
          if(['/', '/shop','/product/'+product.slug,'/account/login'].includes(path)){
            await evaluate('scrollTo(0,0);new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
            const {data}=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false})
            await writeFile(output+'/'+theme+'-'+width+'-'+(path==='/'?'home':path.startsWith('/product/')?'product':path.split('/').pop())+'.png',Buffer.from(data,'base64'))
          }
        }
      }
    }
  }
  for(const width of [320,390,820,1440]){
    await viewport(width);await navigate('/')
    await evaluate("document.querySelector('.theme-toggle').click()")
    await until("document.documentElement.dataset.theme==='light'")
    await navigate('/shop')
    assert.equal(await evaluate('document.documentElement.dataset.theme'),'light')
    await evaluate("document.querySelector('.theme-toggle').click()")
    await until("document.documentElement.dataset.theme==='dark'")
    await navigate('/');assert.equal(await evaluate('document.documentElement.dataset.theme'),'dark')
  }
  await evaluate("localStorage.removeItem('sipup-theme')")
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'dark'}]})
  await navigate('/');assert.equal(await evaluate('document.documentElement.dataset.theme'),'dark')
  assert.deepEqual(errors,[])
  await writeFile(output+'/verification.json',JSON.stringify({verifiedAt:new Date().toISOString(),widths:[320,360,390,430,768,820,1024,1101,1440],themes:['light','dark'],noHorizontalOverflow:true,initialScale:1,mobileInputsAtLeast16px:true,toggleAndPersistence:true,systemDarkDefault:true,browserErrors:errors,results},null,2))
  console.log('Theme and mobile checks passed. Contrast findings: '+results.reduce((s,r)=>s+r.contrastFailures.length,0))
  await send('Browser.close',{},true).catch(()=>{})
} finally {
  socket?.close();chrome?.kill();server.closeAllConnections()
  await new Promise(resolve=>server.close(resolve));await pool.end()
}
