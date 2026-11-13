import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomBytes, scryptSync } from 'node:crypto'
import { createProductionServer } from '../server/production.js'
import { registerApiRoutes } from '../server/assistant-plugin.js'
const dataRoot = await mkdtemp(path.join(tmpdir(), 'salescope-browser-data-'))
const password = 'test-only-password-12345', salt = randomBytes(16).toString('hex')
const routes=[]
registerApiRoutes({ use: (prefix,handler) => routes.push({prefix,handler}) }, {modelCall: async messages => {
 const last=messages.at(-1).content, question=messages.find(message=>message.role==='user')?.content||''
 if(last.includes('"chart_id":"chart-1"'))return JSON.stringify({action:'finish',result_id:'result-1',chart_id:'chart-1'})
 if(last.startsWith('Observation')&&last.includes('"result_id":"result-1"'))return JSON.stringify(question.includes('图')?{action:'render_chart',result_id:'result-1',type:'bar',title:'记录数'}:{action:'finish',result_id:'result-1'})
 return JSON.stringify({action:'query_data',plan:{group_by:[],measures:[{column:null,aggregate:'count',alias:'记录数'}],filters:[],order:null,limit:null}})
}})
const server=createProductionServer({users:{tester:`scrypt:${salt}:${scryptSync(password,salt,32).toString('hex')}`},dataRoot,routes})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const origin=`http://127.0.0.1:${server.address().port}`
const scratch = await mkdtemp(path.join(tmpdir(), 'salescope-v2-check-'))
const chrome = spawn(process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${scratch}`, 'about:blank'], { stdio: 'ignore' })
let socket
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
try {
  let debugPort
  for (let attempt = 0; attempt < 150; attempt += 1) {
    try { debugPort = (await readFile(path.join(scratch, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break } catch { await delay(100) }
  }
  if (!debugPort) throw new Error('无法启动独立浏览器')
  const target = await (await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: 'PUT' })).json()
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
  let sequence = 0
  const pending = new Map()
  const exceptions = []
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.id) { const handler = pending.get(message.id); pending.delete(message.id); if (message.error) handler?.reject(new Error(message.error.message)); else handler?.resolve(message.result) }
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.text)
  })
  const command = (method, params = {}) => new Promise((resolve, reject) => { const identifier = ++sequence; pending.set(identifier, { resolve, reject }); socket.send(JSON.stringify({ id: identifier, method, params })) })
  const evaluate = async (expression) => {
    const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
    return result.result.value
  }
  const waitFor = async (expression, timeout = 30000) => {
    const started = Date.now()
    while (Date.now() - started < timeout) { if (await evaluate(expression)) return; await delay(100) }
    throw new Error(`页面等待超时：${expression}`)
  }
  const select = async (label, value) => { await evaluate(`(() => { const control = document.querySelector(${JSON.stringify(`select[aria-label=${JSON.stringify(label)}]`)}); if (!control) throw new Error('找不到选择控件'); control.value = ${JSON.stringify(value)}; control.dispatchEvent(new Event('change', {bubbles:true})); })()`); await delay(100) }
  const clickNav = async (label) => { await evaluate(`Array.from(document.querySelectorAll('nav button')).find(button => button.textContent === ${JSON.stringify(label)}).click()`); await delay(100) }
  await command('Page.enable');await command('Runtime.enable');await command('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false})
  const click=async label=>evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent===${JSON.stringify(label)}).click()`)
  await command('Page.navigate',{url:origin+'/'})
  await waitFor("document.querySelector('.top-actions')?.textContent.includes('游客体验')")
  assert.deepEqual(await evaluate("Array.from(document.querySelectorAll('.sidebar nav button')).map(b=>b.textContent)"),['数据分析','政策复盘'])
  assert.equal(await evaluate("document.querySelectorAll('.demo-steps button').length"),0)
  assert.ok(await evaluate("document.querySelector('[aria-label=数据分析项目介绍]')?.textContent.includes('L2 Agent 编排')"))
  assert.equal(await evaluate("document.querySelectorAll('.architecture-lane').length"),4)
  assert.equal(await evaluate("document.querySelectorAll('.question-journey').length"),0)
  assert.ok(await evaluate("document.querySelector('.analysis-architecture').textContent.includes('Agent工具循环')"))
  assert.ok(await evaluate(`(() => {
    const expected = { 'follow-up':['view','question'], 'clarify':['understand','question'], 'tool-call':['choose','validate'], 'tool-feedback':['return','feedback'], 'tool-loop':['feedback','choose'], 'archive':['finish','history'], 'restore':['review','confirm'] };
    return Object.entries(expected).every(([id,[from,to]]) => { const edge = document.querySelector('[data-edge='+id+']'); return edge?.dataset.from===from && edge.dataset.to===to && edge.getTotalLength()>0 && edge.getAttribute('marker-end') && document.querySelector('[data-node='+from+']') && document.querySelector('[data-node='+to+']'); });
  })()`))
  const diagramWidth = await evaluate("document.querySelector('.architecture-svg').getBoundingClientRect().width")
  await click('放大')
  assert.ok(await evaluate("document.querySelector('.architecture-svg').getBoundingClientRect().width") > diagramWidth)
  await click('默认比例')
  assert.equal(await evaluate("document.querySelector('.architecture-svg').getBoundingClientRect().width"), diagramWidth)
  // SVG text must stay inside its own shape and the diagram viewport.
  assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('.architecture-node')).flatMap(node => {
    const box=node.querySelector('rect,polygon').getBBox();
    return Array.from(node.querySelectorAll('text')).filter(text=>{const b=text.getBBox();return b.x<box.x || b.x+b.width>box.x+box.width || b.y<box.y || b.y+b.height>box.y+box.height;}).map(text=>text.textContent);
  })`), [])
  await command('Page.getLayoutMetrics').then(async metrics=>{const r=await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:0,width:1440,height:metrics.cssContentSize.height,scale:1}});await writeFile(path.join(scratch,'analysis-layers.png'),Buffer.from(r.data,'base64'))})
  await click('开始数据分析演示')
  await waitFor("document.querySelectorAll('.kpi-card').length===4")
  await click('下一步：确认数据口径')
  await waitFor("document.body.textContent.includes('确认这张表在分析什么')")
  await click('下一步：体验AI分析')
  await waitFor("document.body.textContent.includes('试一次真实分析')")
  assert.ok(await evaluate("document.querySelector('input[aria-label=询问你的数据]').getBoundingClientRect().height>0"))
  await click('运行演示分析')
  await waitFor("Boolean(document.querySelector('.final-answer'))")
  await evaluate("(() => {const e=document.querySelector('input[aria-label=询问你的数据]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'再看一下记录数是多少？');e.dispatchEvent(new Event('input',{bubbles:true}));})()")
  await waitFor("!document.querySelector('button[aria-label=发送问题]').disabled")
  await evaluate("document.querySelector('button[aria-label=发送问题]').click()")
  await waitFor("document.querySelectorAll('.v2-message').length===4")
  assert.ok(await evaluate("Boolean(document.querySelector('.chart-figure img'))"))
  await click('继续体验：政策复盘')
  await waitFor("Boolean(document.querySelector('[aria-label=政策复盘项目介绍]'))")
  assert.equal(await evaluate("document.querySelectorAll('.project-layer').length"),4)
  assert.ok(await evaluate("document.querySelector('.question-journey')?.textContent.includes('追问回路')"))
  await command('Page.getLayoutMetrics').then(async metrics=>{const r=await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:0,width:1440,height:metrics.cssContentSize.height,scale:1}});await writeFile(path.join(scratch,'policy-intro-desktop.png'),Buffer.from(r.data,'base64'))})
  await click('开始政策复盘演示')
  await waitFor("document.body.textContent.includes('演示材料已准备好')")
  assert.equal(await evaluate("document.querySelectorAll('.policy-panel .kpi-card').length"),0)
  await waitFor("Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='下一步：查看达成与回报'&&!b.disabled)")
  await click('下一步：查看达成与回报')
  await waitFor("document.querySelectorAll('.policy-panel .kpi-card').length===8")
  assert.equal(await evaluate("document.querySelector('.policy-panel .kpi-card strong').textContent"),'75%')
  await click('下一步：分析客户与消耗过程')
  await waitFor("Boolean(document.querySelector('table[aria-label=政策客户达成表]'))")
  assert.equal(await evaluate("document.querySelectorAll('table[aria-label=政策客户达成表] tbody tr').length"),20)
  assert.deepEqual(await evaluate("Array.from(document.querySelectorAll('.sidebar nav button')).map(b=>b.textContent)"),['数据分析','政策复盘'])
  await command('Page.captureScreenshot',{format:'png'}).then(r=>writeFile(path.join(scratch,'guided-desktop.png'),Buffer.from(r.data,'base64')))
  await command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true})
  assert.deepEqual(await evaluate("Array.from(document.querySelectorAll('.v2-mobile-nav button')).map(b=>b.textContent)"),['数据分析','政策复盘'])
  assert.ok(await evaluate('document.documentElement.scrollWidth<=window.innerWidth+1'))
  await click('完成体验，返回数据分析')
  await waitFor("Boolean(document.querySelector('[aria-label=数据分析项目介绍]')) && document.querySelector('.v2-mobile-nav .primary')?.textContent==='数据分析'")
  assert.ok(await evaluate('document.documentElement.scrollWidth<=window.innerWidth+1'))
  assert.ok(await evaluate("document.querySelector('.architecture-scroll').scrollWidth > document.querySelector('.architecture-scroll').clientWidth"))
  await evaluate("document.querySelector('.architecture-scroll').scrollLeft=500")
  assert.ok(await evaluate("document.querySelector('.architecture-scroll').scrollLeft > 0"))
  await evaluate("document.querySelector('.architecture-scroll').scrollIntoView();document.querySelector('.architecture-scroll').scrollLeft=0")
  await command('Page.captureScreenshot',{format:'png'}).then(r=>writeFile(path.join(scratch,'guided-mobile.png'),Buffer.from(r.data,'base64')))
  assert.deepEqual(exceptions,[])
  console.log('PASS guided interview flow: exactly 2 nav entries; data steps, real tool/chart result, demo policy75%/20 customers, completion and 390px; introductions with 4 layers each; model stub. Screenshots: '+scratch)
}finally{socket?.close();chrome.kill();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(dataRoot,{recursive:true,force:true})}
