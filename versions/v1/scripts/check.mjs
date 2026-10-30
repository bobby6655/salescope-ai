import { readFile, readdir } from 'node:fs/promises'

const rootFiles = ['index.html', 'src/main.jsx', 'src/styles.css', 'data/sales-data.csv', 'server/assistant-plugin.js', 'server/chartService.js', 'server/evaluationService.js', 'src/chartGenerator.js', 'src/evaluationCases.js', '.env.example', '.gitignore']
const requiredColumns = ['订单日期', '地区', '产品', '产品类别', '客户类型', '销售额', '成本', '折扣', '数量']
const checks = []

function check(label, condition, detail = '') {
  checks.push({ label, condition, detail })
}

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/)
  const headers = lines.shift().split(',')
  const rows = lines.map((line, lineIndex) => {
    const values = line.split(',')
    if (values.length !== headers.length) {
      throw new Error(`第 ${lineIndex + 2} 行有 ${values.length} 列，应为 ${headers.length} 列`)
    }
    return Object.fromEntries(headers.map((header, index) => [header, values[index].trim()]))
  })
  return { headers, rows }
}

function toNumber(value, field, rowNumber) {
  const number = Number(value)
  if (!Number.isFinite(number)) throw new Error(`第 ${rowNumber} 行的「${field}」不是数字`)
  return number
}

