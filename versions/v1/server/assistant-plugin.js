import { analyzeQuestion } from '../src/dataAnalysis.js'
import { detectChartIntent } from '../src/chartGenerator.js'
import { saveChart, serveChart } from './chartService.js'
import { saveEvaluation } from './evaluationService.js'
import { runAgentLoop } from './agentLoop.js'

try {
  process.loadEnvFile?.()
} catch {
  // 本地没有 .env 时继续读取真实环境变量
}

function readEnv(name, fallback = '') {
  return process.env[name] ?? fallback
}

function redactError(message) {
  const key = readEnv('WQ_API_KEY')
  return key ? String(message).split(key).join('[REDACTED]') : String(message)
}

async function callModel(messages, signal) {
  const baseUrl = readEnv('WQ_BASE_URL', 'https://wanqing-api.corp.kuaishou.com/api/gateway/v1/endpoints').replace(/\/$/, '')
  const endpoint = `${baseUrl}${readEnv('WQ_API_PATH', '/chat/completions')}`
  const apiKey = readEnv('WQ_API_KEY')
  const model = readEnv('WQ_MODEL_ID')
  if (!apiKey || !model) throw new Error('缺少 WQ_API_KEY 或 WQ_MODEL_ID')

  const response = await fetch(endpoint, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages, temperature: 0, max_tokens: 1000 }),
    signal,
  })
  if (!response.ok) {
    let detail = await response.text().catch(() => '')
    try {
      const parsed = JSON.parse(detail)
      detail = parsed?.ResponseMeta?.ErrorMessage ?? parsed?.ErrorMessage ?? parsed?.message ?? detail
    } catch {
      if (/html/i.test(response.headers.get('content-type') ?? '')) detail = '接口地址未直接返回推理服务，请确认 WQ_BASE_URL'
    }
    const error = new Error(`万擎调用失败：HTTP ${response.status} ${redactError(detail).replace(/\s+/g, ' ').slice(0, 160)}`)
    if (response.status === 429) {
      const retryHeader = response.headers.get('retry-after')
      const retrySeconds = Number(retryHeader) || Number(String(detail).match(/wait\s+(\d+)s/i)?.[1]) || 10
      error.retryAfterMs = Math.max(1000, retrySeconds * 1000)
    }
    throw error
  }
  const payload = await response.json()
  return payload?.choices?.[0]?.message?.content ?? ''
}

async function makeChart(question, plan, computed, agentSteps) {
  const intent = detectChartIntent(question, plan)
  if (!intent) return null
  const chart = await saveChart({ ...intent, rows: computed.rows, metric: plan.metric, operation: plan.operation, strict: true })
  if (chart.repairedFrom) {
    agentSteps.push({
      title: '图片生成失败并自动修正',
      method: `第一次尝试生成${chart.repairedFrom}图，失败后改用${chart.type}图。`,
      result: chart.firstError,
      status: 'error',
    })
  }
  agentSteps.push({
    title: '生成真实图片',
    method: `用已校验的 ${computed.rows.length} 组结果绘制${chart.type === 'bar' ? '柱状图' : '折线图'}。`,
    result: `已保存到 ${chart.relativePath}`,
  })
  return chart
}

