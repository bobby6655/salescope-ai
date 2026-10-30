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
  const origin=process.env.SALESCOPE_URL||'http://127.0.0.1:5312';let username='alice',password='test-only-password-12345';
  if(process.env.LOGIN_CREDENTIALS_FILE){const text=await readFile(process.env.LOGIN_CREDENTIALS_FILE,'utf8');username=text.split('\n').find(line=>line.startsWith('账号：')).split('：')[1];password=text.split('\n').find(line=>line.startsWith('密码：')).split('：')[1];}
  await command('Page.navigate',{url:origin+'/login'})
  await waitFor("document.readyState==='complete' && Boolean(document.querySelector('#login-form'))")
  await command('Page.bringToFront')
  await evaluate("document.querySelector('#username').focus()")
  await command('Input.insertText',{text:username})
  await evaluate("document.querySelector('#password').focus()")
  await command('Input.insertText',{text:'wrong-password'})
  await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',unmodifiedText:'\r',windowsVirtualKeyCode:13})
  await command('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',text:'\r',unmodifiedText:'\r',windowsVirtualKeyCode:13})
  await waitFor("document.querySelector('#error')?.textContent.includes('不正确')")
  await evaluate("document.querySelector('#password').value='';document.querySelector('#password').focus()")
  await command('Input.insertText',{text:password})
  await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',unmodifiedText:'\r',windowsVirtualKeyCode:13})
  await command('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',text:'\r',unmodifiedText:'\r',windowsVirtualKeyCode:13})
  await waitFor("Boolean(document.querySelector('.signed-in-user'))")
  assert.equal(await evaluate("document.querySelector('.signed-in-user').textContent"),username)
  await command('Page.reload')
  await waitFor("Boolean(document.querySelector('.signed-in-user'))")
  await command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true})
  await delay(150)
  assert.ok(await evaluate('document.documentElement.scrollWidth<=window.innerWidth+1'))
  await evaluate("Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='退出登录').click()")
  await waitFor("document.readyState==='complete' && Boolean(document.querySelector('#login-form'))")
  assert.equal(await evaluate("location.pathname"),'/login')
  assert.ok(await evaluate('document.documentElement.scrollWidth<=window.innerWidth+1'))
  const image=await command('Page.captureScreenshot',{format:'png'})
  await writeFile(path.join(scratch,'login.png'),Buffer.from(image.data,'base64'))
  assert.deepEqual(exceptions,[])
  console.log('PASS 实际浏览器输入密码、错误提示、登录、刷新会话、退出及390px登录页；截图：'+path.join(scratch,'login.png'))
} finally {socket?.close();chrome.kill()}
