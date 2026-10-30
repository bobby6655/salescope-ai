import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
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
  await command('Page.enable'); await command('Runtime.enable')
  await command('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
  await command('Page.navigate', { url: process.env.SALESCOPE_URL || 'http://127.0.0.1:5180/' })
  await waitFor("typeof document !== 'undefined' && Boolean(document.querySelector('.v2-select'))")
  const documentNode = await command('DOM.getDocument')
  const fileInput = await command('DOM.querySelector', { nodeId: documentNode.root.nodeId, selector: 'input[type="file"]' })
  await command('DOM.setFileInputFiles', { nodeId: fileInput.nodeId, files: [path.join(root, 'data/specialty-data.csv')] })
  await waitFor('document.body.textContent.includes("specialty-data.csv")')
  await clickNav('分析报告')
  await evaluate(`(() => { const input=document.querySelector('input[aria-label="询问你的数据"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'分析这段时间内各个专项的消耗变化，涨幅如何，哪个专项涨得好，哪个专项拖后腿？'); input.dispatchEvent(new Event('input',{bubbles:true})); })()`)
  await waitFor('!document.querySelector(".query-send").disabled')
  await evaluate('document.querySelector(".query-send").click()')
  await waitFor('Boolean(document.querySelector(".change-answer"))',190000)
  const text=await evaluate('document.querySelector(".change-answer").textContent')
  assert.ok(text.includes('专项B 200%'),text)
  assert.ok(text.includes('专项A日均增加30'),text)
  assert.ok(text.includes('专项C日均减少30'),text)
  assert.ok(text.includes('9.52%'),text)
  assert.equal(await evaluate('document.querySelector(".ai-badge").textContent'),'万擎模型')
  assert.ok(await evaluate('document.querySelectorAll(".change-answer p").length >= 8'))
  const desktop=await command('Page.captureScreenshot',{format:'png'})
  await writeFile(path.join(scratch,'desktop.png'),Buffer.from(desktop.data,'base64'))
  console.log('PASS 上传YYYYMMDD专项表，真实万擎主动完成整体/涨幅/增量贡献/下降拖累，多段答案可读')
  await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await delay(150)
  assert.ok(await evaluate('document.querySelector(".v2-mobile-nav").getBoundingClientRect().height > 0'))
  assert.ok(await evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'))
  assert.ok(await evaluate('Array.from(document.querySelectorAll(".v2-table-scroll")).some(element => element.scrollWidth > element.clientWidth)'))
  const screenshot = await command('Page.captureScreenshot', { format: 'png' })
  const screenshotPath = path.join(scratch, 'mobile.png')
  await writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'))
  assert.deepEqual(exceptions, [])
  console.log(`PASS 专项分析窄屏答案、明细表与无页面异常；截图：${screenshotPath}`)
} finally { socket?.close(); chrome.kill() }
