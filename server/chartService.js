import { storageDirectory, storageIdentity } from './storageContext.js'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderChartSvg } from '../src/chartGenerator.js'

const chartsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../charts')

async function writeChartFile({ type, title, rows, metric, operation }) {
  const chartsDir = storageDirectory('charts')
  await mkdir(chartsDir, { recursive: true })
  const svg = renderChartSvg({ type, title, rows, metric, operation })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const fileName = `${type}-${stamp}-${randomUUID()}.svg`
  const filePath = path.join(chartsDir, fileName)
  await writeFile(filePath, svg, 'utf8')
  return {
    type,
    title,
    metric,
    fileName,
    filePath,
    relativePath: `charts/${fileName}`,
    publicPath: `${storageIdentity()?.kind === 'guest' ? '/api/demo/charts' : '/charts'}/${fileName}`,
    bytes: Buffer.byteLength(svg, 'utf8'),
  }
}

async function saveChart(options) {
  const first = await writeChartFile(options).then((chart) => ({ chart, error: null })).catch((error) => ({ chart: null, error }))
  if (first.chart) return first.chart
  if (options.strict) throw first.error

  const fallbackType = options.type === 'bar' ? 'line' : 'bar'
  const retry = await writeChartFile({ ...options, type: fallbackType }).then((chart) => ({ chart, error: null })).catch((error) => ({ chart: null, error }))
  if (retry.chart) return { ...retry.chart, repairedFrom: options.type, firstError: first.error.message }
  throw new Error(`第一次生成${options.type}图失败：${first.error.message}；修正为${fallbackType}图后仍失败：${retry.error.message}`)
}

function serveChart(request, response, next) {
  const chartsDir = storageDirectory('charts')
  if (!request.url || request.url === '/') return next()
  const requestPath = decodeURIComponent(request.url.split('?')[0].replace(/^\//, ''))
  const filePath = path.normalize(path.join(chartsDir, requestPath))
  if (filePath !== chartsDir && !filePath.startsWith(`${chartsDir}${path.sep}`)) {
    response.statusCode = 403
    response.end('访问被拒绝')
    return
  }
  const stream = createReadStream(filePath)
  stream.on('open', () => {
    response.setHeader('Content-Type', 'image/svg+xml; charset=utf-8')
    response.setHeader('Cache-Control', 'no-store')
    stream.pipe(response)
  })
  stream.on('error', () => {
    response.statusCode = 404
    response.end('图片不存在')
  })
}

export { saveChart, serveChart, chartsDir }
