import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const scratch = await mkdtemp(path.join(tmpdir(), 'salescope-policy-check-'))
const chrome = spawn(process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${scratch}`, 'about:blank'], { stdio: 'ignore' })
const origin = process.env.SALESCOPE_URL || 'http://127.0.0.1:5180'
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
let socket
try {
  let debugPort
  for (let attempt = 0; attempt < 150; attempt += 1) { try { debugPort = (await readFile(path.join(scratch, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break } catch { await delay(100) } }
  if (!debugPort) throw new Error('无法启动独立浏览器')
  const target = await (await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: 'PUT' })).json()
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
  let sequence = 0
  const pending = new Map()
  const exceptions = []
  let completedImports = 0
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.id) { const handler = pending.get(message.id); pending.delete(message.id); if (message.error) handler?.reject(new Error(message.error.message)); else handler?.resolve(message.result) }
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.text)
    if (message.method === 'Network.responseReceived' && message.params.response.url.endsWith('/api/policy/import') && message.params.response.status === 200) completedImports += 1
  })
  const command = (method, params = {}) => new Promise((resolve, reject) => { const identifier = ++sequence; pending.set(identifier, { resolve, reject }); socket.send(JSON.stringify({ id: identifier, method, params })) })
  const evaluate = async (expression) => { const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text); return result.result.value }
  const waitFor = async (expression, timeout = 30000) => { const start = Date.now(); while (Date.now() - start < timeout) { if (await evaluate(expression)) return; await delay(100) } throw new Error(`等待超时：${expression}`) }
  const select = async (label, value) => { await evaluate(`(() => { const element=document.querySelector(${JSON.stringify(`select[aria-label=${JSON.stringify(label)}]`)}); element.value=${JSON.stringify(value)}; element.dispatchEvent(new Event('change',{bubbles:true})); })()`); await delay(100) }
  await command('Page.enable'); await command('Runtime.enable'); await command('Network.enable')
  await command('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
  await command('Page.navigate', { url: `${origin}/#policy` })
  await waitFor("typeof document !== 'undefined' && document.querySelectorAll('.policy-panel .kpi-card').length===8")
  const values = await evaluate("Array.from(document.querySelectorAll('.policy-panel .kpi-card > strong')).map(element=>element.textContent)")
  assert.equal(values[0], '26.17%'); assert.equal(values[1], '48.17%'); assert.equal(values[6], '3.59')
  console.log('PASS 政策页面双达成率与28个获返客户增量ROI')
  assert.ok(await evaluate("document.querySelector('.nav-module[aria-label=基础数据分析]')?.textContent.includes('自动评测')"))
  assert.equal(await evaluate("/聚类|群画像|分群/.test(document.querySelector('.policy-panel').textContent)"), false)
  const checkAxes = async () => {
    const checks = await evaluate(`(() => {
      return Array.from(document.querySelectorAll('.chart-figure img')).filter(img => img.src.startsWith('data:')).map(img => {
        const host = document.createElement('div'); host.style.cssText = 'position:absolute;left:-100000px;top:0';
        host.innerHTML = decodeURIComponent(img.src.split(',').slice(1).join(',')); document.body.append(host);
        const svg = host.querySelector('svg');
        const labels = Array.from(svg.querySelectorAll('.chart-x-label'));
        const boxes = labels.map(label => {const b=label.getBBox();return {x:b.x,width:b.width,text:label.textContent,date:label.dataset.label};});
        const overlap = boxes.some((b,i) => i>0 && boxes[i-1].x+boxes[i-1].width>b.x);
        const clipped = boxes.some(b => b.x<0 || b.x+b.width>svg.viewBox.baseVal.width);
        const result={count:boxes.length,overlap,clipped,dates:boxes.filter(b=>b.date).map(b=>b.date)};host.remove();return result;
      });
    })()`);
    assert.ok(checks.length >= 2);
    assert.ok(checks.every(check => !check.overlap && !check.clipped), JSON.stringify(checks));
    assert.ok(checks.some(check => check.dates.length === 13));
  };
  await checkAxes();
  const desktopScreenshot = await command('Page.captureScreenshot', { format: 'png' });
  await writeFile(path.join(scratch, 'desktop.png'), Buffer.from(desktopScreenshot.data, 'base64'));
  console.log('PASS 业务模块分组、移除聚类、日期标签真实渲染不重叠/不裁切');
  await select('政策筛选负责销售', 'lvxiaoqi')
  assert.equal(await evaluate(`document.querySelectorAll(${JSON.stringify('table[aria-label="政策客户达成表"] tbody tr')}).length`), 3)
  await select('政策客户过程', '233乐园')
  assert.ok(await evaluate("document.body.textContent.includes('233乐园 · 消耗过程')"))
  console.log('PASS 销售筛选与单客户消耗过程')
  await select('政策筛选负责销售', '')
  await select('政策复盘维度', 'departmentType')
  assert.ok(await evaluate("document.body.textContent.includes('部门×类型达成与ROI')"))
  const documentNode = await command('DOM.getDocument')
  const base = await command('DOM.querySelector', { nodeId: documentNode.root.nodeId, selector: 'input[aria-label="政策base文件"]' })
  const cost = await command('DOM.querySelector', { nodeId: documentNode.root.nodeId, selector: 'input[aria-label="政策消耗文件"]' })
  await command('DOM.setFileInputFiles', { nodeId: base.nodeId, files: ['/Users/yanghanyue/Downloads/国庆base表.xlsx'] })
  await command('DOM.setFileInputFiles', { nodeId: cost.nodeId, files: ['/Users/yanghanyue/Downloads/游戏国庆政策_修正版SQL消耗结果.xlsx'] })
  await waitFor("Array.from(document.querySelectorAll('.policy-panel button')).some(button=>button.textContent==='关联并生成政策复盘'&&!button.disabled)")
  await evaluate("Array.from(document.querySelectorAll('.policy-panel button')).find(button=>button.textContent==='关联并生成政策复盘').click()")
  const importStart = Date.now()
  while (!completedImports && Date.now() - importStart < 30000) await delay(100)
  assert.equal(completedImports, 1)
  await waitFor("Array.from(document.querySelectorAll('.policy-panel button')).some(button=>button.textContent==='关联并生成政策复盘'&&!button.disabled)")
  assert.equal(await evaluate(`document.querySelectorAll(${JSON.stringify('table[aria-label="政策客户达成表"] tbody tr')}).length`), 107)
  console.log('PASS 两张真实Excel页面导入并重建107客户复盘')
  await evaluate(`(() => { const input=document.querySelector('input[aria-label="政策问答"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'小游戏的消耗增量和ROI是多少？'); input.dispatchEvent(new Event('input',{bubbles:true})); })()`)
  await waitFor("!document.querySelector('.policy-panel .query-send').disabled")
  await evaluate("document.querySelector('.policy-panel .query-send').click()")
  await waitFor("Boolean(document.querySelector('.policy-panel .final-answer')) || Boolean(document.querySelector('.policy-panel div[role=alert]'))", 190000)
  assert.equal(await evaluate("document.querySelector('.policy-panel div[role=alert]')?.textContent || ''"), '')
  const answer = await evaluate("document.querySelector('.policy-panel .final-answer').textContent")
  assert.ok(answer.includes('-22.53')); assert.ok(answer.includes('4.7163')); assert.ok(answer.includes('17个')); assert.ok(answer.includes('418.8165'))
  console.log('PASS 真实模型政策问答区分全客户负增量和17个获返客户正ROI')
  for (const format of ['md', 'csv', 'json']) { const response = await fetch(`${origin}/api/policy/export?format=${format}`); assert.equal(response.status, 200); const body=await response.text(); assert.ok(body.length > 1000); assert.ok(!/clusterMethod|clusterProfiles|聚类方法|群画像|分群/.test(body)) }
  await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await delay(150)
  await checkAxes()
  assert.ok(await evaluate("document.querySelector('.v2-mobile-nav [aria-label=基础数据分析]')?.textContent.includes('数据源')"))
  assert.ok(await evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'))
  assert.ok(await evaluate("Array.from(document.querySelectorAll('.v2-table-scroll')).some(element=>element.scrollWidth>element.clientWidth)"))
  const screenshot = await command('Page.captureScreenshot', { format: 'png' })
  const screenshotPath = path.join(scratch, 'mobile.png')
  await writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'))
  assert.deepEqual(exceptions, [])
  console.log(`PASS 导出、窄屏表格与无运行异常；截图：${screenshotPath}`)
} finally { socket?.close(); chrome.kill() }
