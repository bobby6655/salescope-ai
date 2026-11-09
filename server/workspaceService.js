import { readFile, readdir, mkdir, writeFile, rename, rm } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID, createHash } from 'node:crypto'
import { storageDirectory, storageIdentity } from './storageContext.js'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const valid = id => /^[a-f0-9]{32}$/.test(id)
export async function runDataWorker(payload) {
  const python = process.env.V3_PYTHON || path.join(root, 'runtime-data/v3-python/bin/python')
  return new Promise((resolve, reject) => {
    const child = execFile(python, [path.join(root, 'server/v3/worker.py')], { timeout: 45000, maxBuffer: 32 * 1024 * 1024, env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'en_US.UTF-8', LANGSMITH_TRACING: 'false', LANGCHAIN_TRACING_V2: 'false' } }, (error, stdout) => {
      try { const data = JSON.parse(stdout); if (!data.ok) reject(new Error(data.error)); else resolve(data.result) } catch { reject(new Error(error?.code === 'ENOENT' ? 'V3数据服务未安装，请运行npm run setup:v3' : '数据处理超时或失败，请缩小文件范围后重试')) }
    })
    child.stdin.on('error', () => {}); child.stdin.end(JSON.stringify(payload))
  })
}
async function saveRecord(kind, record) {
  const id = randomUUID().replaceAll('-', ''), directory = path.join(storageDirectory('workspaces'), kind, id)
  await mkdir(path.dirname(directory), { recursive: true, mode: 0o700 })
  const temp = directory + '.tmp'; await mkdir(temp, { mode: 0o700 })
  try { await writeFile(path.join(temp, 'record.json'), JSON.stringify({ ...record, id, createdAt: new Date().toISOString() }), { mode: 0o600 }); await rename(temp, directory) } catch (e) { await rm(temp, { recursive: true, force: true }); throw e }
  return id
}
async function loadRecord(kind, id) { if (!valid(id)) throw new Error('数据版本ID无效'); return JSON.parse(await readFile(path.join(storageDirectory('workspaces'), kind, id, 'record.json'), 'utf8')) }
export const readDataVersion = id => loadRecord('versions', id)
const brief = table => ({ headers: table.headers, rows: table.rows.slice(0, 30), provenance: table.provenance.slice(0, 30), quality: table.quality, rowCount: table.rows.length, invalidCount: table.invalidCount, invalidCells: table.invalidCells, totalCandidates: table.totalCandidates, excludedRows: table.excludedRows, plan: table.plan, joinReport: table.joinReport, stages: table.stages, harness: table.harness })
export function workspaceMiddleware(callModel) {
  return async (request, response) => {
    const send = (code, data) => { response.statusCode = code; response.setHeader('Content-Type', 'application/json; charset=utf-8'); response.end(JSON.stringify(data)) }
    if (storageIdentity()?.kind === 'guest') return send(403, { error: '游客不能上传或访问用户工作区' })
    try {
      const url = new URL(request.url, 'http://localhost'), route = url.pathname
      if (request.method === 'GET') {
        if (route === '/health') return send(200, await runDataWorker({ action: 'health' }))
        if (route === '/versions') {
          const directory = path.join(storageDirectory('workspaces'), 'versions'), records = []
          const entries = await readdir(directory, { withFileTypes: true }).catch(e => { if (e.code === 'ENOENT') return []; throw e })
          for (const entry of entries) if (entry.isDirectory() && valid(entry.name)) { const r = await readDataVersion(entry.name); records.push({ id: r.id, name: r.name, rowCount: r.table.rows.length, headers: r.table.headers, createdAt: r.createdAt, fingerprint: r.fingerprint }) }
          return send(200, { items: records.sort((a, b) => b.createdAt.localeCompare(a.createdAt)) })
        }
        const match = route.match(/^\/versions\/([a-f0-9]{32})$/)
        if (match) return send(200, await readDataVersion(match[1]))
        return send(404, { error: '工作区接口不存在' })
      }
      if (request.method !== 'POST') return send(405, { error: '不支持请求方法' })
      let raw = ''; for await (const chunk of request) { raw += chunk; if (Buffer.byteLength(raw) > 12 * 1024 * 1024) throw new Error('上传请求超过12MB') }
      const body = JSON.parse(raw || '{}')
      if (route === '/inspect') {
        if (!body.name || typeof body.data !== 'string') throw new Error('请选择CSV或Excel文件')
        const inspected = await runDataWorker({ action: 'inspect', name: path.basename(body.name), data: body.data })
        const uploadId = await saveRecord('uploads', { name: path.basename(body.name), data: body.data, sheets: inspected.sheets })
        return send(200, { uploadId, name: path.basename(body.name), sheets: inspected.sheets.map(s => ({ ...s, rowCount: s.rows.length, rows: s.rows.slice(0, 40) })) })
      }
      if (route === '/suggest') {
        const upload = await loadRecord('uploads', body.uploadId), sheet = upload.sheets.find(s => s.name === body.sheet)
        if (!sheet) throw new Error('Sheet不存在')
        const prompt = '你是数据准备助手，只输出JSON建议，不执行代码。格式{"headerStart":1,"headerDepth":1,"endRow":100,"excludeRows":[],"fillDown":[],"reason":"解释及待确认项"}。行号从1开始。只有一个非空单元格的报表标题或说明行不是字段表头；表头应对应后续多列明细，优先考察headerCandidates。逐行数组的索引+1才是行号。用户将看到建议并人工确认。识别标题/说明/多行表头/总计行。不能猜业务口径；不得改变数据金额。excludeRows仅含明确总计/小计行，不能删除零值或缺数明细。endRow使用rowCount，除非有明确尾注；只依据当前Sheet的前40行样例和合并范围。'
        const content = await callModel([{ role: 'system', content: prompt }, { role: 'user', content: JSON.stringify({ name: sheet.name, rowCount: sheet.rows.length, rows: sheet.rows.slice(0, 40), merges: sheet.merges, headerCandidates: sheet.headerCandidates }) }], AbortSignal.timeout(30000), { maxTokens: 2000 })
        const suggestion = JSON.parse(content.slice(content.indexOf('{'), content.lastIndexOf('}') + 1))
        if (!Number.isInteger(suggestion.headerStart) || suggestion.headerStart < 1 || suggestion.headerStart > sheet.rows.length || sheet.rows[suggestion.headerStart - 1].filter(value => value != null && value !== '').length < 2) throw new Error('模型未识别出有效多列表头，请依据原始预览手动指定表头行')
        return send(200, { suggestion, note: '模型建议不自动应用，需预览及人工确认' })
      }
      if (route === '/prepare') {
        const upload = await loadRecord('uploads', body.uploadId), sheet = upload.sheets.find(s => s.name === body.sheet)
        if (!sheet) throw new Error('Sheet不存在')
        const table = await runDataWorker({ action: 'prepare', sheet, plan: body.plan || {} })
        const previewId = await saveRecord('previews', { name: `${upload.name} / ${sheet.name}`, table, sources: [{ uploadId: body.uploadId, sheet: sheet.name }], recordGrain: body.recordGrain || '' })
        return send(200, { previewId, ...brief(table) })
      }
      if (route === '/join') {
        if (body.leftId === body.rightId) throw new Error('请选择两个不同数据版本')
        const left = await readDataVersion(body.leftId), right = await readDataVersion(body.rightId)
        const table = await runDataWorker({ action: 'join', left: left.table, right: right.table, keys: body.keys, how: body.how })
        const previewId = await saveRecord('previews', { name: body.name || `${left.name} + ${right.name}`, table, sources: [{ versionId: body.leftId }, { versionId: body.rightId }], recordGrain: body.recordGrain || '' })
        return send(200, { previewId, ...brief(table) })
      }
      if (route === '/join-suggest') {
        const left = await readDataVersion(body.leftId), right = await readDataVersion(body.rightId)
        const candidates = []
        for (const l of left.table.headers) for (const r of right.table.headers) if (l === r || /编号|编码|id$/i.test(l) && /编号|编码|id$/i.test(r)) {
          const rightKeys = new Set(right.table.rows.map(row => row[r]).filter(value => value != null).map(String))
          const present = left.table.rows.filter(row => row[l] != null)
          const matched = present.filter(row => rightKeys.has(String(row[l]))).length
          candidates.push({ left: l, right: r, matchRate: present.length ? matched / present.length : 0 })
        }
        return send(200, { candidates: candidates.sort((a, b) => b.matchRate - a.matchRate).slice(0, 10), note: '匹配率仅辅助判断；需确认键的业务含义与记录粒度，不自动关联' })
      }
      if (route === '/confirm') {
        if (body.confirmed !== true) throw new Error('请确认转换方案与记录粒度')
        const preview = await loadRecord('previews', body.previewId)
        if (!String(body.recordGrain || preview.recordGrain || '').trim()) throw new Error('请说明一行代表什么业务记录')
        if (preview.table.invalidCount) throw new Error('存在类型转换异常，请修正配置后重新预览')
        if (!preview.table.rows.length) throw new Error('没有可确认的明细记录')
        const fingerprint = createHash('sha256').update(JSON.stringify(preview.table)).digest('hex')
        const id = await saveRecord('versions', { ...preview, name: String(body.name || preview.name).slice(0, 200), recordGrain: String(body.recordGrain || preview.recordGrain).slice(0, 300), fingerprint, confirmedAt: new Date().toISOString() })
        return send(200, { version: await readDataVersion(id) })
      }
      return send(404, { error: '工作区接口不存在' })
    } catch (error) { return send(error.code === 'ENOENT' ? 404 : 400, { error: error.code === 'ENOENT' ? '数据版本不存在或不属于当前账号' : error.message }) }
  }
}
