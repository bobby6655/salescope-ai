import { prepareDataset, executeQuery, resolveColumn } from './datasetEngine.js'
export { parseCsv, executePlan } from './datasetEngine.js'

export function analyzeQuestion(rows, question, options = {}) {
  const dataset = prepareDataset(rows, options.headers ?? Object.keys(rows[0] ?? {}), options)
  const explicit = dataset.columns.filter((column) => question.includes(column.name))
  const metric = explicit.find((column) => column.type === 'number')?.name ?? resolveColumn(dataset, /利润/.test(question) ? '收入' : /折扣/.test(question) ? '折扣' : /数量|销量/.test(question) ? '数量' : '收入')
  const dateColumn = dataset.roles.date.column
  const groupBy = []
  if (/每月|每个月|按月|哪个月/.test(question)) {
    if (!dateColumn) throw new Error('请确认日期字段')
    groupBy.push({ column: dateColumn, time_grain: 'month' })
  }
  const dimension = /地区/.test(question) ? dataset.roles.region.column : /产品/.test(question) ? dataset.roles.product.column : /客户类型/.test(question) ? dataset.roles.customerType.column : explicit.find((column) => column.type === 'string')?.name
  if (dimension) groupBy.push({ column: dimension })
  const filters = []
  if (/去年/.test(question)) {
    if (!dateColumn) throw new Error('请确认日期字段')
    filters.push({ column: dateColumn, operator: 'year', value: new Date().getFullYear() - 1 })
  }
  if (dataset.roles.region.column) {
    const regionColumn = dataset.roles.region.column
    const regions = [...new Set(dataset.rows.map((row) => row[regionColumn]))].filter((value) => value && question.includes(String(value)))
    if (regions.length === 1) filters.push({ column: regionColumn, operator: 'equals', value: regions[0] })
  }
  const measure = /利润/.test(question) ? { alias: '利润', unit: dataset.columns.find((column) => column.name === metric)?.unit || 'number', expression: { operator: 'subtract', left: { column: resolveColumn(dataset, '收入'), aggregate: 'sum' }, right: { column: resolveColumn(dataset, '成本'), aggregate: 'sum' } } } : { column: metric, aggregate: /平均/.test(question) ? 'avg' : 'sum', alias: metric }
  const plan = { group_by: groupBy, measures: [measure], filters, share: /占比|比例/.test(question), order: /最高|最低|前三|前3/.test(question) ? { measure: measure.alias, direction: /最低/.test(question) ? 'asc' : 'desc' } : null, limit: /前三|前3/.test(question) ? 3 : /最高|最低/.test(question) ? 1 : null }
  const computed = executeQuery(dataset, plan)
  if (/堆[积叠]/.test(question)) plan.chart = 'stacked-bar'
  else if (/图|趋势|画/.test(question)) plan.chart = groupBy.length === 2 ? 'multi-line' : /柱状/.test(question) ? 'bar' : groupBy.some((group) => group.time_grain) ? 'line' : 'bar'
  const agentSteps = [{ title: '本地演示查询', method: '规则模式仅处理能够明确映射的问题。', result: computed.evidence }, { title: '计算完成', method: '数字来自通用数据执行器。', result: computed.answer }]
  return { ...computed, plan, detail: computed.evidence, agentSteps, steps: agentSteps.map((step) => step.title + '：' + step.result), totalSteps: agentSteps.length }
}
