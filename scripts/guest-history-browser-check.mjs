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
  await command('Page.enable'); await command('Runtime.enable'); await command('Network.enable')
  const fill = async (label,value) => evaluate(`(() => {const e=document.querySelector('input[aria-label="${label}"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`)
  await command('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false})
  await command('Page.navigate',{url:origin+'/'})
  await waitFor("document.querySelector('.top-actions')?.textContent.includes('游客体验')")
  assert.equal(await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='上传 CSV').disabled"),true)
  assert.ok(!(await evaluate('location.pathname')).includes('login'))
  await clickNav('政策达成复盘')
  await waitFor("document.querySelectorAll('.policy-panel .kpi-card').length===8")
  assert.equal(await evaluate("document.querySelector('.policy-panel .kpi-card strong').textContent"),'75%')
  assert.equal(await evaluate("document.querySelector('input[aria-label=政策base文件]').disabled"),true)
  await clickNav('历史分析（需登录）')
  await waitFor("document.body.textContent.includes('登录后保存历史分析')")
  console.log('PASS 游客直接进入、模拟政策与上传/历史权限提示')
  await command('Page.navigate',{url:origin+'/login'})
  await waitFor("Boolean(document.querySelector('input[aria-label=登录账号]'))")
  await fill('登录账号','tester'); await fill('登录密码',password)
  await evaluate("document.querySelector('#submit').click()")
  await waitFor("document.querySelector('.signed-in-user')?.textContent==='tester'")
  await clickNav('历史分析'); await waitFor("document.body.textContent.includes('暂无历史记录')")
  await clickNav('政策达成复盘');await waitFor("document.querySelectorAll('.policy-panel .kpi-card').length===8")
  await evaluate("Array.from(document.querySelectorAll('.policy-panel button')).find(b=>b.textContent==='应用口径并重算').click()")
  await waitFor("document.querySelector('.policy-panel .history-saved')?.textContent.includes('已自动保存')")
  await clickNav('历史分析');await waitFor("document.querySelectorAll('table[aria-label=历史记录列表] tbody tr').length===1")
  await evaluate("document.querySelector('.history-title').click()")
  await waitFor("document.querySelector('.history-detail .kpi-card strong')?.textContent==='75%'")
  await clickNav('总览'); await fill('询问你的数据','画记录数柱状图')
  await evaluate("document.querySelector('button[aria-label=发送问题]').click()")
  await waitFor("Boolean(document.querySelector('.history-saved'))")
  await clickNav('历史分析');await waitFor("document.querySelectorAll('table[aria-label=历史记录列表] tbody tr').length===2")
  await evaluate("Array.from(document.querySelectorAll('.history-title')).find(b=>b.textContent==='画记录数柱状图').click()")
  await waitFor("document.querySelector('.history-detail img')?.complete")
  assert.ok(await evaluate("document.querySelector('.history-detail img').src.includes('/api/history/')"))
  await command('Page.reload'); await waitFor("document.querySelectorAll('table[aria-label=历史记录列表] tbody tr').length===2")
  await select('历史模块','basic');await waitFor("document.querySelectorAll('table[aria-label=历史记录列表] tbody tr').length===1")
  await fill('历史搜索','不存在的记录');await waitFor("document.body.textContent.includes('暂无历史记录')")
  await fill('历史搜索','');await waitFor("document.querySelectorAll('table[aria-label=历史记录列表] tbody tr').length===1")
  await evaluate("document.querySelector('.history-title').click()")
  await waitFor("document.querySelector('.history-detail img')?.complete")
  const exports=await evaluate("(async()=>{const links=Array.from(document.querySelectorAll('.history-detail a')).filter(a=>a.href.includes('/export'));return Promise.all(links.map(async a=>(await fetch(a.href)).status));})()")
  assert.deepEqual(exports,[200,200])
  await command('Page.captureScreenshot',{format:'png'}).then(result=>writeFile(path.join(scratch,'history-desktop.png'),Buffer.from(result.data,'base64')))
  await command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true})
  assert.ok(await evaluate('document.documentElement.scrollWidth<=window.innerWidth+1'))
  await command('Page.captureScreenshot',{format:'png'}).then(result=>writeFile(path.join(scratch,'history-mobile.png'),Buffer.from(result.data,'base64')))
  await evaluate("Array.from(document.querySelectorAll('table[aria-label=历史记录列表] button')).find(b=>b.textContent==='删除').click()")
  await waitFor("Boolean(document.querySelector('.history-confirm'))")
  await evaluate("Array.from(document.querySelectorAll('.history-confirm button')).find(b=>b.textContent==='确认删除').click()")
  await waitFor("document.body.textContent.includes('暂无历史记录')")
  await select('历史模块','policy');await waitFor("document.querySelectorAll('table[aria-label=历史记录列表] tbody tr').length===1")
  assert.deepEqual(exceptions,[])
  console.log('PASS 登录后自动保存、历史刷新/筛选/详情/图表/导出/确认删除；390px无溢出；模型使用测试桩。截图：'+scratch)
} finally { socket?.close();chrome.kill();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(dataRoot,{recursive:true,force:true}) }