function createAssistantPlugin() {
  return {
    name: 'sale-scope-assistant',
    configureServer(server) {
      server.middlewares.use('/api/assistant', async (request, response) => {
        if (request.method !== 'POST') {
          response.statusCode = 405
          response.end(JSON.stringify({ error: '只支持 POST 请求' }))
          return
        }

        const started = Date.now()
        const agentSteps = []
        try {
          const body = await new Promise((resolve, reject) => {
            let payload = ''
            request.on('data', (chunk) => {
              payload += chunk
              if (payload.length > 2_000_000) reject(new Error('请求体过大'))
            })
            request.on('end', () => {
              try {
                resolve(JSON.parse(payload || '{}'))
              } catch {
                reject(new Error('请求体不是有效 JSON'))
              }
            })
            request.on('error', () => reject(new Error('请求读取失败')))
          })

          const question = String(body.question ?? '').trim()
          const history = Array.isArray(body.history) ? body.history.slice(-10).filter((message) => ['user', 'assistant'].includes(message?.role)).map((message) => ({ role: message.role, content: String(message.content).slice(0, 3000) })) : []
          const rows = Array.isArray(body.rows) ? body.rows : []
          const headers = Array.isArray(body.headers) ? body.headers : []
          if (!question) throw new Error('请输入问题')
          if (!rows.length) throw new Error('没有可分析的数据')

          let result = null
          let source = 'wanqing'
          try {
            const completed = await runAgentLoop({ question, rows, headers, history, callModel, saveChart, agentSteps, redact: redactError })
            result = { ...completed, aiMode: true, source, question, agentSteps, steps: agentSteps.map((step) => `${step.title}：${step.result}`), totalSteps: agentSteps.length, elapsedMs: Date.now() - started }
          } catch (error) {
            if (!/true|1/i.test(readEnv('WQ_DEMO_FALLBACK', 'true'))) throw error
            source = 'demo'
            let fallback
            try {
              fallback = analyzeQuestion(rows, question)
            } catch (fallbackError) {
              result = {
                aiMode: true,
                source,
                status: 'clarify',
                question,
                answer: `我暂时不能安全计算这类问题。请补充时间范围、指标或比较维度；当前支持总额、排名、平均值、占比和画图。`,
                detail: fallbackError.message,
                suggestions: ['按地区比较销售额', '按月份看营收趋势', '计算某个地区的平均折扣'],
                agentSteps: [...agentSteps, { title: '需要补充信息', method: '模型不可用时，本地分析器也没有猜测答案。', result: fallbackError.message, status: 'warn' }],
                totalSteps: agentSteps.length + 1,
                elapsedMs: Date.now() - started,
              }
              response.setHeader('Content-Type', 'application/json; charset=utf-8')
              response.end(JSON.stringify(result))
              return
            }
            agentSteps.push({
              title: '切换演示模式',
              method: '万擎不可用时，本地确定性分析器继续执行，避免页面卡住。',
              result: redactError(error.message),
              status: 'warn',
            })
            agentSteps.push(...fallback.agentSteps)
            const chart = await makeChart(question, fallback.plan, fallback, agentSteps)
            if (chart) {
              agentSteps.push({
                title: '给出最终答案',
                method: `依据：${fallback.detail}；图片依据：${chart.relativePath}`,
                result: `${fallback.answer}。图片已保存到 ${chart.relativePath}`,
              })
            }
            result = {
              aiMode: true,
              source,
              question,
              title: '演示模式 Agent 分析',
              answer: chart ? `${fallback.answer}。图片已保存到 ${chart.relativePath}` : fallback.answer,
              detail: fallback.detail,
              steps: fallback.steps,
              agentSteps,
              plan: fallback.plan,
              rows: fallback.rows,
              chart,
              totalSteps: agentSteps.length,
              elapsedMs: Date.now() - started,
            }
          }

          response.setHeader('Content-Type', 'application/json; charset=utf-8')
          response.end(JSON.stringify(result))
        } catch (error) {
          console.error('[sale-scope-assistant]', redactError(error.message))
          response.statusCode = 400
          response.setHeader('Content-Type', 'application/json; charset=utf-8')
          response.end(JSON.stringify({ error: redactError(error.message), agentSteps, totalSteps: agentSteps.length }))
        }
      })
      server.middlewares.use('/charts', (request, response, next) => serveChart(request, response, next))
      server.middlewares.use('/api/evaluation', async (request, response) => {
        if (request.method !== 'POST') {
          response.statusCode = 405
          response.end(JSON.stringify({ error: '只支持 POST 请求' }))
          return
        }
        try {
          let body = ''
          for await (const chunk of request) body += chunk
          const payload = JSON.parse(body || '{}')
          if (!Array.isArray(payload.results) || payload.results.length !== 10) throw new Error('评测结果必须包含 10 道题')
          const saved = await saveEvaluation({ ...payload, savedAt: new Date().toISOString() })
          response.setHeader('Content-Type', 'application/json; charset=utf-8')
          response.end(JSON.stringify({ ok: true, ...saved }))
        } catch (error) {
          response.statusCode = 400
          response.setHeader('Content-Type', 'application/json; charset=utf-8')
          response.end(JSON.stringify({ error: error.message }))
        }
      })
    },
  }
}

export { createAssistantPlugin }
