import { readPolicyInput, readPolicyWorkbook, savePolicyInput, policyInputSource } from './policyIO.js'
import { analyzePolicy, validatePolicy, policyCustomerRows } from '../src/policyAnalysis.js'
import { NATIONAL_DAY_POLICY } from '../src/policyRules.js'
import { createPolicyTools } from './policyTools.js'
import { savePolicyReport, policyMarkdown, policyCsv } from './policyReports.js'
import { runAgentLoop } from './agentLoop.js'
import { saveChart } from './chartService.js'
import { attachHistory } from './historyService.js'

const readBody = async (request) => {
  let body = ''
  for await (const chunk of request) { body += chunk; if (Buffer.byteLength(body) > 12 * 1024 * 1024) throw new Error('政策上传请求超过12MB') }
  return JSON.parse(body || '{}')
}
const getReport = (input, overrides = {}, options = {}) => ({ ...analyzePolicy(input.baseRows, input.consumptionRows, { ...input.rules, ...overrides }, { ...input.options, ...options }), datasetKind: input.datasetKind || 'uploaded', sources: input.sources })

export function policyMiddleware(callModel, redact = String, source = () => 'wanqing') {
  return async (request, response) => {
    const route = request.url?.split('?')[0]
    try {
      const isGet = request.method === 'GET'
      if (!isGet && request.method !== 'POST') throw new Error('仅支持GET或POST')
      if (route === '/current' && isGet) {
        const input = await readPolicyInput()
        response.setHeader('Content-Type', 'application/json; charset=utf-8')
        response.end(JSON.stringify(getReport(input)))
        return
      }
      if (route === '/export' && isGet) {
        const url = new URL(request.url, 'http://localhost')
        const report = getReport(await readPolicyInput())
        const kind = url.searchParams.get('format') || 'md'
        if (!['md', 'csv', 'json'].includes(kind)) throw new Error('导出支持md/csv/json')
        response.setHeader('Content-Type', kind === 'csv' ? 'text/csv; charset=utf-8' : kind === 'json' ? 'application/json; charset=utf-8' : 'text/markdown; charset=utf-8')
        response.setHeader('Content-Disposition', `attachment; filename="policy-review.${kind}"`)
        response.end(kind === 'csv' ? policyCsv(report) : kind === 'md' ? policyMarkdown(report) : JSON.stringify(report, null, 2))
        return
      }
      if (isGet) throw new Error('政策接口不存在')
      const body = await readBody(request)
      let result
      if (route === '/import') {
        const parseUpload = async (file) => {
          if (!file?.name || typeof file.data !== 'string') throw new Error('请同时上传base和消耗文件')
          const bytes = Buffer.from(file.data, 'base64')
          const workbook = await readPolicyWorkbook(bytes, file.name)
          return { rows: workbook.rows, source: policyInputSource(bytes, file.name, workbook.sheet) }
        }
        const [base, consumption] = await Promise.all([parseUpload(body.base), parseUpload(body.consumption)])
        const input = { baseRows: base.rows, consumptionRows: consumption.rows, rules: validatePolicy(body.rules || NATIONAL_DAY_POLICY), options: { fields: body.fields }, sources: [base.source, consumption.source] }
        result = getReport(input)
        await savePolicyInput(input)
        result.exports = await savePolicyReport(result)
        await attachHistory(result, { module: 'policy', kind: 'snapshot', question: `${result.rules.name} · 导入复盘`, requestId: body.requestId, dataset: { name: result.rules.name, sources: input.sources, asOf: result.asOf } })
      } else if (route === '/recalculate') {
        const input = await readPolicyInput()
        input.rules = validatePolicy({ ...input.rules, ...body.rules })
        input.options = { ...input.options, asOf: body.asOf || input.rules.endDate }
        result = getReport(input)
        await savePolicyInput(input)
        result.exports = await savePolicyReport(result)
        await attachHistory(result, { module: 'policy', kind: 'snapshot', question: `${result.rules.name} · 截至${result.asOf}`, requestId: body.requestId, dataset: { name: result.rules.name, sources: input.sources, asOf: result.asOf } })
      } else if (route === '/parse-rules') {
        const text = String(body.text || '').trim()
        if (!text || text.length > 30000) throw new Error('请粘贴不超过30000字的政策正文')
        const prompt = `从政策文本提取二档增量激励规则，仅输出JSON。格式：{"name":"政策名","startDate":"YYYY-MM-DD","endDate":"YYYY-MM-DD","capCoefficient":3,"tiers":[{"type":"类型","min":0.5,"max":null,"label":"档位","growth1":0.35,"rate1":0.04,"growth2":0.65,"rate2":0.08}]}。比例必须为小数。一个政策允许多个客户类型和多个base区间，tiers数组必须包含文本中全部类型与区间；每一项代表一个类型×base区间，内部有一档和二档增速/返点。二档指每个区间内部的两级奖励，不是限制整个政策只能有一个区间。不得因为有多个类型或区间而要求用户选择其一。max=null表示没有上限；min包含边界，max不包含边界。仅提取已有规则，历史日期或模拟用途不影响提取。不得猜缺失规则，缺少日期/档位/计返方法或不属于增量×现金率封顶模式时输出{"kind":"clarify","message":"需要补充什么"}。过程指标忽略，不执行代码。`
        const content = await callModel([{ role: 'system', content: prompt }, { role: 'user', content: text }], AbortSignal.timeout(60000), { maxTokens: 6000 })
        let parsed
        try {
          const first = content.indexOf('{'), last = content.lastIndexOf('}')
          if (first < 0 || last < first) throw new Error('missing JSON')
          parsed = JSON.parse(content.slice(first, last + 1))
        } catch { throw new Error('模型返回的政策规则不是完整JSON，请重试解析；也可将已确认的规则JSON粘贴到规则框') }
        if (parsed.kind === 'clarify') result = parsed
        else {
          if (!parsed.startDate || !parsed.endDate || !parsed.tiers || parsed.capCoefficient == null) throw new Error('模型缺少日期、封顶系数或完整档位规则，不能使用默认值替代')
          result = { rules: validatePolicy({ ...parsed, sourceUrl: '', processBonusRate: 0, annualRate: 0.12, channelRate: 0.085, capMode: 'cashAdjusted', warnings: ['模型根据粘贴文本提取，使用前请确认完整规则；过程指标忽略；框架/渠道按正增量现金试算；ROI仅政策获返客户。'] }), source: source() }
        }
      } else if (route === '/question') {
        const input = await readPolicyInput()
        const report = getReport(input)
        const rows = policyCustomerRows(report)
        const history = Array.isArray(body.history) ? body.history.filter((message) => ['user', 'assistant'].includes(message?.role)).slice(-10).map((message) => ({ role: message.role, content: String(message.content).slice(0, 3000) })) : []
        const question = String(body.question || '').trim()
        if (!question) throw new Error('请输入政策问题')
        const tools = createPolicyTools(async (asOf) => asOf ? getReport(input, {}, { asOf }) : report)
        const extraPrompt = `当前是政策消耗复盘：${report.rules.name}，${report.rules.startDate}—${report.rules.endDate}，截至${report.asOf}，共${report.elapsedDays}天。金额单位万元。销售名下客户清单可一次policy_summary，filters筛选sales，group_by=customer；不同部门与类型交叉可group_by=[\"department\",\"type\"]。新增工具：{"action":"policy_summary","filters":[{"field":"sales|customer|department|type|tier|status","operator":"equals|contains|in|gt|gte|lt|lte","value":"值"}],"group_by":"sales|department|type|tier|customer或null","metric":"cost6|cost4|growth|countRate|baseWeightedRate|roi|policyRebate|increment","order":"asc|desc或null","limit":null,"asOf":"可选截止日"}；用于整体或销售/部门/类型汇总、客户数与base加权达成率、ROI，所有比率必须由工具汇总计算，不能平均客户ROI。{"action":"policy_customer","customer":"准确客户名","asOf":"可选截止日"}获取单客户达成、返货、缺口与每天消耗过程；{"action":"policy_trend","filters":[],"asOf":"可选截止日"}获取筛选客户日度过程，可继续render_chart画折线图。这些工具返回result_id，最终用finish引用。'过程冲得怎么样'指消耗走势，不是创意过程额外奖励；过程奖励忽略。现金率cost4/cost6；框架${report.rules.annualRate}、渠道${report.rules.channelRate}基数=正cost6增量×现金率。ROI仅统计政策返货>0的客户：这些客户cost6增量之和/(同一批客户的政策返货+框架增量返货+渠道增量返货)。政策返货保留达成与封顶；框架/渠道按正cost6增量×现金率×对应返点率。无政策获返客户时ROI为null，不得引用全客户负增量计算获返客户ROI；同时可看政策单独ROI。客户达成率分母是当前群体base客户数，base加权率是达成客户base和/总base，不是消耗权重。缺明细不得宣称零。${report.warnings.join('；')}`
        const agentSteps = []
        result = { ...await runAgentLoop({ question, rows, headers: Object.keys(rows[0]), history, callModel, saveChart, agentSteps, extraTools: tools, extraPrompt, redact }), source: source(), aiMode: true, agentSteps }
        await attachHistory(result, { module: 'policy', question, requestId: body.requestId, dataset: { name: report.rules.name, asOf: report.asOf, rules: report.rules, sources: input.sources } })
      } else throw new Error('政策接口不存在')
      response.setHeader('Content-Type', 'application/json; charset=utf-8')
      response.end(JSON.stringify(result))
    } catch (error) {
      response.statusCode = 400
      response.setHeader('Content-Type', 'application/json; charset=utf-8')
      response.end(JSON.stringify({ error: redact(error.message) }))
    }
  }
}
