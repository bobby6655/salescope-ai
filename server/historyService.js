import { mkdir, readFile, readdir, writeFile, rename, rm, copyFile } from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { storageDirectory, storageIdentity } from './storageContext.js'
import { policyMarkdown } from './policyReports.js'

const validId = id => /^[a-f0-9]{32}$/.test(id)
const safeResult = result => JSON.parse(JSON.stringify(result, (key, value) => ['filePath', 'baseRows', 'consumptionRows', 'daily'].includes(key) ? undefined : value))
export async function saveHistory({ module, kind = 'analysis', question, result, dataset = {}, requestId }) {
  if (storageIdentity()?.kind !== 'user' || result.status === 'clarify' || result.error || !result.answer && kind !== 'snapshot') return null
  const directory = storageDirectory('history')
  const id = requestId && /^[A-Za-z0-9_-]{8,100}$/.test(requestId) ? createHash('sha256').update(`${module}:${kind}:${requestId}`).digest('hex').slice(0, 32) : randomUUID().replaceAll('-', '')
  const target = path.join(directory, id)
  try { await readFile(path.join(target, 'record.json')); return id } catch (error) { if (error.code !== 'ENOENT') throw error }
  const temporary = path.join(directory, `.${id}.${randomUUID()}`)
  await mkdir(temporary, { recursive: true, mode: 0o700 })
  try {
    const record = { id, module, kind, title: String(question || result.rules?.name || '分析结论').slice(0, 160), question: String(question || ''), createdAt: new Date().toISOString(), dataset, result: safeResult(result) }
    if (result.chart?.fileName) {
      const filename = result.chart.fileName
      if (filename !== path.basename(filename) || !filename.endsWith('.svg')) throw new Error('历史图表文件名无效')
      await copyFile(path.join(storageDirectory('charts'), filename), path.join(temporary, 'chart.svg'))
      record.result.chart = { ...record.result.chart, publicPath: `/api/history/${id}/chart`, relativePath: `history/${id}/chart.svg` }
    }
    await writeFile(path.join(temporary, 'record.json'), JSON.stringify(record), { mode: 0o600 })
    await rename(temporary, target)
    return id
  } catch (error) { await rm(temporary, { recursive: true, force: true }); throw error }
}

export async function attachHistory(result, metadata) {
  if (storageIdentity()?.kind === 'guest') { if (result.chart) delete result.chart.filePath; return result }
  try { const id = await saveHistory({ ...metadata, result }); if (id) result.historyId = id }
  catch { result.historyWarning = '结论已生成，但历史保存失败，请先下载或复制结果后再重试' }
  return result
}

const markdown = record => record.kind === 'snapshot' ? policyMarkdown(record.result) : `# ${record.title}\n\n时间：${record.createdAt}\n\n## 问题\n\n${record.question}\n\n## 分析结论\n\n${record.result.answer}\n\n## 依据\n\n${record.result.detail || ''}\n\n## 结果表\n\n\`\`\`json\n${JSON.stringify(record.result.table || [], null, 2)}\n\`\`\`\n\n## 执行步骤\n\n${(record.result.agentSteps || []).map(step => `- ${step.title}：${step.result}`).join('\n')}\n`
export async function historyMiddleware(request, response) {
  const send = (status, value) => { response.statusCode = status; response.setHeader('Content-Type', 'application/json; charset=utf-8'); response.end(JSON.stringify(value)) }
  if (storageIdentity()?.kind !== 'user') return send(403, { error: '历史记录需要登录账号' })
  const url = new URL(request.url, 'http://localhost'), parts = url.pathname.split('/').filter(Boolean)
  try {
    const root = storageDirectory('history')
    if (!parts.length && request.method === 'GET') {
      const entries = await readdir(root, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error })
      const records = []
      for (const entry of entries) if (entry.isDirectory() && validId(entry.name)) {
        try { const record = JSON.parse(await readFile(path.join(root, entry.name, 'record.json'), 'utf8')); records.push(record) } catch (error) { if (error.code !== 'ENOENT') throw error }
      }
      const module = url.searchParams.get('module'), search = (url.searchParams.get('q') || '').toLowerCase(), from = url.searchParams.get('from'), to = url.searchParams.get('to')
      if ([from, to].some(value => value && !/^\d{4}-\d{2}-\d{2}$/.test(value))) return send(400, { error: '历史日期格式无效' })
      const filtered = records.filter(r => {
        const day = new Date(r.createdAt).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })
        return (!module || r.module === module) && (!search || `${r.title} ${r.result.answer || ''} ${r.dataset.name || ''}`.toLowerCase().includes(search)) && (!from || day >= from) && (!to || day <= to)
      }).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
      const page = Math.max(1, Number(url.searchParams.get('page')) || 1), limit = 20
      return send(200, { total: filtered.length, page, limit, items: filtered.slice((page - 1) * limit, page * limit).map(({ result, ...r }) => ({ ...r, preview: String(result.answer || '政策达成与ROI复盘').slice(0, 180), hasChart: Boolean(result.chart) })) })
    }
    const [id, action] = parts
    if (!validId(id) || parts.length > 2) return send(404, { error: '历史记录不存在' })
    const directory = path.join(root, id), record = JSON.parse(await readFile(path.join(directory, 'record.json'), 'utf8'))
    if (request.method === 'POST' && action === 'delete') { await rm(directory, { recursive: true }); return send(200, { ok: true }) }
    if (request.method !== 'GET') return send(405, { error: '请求方法不支持' })
    if (!action) return send(200, record)
    if (action === 'chart') { const svg = await readFile(path.join(directory, 'chart.svg')); response.setHeader('Content-Type', 'image/svg+xml'); return response.end(svg) }
    if (action === 'export') {
      const format = url.searchParams.get('format') || 'md'
      if (!['md', 'json'].includes(format)) return send(400, { error: '历史导出支持Markdown或JSON' })
      response.setHeader('Content-Type', format === 'md' ? 'text/markdown; charset=utf-8' : 'application/json; charset=utf-8')
      response.setHeader('Content-Disposition', `attachment; filename="analysis-${id}.${format}"`)
      return response.end(format === 'md' ? markdown(record) : JSON.stringify(record, null, 2))
    }
    return send(404, { error: '历史接口不存在' })
  } catch (error) { return send(error.code === 'ENOENT' ? 404 : 500, { error: error.code === 'ENOENT' ? '历史记录不存在' : '历史读取失败，请稍后重试' }) }
}
