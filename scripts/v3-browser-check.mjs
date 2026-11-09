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
 return JSON.stringify({action:'query_workspace',plan:{group_by:[],measures:[{column:'金额',aggregate:'sum',alias:'金额合计'}],filters:[],order:null,limit:null}})
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
  const fill = async (label,value) => evaluate(`(() => {const e=document.querySelector('[aria-label="${label}"]');Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`)
  const click = async text => evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent===${JSON.stringify(text)}).click()`)
  await command('Page.navigate',{url:origin+'/login'})
  await waitFor("document.readyState==='complete'&&Boolean(document.querySelector('#login-form'))")
  await fill('登录账号','tester');await fill('登录密码',password);await evaluate("document.querySelector('#submit').click()")
  await waitFor("document.querySelector('.signed-in-user')?.textContent==='tester'")
  await clickNav('数据准备');await waitFor("Boolean(document.querySelector('input[aria-label=复杂表格文件]'))")
  const csv=path.join(scratch,'complex.csv');await writeFile(csv,'业务报表\n客户,金额\n甲,100\n乙,200\n合计,300')
  let doc=await command('DOM.getDocument');let node=await command('DOM.querySelector',{nodeId:doc.root.nodeId,selector:'input[aria-label="复杂表格文件"]'})
  await command('DOM.setFileInputFiles',{nodeId:node.nodeId,files:[csv]})
  await waitFor("Boolean(document.querySelector('input[aria-label=表头开始行]'))",45000)
  await fill('表头开始行','2');await fill('排除行号','5')
  await click('预览转换结果');await waitFor("Boolean(document.querySelector('input[aria-label=确认数据转换]'))",45000)
  assert.ok(await evaluate("document.querySelector('.preparation-panel').textContent.includes('2条')"))
  await fill('版本名称','复杂测试表');await fill('记录粒度','每客户一条记录')
  await evaluate("document.querySelector('input[aria-label=确认数据转换]').click()")
  await click('保存版本并开始分析');await waitFor("document.querySelector('.history-saved')?.textContent.includes('已确认的数据版本')",45000)
  await fill('询问你的数据','金额合计是多少？');await evaluate("document.querySelector('button[aria-label=发送问题]').click()")
  await waitFor("document.querySelector('.final-answer')?.textContent.includes('300')",60000)
  await clickNav('历史分析');await waitFor("Boolean(document.querySelector('.history-title'))")
  await evaluate("document.querySelector('.history-title').click()")
  await waitFor("Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='基于此数据版本继续分析')")
  await click('基于此数据版本继续分析');await waitFor("document.querySelector('.history-saved')?.textContent.includes('已确认的数据版本')")
  assert.ok(await evaluate("document.querySelector('.status-strip').textContent.includes('复杂测试表')"))
  await clickNav('数据准备');await waitFor("document.body.textContent.includes('复杂测试表')")
  await command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true})
  assert.ok(await evaluate('document.documentElement.scrollWidth<=window.innerWidth+1'))
  const screenshot=await command('Page.captureScreenshot',{format:'png'});await writeFile(path.join(scratch,'v3-mobile.png'),Buffer.from(screenshot.data,'base64'))
  assert.deepEqual(exceptions,[])
  console.log('PASS V3 browser: CSV structure preview, header/total confirmation, saved version, DuckDB sum300, history continue and mobile layout. Screenshot: '+scratch)
}finally{socket?.close();chrome.kill();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(dataRoot,{recursive:true,force:true})}