try {
  const contents = await Promise.all(rootFiles.map((file) => readFile(file, 'utf8')))
  const [indexHtml, mainJsx, styles, csv, assistantPlugin, chartService, evaluationService, chartGenerator, evaluationCases, envExample, gitignore] = contents
  const chartFiles = await readdir('charts').catch(() => [])
  const agentLoop = await readFile('server/agentLoop.js', 'utf8')
  const { headers, rows } = parseCsv(csv)

  check('React 挂载节点存在', indexHtml.includes('<div id="root">'))
  check('趋势图组件存在', mainJsx.includes('function TrendChart'))
  check('上传入口存在', mainJsx.includes('type="file"') && mainJsx.includes('handleFile'))
  check('真实 CSV 解析接入', mainJsx.includes("parseCsv(String(reader.result ?? ''))") && mainJsx.includes('setRows(dataset.rows)'))
  check('本地分析服务接入', mainJsx.includes("fetch('/api/assistant'") && mainJsx.includes('body: JSON.stringify({ question: next, history: chatHistory, rows, headers'))
  check('多轮对话上下文存在', mainJsx.includes('chatHistory') && assistantPlugin.includes('body.history') && agentLoop.includes('...history'))
  check('万擎配置仍为环境变量', assistantPlugin.includes("readEnv('WQ_API_KEY')") && assistantPlugin.includes("readEnv('WQ_MODEL_ID')") && envExample.includes('WQ_API_KEY'))
  check('密钥没有写进源代码', (!process.env.WQ_API_KEY || !assistantPlugin.includes(process.env.WQ_API_KEY)) && gitignore.includes('.env'))
  check('演示模式保护存在', assistantPlugin.includes('WQ_DEMO_FALLBACK') && assistantPlugin.includes("source = 'demo'"))
  check('响应计划不直接丢给前端重定向', assistantPlugin.includes("redirect: 'manual'"))
  check('ReAct 工具循环接入', mainJsx.includes('AgentSteps') && assistantPlugin.includes('runAgentLoop') && agentLoop.includes('turn <= maxTurns') && agentLoop.includes('Observation') && agentLoop.includes('render_chart'))
  check('图表保存功能存在', mainJsx.includes('downloadChart') && mainJsx.includes('URL.revokeObjectURL'))
  check('服务端真实图片链路存在', chartService.includes('await mkdir(chartsDir, { recursive: true })') && chartService.includes("await writeFile(filePath, svg, 'utf8')") && assistantPlugin.includes('makeChart(question, fallback.plan, fallback, agentSteps)') && mainJsx.includes('analysis.chart.publicPath'))
  check('图表失败会自动修正', chartService.includes('fallbackType') && assistantPlugin.includes('图片生成失败并自动修正'))
  check('月度地区占比与堆积图能力存在', agentLoop.includes("operation !== 'share'") && chartGenerator.includes("type === 'multi-line'") && chartGenerator.includes("type === 'stacked-bar'") && chartGenerator.includes('point.series'))
  check('项目图表文件夹已有图片', chartFiles.some((file) => file.endsWith('.svg')), `当前图片数：${chartFiles.filter((file) => file.endsWith('.svg')).length}`)
  check('十题自动评测配置存在', evaluationCases.includes('id: 10') && evaluationCases.includes('利润分析') && mainJsx.includes('runEvaluation') && mainJsx.includes('EvaluationList'))
  check('评测结果会保存', mainJsx.includes("fetch('/api/evaluation'") && evaluationService.includes("writeFile(filePath"))
  check('移动端布局存在', styles.includes('@media (max-width: 767px)'))
  check('所有业务字段存在', requiredColumns.every((column) => headers.includes(column)), `缺少字段：${requiredColumns.filter((column) => !headers.includes(column)).join('、')}`)

  check('模拟数据行数正确', rows.length === 12, `实际读取 ${rows.length} 行`)
  const orderKeys = new Set()
  let totalSales = 0
  let totalQuantity = 0
  const regionTotals = new Map()
  const productTotals = new Map()

  rows.forEach((row, index) => {
    const rowNumber = index + 2
    const date = new Date(row['订单日期'])
    const sales = toNumber(row['销售额'], '销售额', rowNumber)
    const cost = toNumber(row['成本'], '成本', rowNumber)
    const discount = toNumber(row['折扣'], '折扣', rowNumber)
    const quantity = toNumber(row['数量'], '数量', rowNumber)
    const key = `${row['订单日期']}|${row['地区']}|${row['产品']}|${row['销售额']}`
    check(`第 ${rowNumber} 行日期合法`, !Number.isNaN(date.valueOf()))
    check(`第 ${rowNumber} 行销售额有效`, sales >= 0)
    check(`第 ${rowNumber} 行成本有效`, cost >= 0 && cost <= sales)
    check(`第 ${rowNumber} 行折扣有效`, discount > 0 && discount <= 1)
    check(`第 ${rowNumber} 行数量有效`, Number.isInteger(quantity) && quantity > 0)
    check(`第 ${rowNumber} 行无重复记录`, !orderKeys.has(key), `重复键：${key}`)
    orderKeys.add(key)
    totalSales += sales
    totalQuantity += quantity
    regionTotals.set(row['地区'], (regionTotals.get(row['地区']) ?? 0) + sales)
    productTotals.set(row['产品'], (productTotals.get(row['产品']) ?? 0) + sales)
  })

  check('销售额汇总正确', totalSales === 57100, `计算结果为 ${totalSales}，预期为 57100`)
  check('数量汇总正确', totalQuantity === 164, `计算结果为 ${totalQuantity}，预期为 164`)
  check('最高地区识别正确', [...regionTotals.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] === '华东')
  check('最高产品识别正确', [...productTotals.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] === '智能手表 S3')
  check('错误信息会回显到页面', mainJsx.includes('setAnalysisError(error.message)') && mainJsx.includes('analysisError'))
  check('输入操作有异常保护', mainJsx.includes('try {') && mainJsx.includes('catch (error)'))
  check('不存在无限循环语句', !/\b(while|do)\s*\(/.test(mainJsx))
  check('询问操作有结束反馈', mainJsx.includes('setTimeout(() => setToast(\'\'), 2600)'))
} catch (error) {
  check('自动检查执行过程', false, error.message)
}

const failed = checks.filter((item) => !item.condition)
for (const item of checks) {
  console.log(`${item.condition ? 'PASS' : 'FAIL'} ${item.label}${item.condition || !item.detail ? '' : `：${item.detail}`}`)
}
console.log(`\n检查结果：${checks.length - failed.length}/${checks.length} 项通过`)
if (failed.length > 0) {
  console.error('检查未通过，请根据 FAIL 后的原因修复后重试。')
  process.exitCode = 1
} else {
  console.log('所有自动检查通过。')
}
