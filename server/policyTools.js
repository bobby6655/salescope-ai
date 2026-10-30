import { summarizeCustomers } from '../src/policyAnalysis.js'

const format = (value) => value == null ? '—' : value.toLocaleString('zh-CN', { maximumFractionDigits: 4 })
const percent = (value) => value == null ? '—' : `${format(value * 100)}%`
const labels = { cost6: '考核消耗cost6(万)', cost4: '计返消耗cost4(万)', baseTotal: '同天数base消耗(万)', increment: 'cost6净增量(万)', growth: '相对base增速', count: '客户数', hit1Count: '一档及以上客户数', hit2Count: '二档客户数', countRate: '客户数达成率', baseWeightedRate: 'base加权达成率', policyRebate: '政策返货试算(万)', annualRebate: '框架增量返货试算(万)', channelRebate: '渠道增量返货试算(万)', totalRebate: '总返货试算(万)', roi: '获返客户增量ROI', roiCustomerCount: 'ROI获返客户数', roiIncrement: 'ROI获返客户cost6增量(万)', roiTotalRebate: 'ROI获返客户三项返货(万)', roiAnnualRebate: 'ROI获返客户框架返货(万)', roiChannelRebate: 'ROI获返客户渠道返货(万)', policyRoi: '政策返货口径ROI', cashRate: '现金率', unknownCount: '待核验客户数' }
const percentFields = ['growth', 'countRate', 'baseWeightedRate', 'cashRate']
const fieldAliases = { 客户: 'customer', 销售: 'sales', 负责销售: 'sales', 部门: 'department', 行业分组: 'department', 部门类型: 'departmentType', 类型: 'type', 属性: 'type', 档位: 'tier', 状态: 'status', 增速: 'growth', ROI: 'roi', cost6: 'cost6', cost4: 'cost4' }
const allowedFields = ['customer', 'sales', 'department', 'departmentType', 'type', 'tier', 'status', 'growth', 'roi', 'cost6', 'cost4', 'hit1', 'hit2']

function selectCustomers(report, filters = []) {
  if (!Array.isArray(filters)) throw new Error('政策筛选条件必须是数组')
  return filters.reduce((rows, filter) => {
    const field = fieldAliases[filter.field] || filter.field
    if (!allowedFields.includes(field)) throw new Error(`不支持的政策筛选字段：${filter.field}`)
    const operator = filter.operator || 'equals'
    if (!['equals', 'contains', 'in', 'gt', 'gte', 'lt', 'lte'].includes(operator)) throw new Error('政策筛选支持equals/contains/in/gt/gte/lt/lte')
    if (operator === 'in' && !Array.isArray(filter.value)) throw new Error('in需要数组值')
    return rows.filter((row) => {
      const value = row[field]
      if (value == null) return false
      if (operator === 'equals') return String(value) === String(filter.value)
      if (operator === 'contains') return String(value).includes(String(filter.value))
      if (operator === 'in') return filter.value.map(String).includes(String(value))
      const expected = Number(filter.value)
      if (typeof value !== 'number' || !Number.isFinite(expected)) throw new Error('比较筛选必须使用数值字段')
      return operator === 'gt' ? value > expected : operator === 'gte' ? value >= expected : operator === 'lt' ? value < expected : value <= expected
    })
  }, report.customers)
}

export function describePolicySummary(summary, label = '全部客户') {
  return `${label}：${summary.count}个base客户，${summary.matchedCount}个有消耗明细；一档及以上${summary.hit1Count}个，二档${summary.hit2Count}个。客户数达成率${percent(summary.countRate)}，base加权达成率${percent(summary.baseWeightedRate)}。cost6=${format(summary.cost6)}万，cost4=${format(summary.cost4)}万；同天数base=${format(summary.baseTotal)}万，观测净增量=${format(summary.increment)}万，增速${percent(summary.growth)}。政策返货试算${format(summary.policyRebate)}万，框架增量${format(summary.annualRebate)}万，渠道增量${format(summary.channelRebate)}万；仅${summary.roiCustomerCount}个政策获返客户纳入ROI，获返客户增量=${format(summary.roiIncrement)}万、三项返货分母=${format(summary.roiTotalRebate)}万；获返客户增量ROI=${format(summary.roi)}，政策单独ROI=${format(summary.policyRoi)}。未获政策返货客户ROI不适用。待核验${summary.unknownCount}个；缺数时达成率为观测下界，不是已核验的结算。`
}

function summaryComputed(groups, metric, evidence, plan) {
  if (!labels[metric]) throw new Error(`政策指标无效：${metric}`)
  const measures = Object.keys(labels).map((key) => ({ alias: labels[key], unit: percentFields.includes(key) ? 'percent' : 'number' }))
  const rows = groups.map((group) => ({ label: group.label, value: group.summary[metric] }))
  const table = groups.map((group) => ({ dimensions: [group.label], values: Object.fromEntries(Object.keys(labels).map((key) => [labels[key], group.summary[key]])) }))
  return { rows, table, measures, dimensions: [{ column: plan.group_by || '全部客户' }], value: rows[0]?.value, metric: labels[metric], unit: percentFields.includes(metric) ? 'percent' : 'number', operation: ['countRate', 'baseWeightedRate', 'cashRate'].includes(metric) ? 'share' : 'group', evidence, answer: groups.map((group) => describePolicySummary(group.summary, group.label)).join('\n'), query: plan }
}

export function createPolicyTools(reportProvider) {
  return {
    policy_summary: async (action) => {
      const report = await reportProvider(action.asOf)
      const selected = selectCustomers(report, action.filters)
      if (!selected.length) throw new Error('未找到符合筛选的政策客户')
      const groupFields = action.group_by == null ? [] : (Array.isArray(action.group_by) ? action.group_by : [action.group_by]).map((field) => fieldAliases[field] || field)
      if (groupFields.length > 2 || new Set(groupFields).size !== groupFields.length || groupFields.some((field) => !['customer', 'sales', 'department', 'departmentType', 'type', 'tier', 'status'].includes(field))) throw new Error('政策分组支持最多两个不同的客户/销售/部门/类型/档位/状态维度')
      const groupKey = (row) => JSON.stringify(groupFields.map((field) => row[field]))
      let groups = groupFields.length ? [...new Set(selected.map(groupKey))].map((key) => ({ label: JSON.parse(key).join(' / '), summary: summarizeCustomers(selected.filter((row) => groupKey(row) === key), report.elapsedDays) })) : [{ label: '筛选客户合计', summary: summarizeCustomers(selected, report.elapsedDays) }]
      const metric = action.metric || 'cost6'
      if (!labels[metric]) throw new Error(`政策指标无效：${metric}`)
      if (action.order) {
        if (!['asc', 'desc'].includes(action.order)) throw new Error('排序需要asc/desc')
        groups.sort((left, right) => (action.order === 'asc' ? 1 : -1) * ((left.summary[metric] ?? -Infinity) - (right.summary[metric] ?? -Infinity)))
      }
      if (action.limit != null) {
        if (!Number.isInteger(Number(action.limit)) || Number(action.limit) <= 0) throw new Error('limit必须为正整数')
        groups = groups.slice(0, Number(action.limit))
      }
      const plan = { filters: action.filters || [], group_by: groupFields.length ? groupFields : null, limit: action.limit == null ? null : Number(action.limit), operation: 'policy_summary' }
      const computed = summaryComputed(groups, metric, `${report.rules.name}；截至${report.asOf}，${report.elapsedDays}天；客户数/base加权分母仅在当前筛选群体内；ROI只统计政策返货>0的客户，用这些客户的增量合计除其三项返货合计，框架/渠道采用正增量×现金率，不能平均客户ROI。${report.warnings.join('；')}`, plan)
      if (groupFields.length) computed.answer = describePolicySummary(summarizeCustomers(selected, report.elapsedDays), '当前群体整体') + '\n' + computed.answer
      return computed
    },
    policy_customer: async (action) => {
      const report = await reportProvider(action.asOf)
      const matches = report.customers.filter((row) => row.customer === String(action.customer).normalize('NFKC').trim())
      if (matches.length !== 1) throw new Error('请提供base表中的准确客户名')
      const customer = matches[0]
      const summary = summarizeCustomers(matches, report.elapsedDays)
      const rows = customer.daily.map((day) => ({ label: day.date, value: day.cost6 }))
      if (!rows.length && !report.rules.missingAsZero) {
        const computed = summaryComputed([{ label: customer.customer, summary }], 'count', `没有消耗明细，不能断言cost6为零。base日均${customer.baseDaily}万。`, { filters: [{ field: 'customer', value: customer.customer }], operation: 'policy_customer' })
        computed.answer = `${customer.customer}没有消耗明细，不能断言零消耗或未达成，也不能确认返货/ROI。已知base日均${customer.baseDaily}万，一档全期目标${format(customer.target1)}万；请补充明细或确认SQL缺行代表零。`
        computed.rows = [{ label: customer.customer, value: null }]
        return computed
      }
      if (!rows.length) return summaryComputed([{ label: customer.customer, summary }], 'cost6', '已确认SQL缺行代表零消耗。', { filters: [], operation: 'policy_customer' })
      let cumulative = 0
      const table = customer.daily.map((day) => {
        cumulative += day.cost6
        return { dimensions: [day.date], values: { '每日cost6(万)': day.cost6, '每日cost4(万)': day.cost4, '日均base(万)': customer.baseDaily, '累计cost6(万)': cumulative } }
      })
      return { rows, table, measures: Object.keys(table[0].values).map((alias) => ({ alias, unit: 'number' })), dimensions: [{ column: '日期' }], value: customer.cost6, metric: `${customer.customer}每日cost6(万)`, unit: 'number', operation: 'group', query: { filters: [], operation: 'policy_customer' }, evidence: `销售${customer.sales}；${customer.department}/${customer.type}/${customer.tier}；一档增速${percent(customer.growth1)}，二档${percent(customer.growth2)}；有明细${customer.coverageDays}/${report.elapsedDays}天。缺明细日不绘制为真实零；仅分析消耗过程，未读取创意等过程奖励。`, answer: `${describePolicySummary(summary, customer.customer)}\n截至${report.asOf}，全期一档目标${format(customer.target1)}万，观测缺口${format(customer.gap1)}万；二档目标${format(customer.target2)}万，观测缺口${format(customer.gap2)}万。${report.remainingDays ? `剩余${report.remainingDays}天，一档所需日均${format(customer.neededDaily1)}万。` : '政策期已结束，以上为期末消耗复盘。'}` }
    },
    policy_trend: async (action) => {
      const report = await reportProvider(action.asOf)
      const customers = selectCustomers(report, action.filters)
      if (!customers.length) throw new Error('没有符合筛选的客户')
      const base = customers.reduce((total, customer) => total + customer.baseDaily, 0)
      const table = report.trend.map((day, index) => {
        const cost6 = customers.reduce((total, customer) => total + (customer.daily.find((record) => record.date === day.date)?.cost6 || 0), 0)
        const cumulative = customers.reduce((total, customer) => total + customer.daily.filter((record) => record.date <= day.date).reduce((subtotal, record) => subtotal + record.cost6, 0), 0)
        return { dimensions: [day.date], values: { '每日cost6(万)': cost6, '累计cost6(万)': cumulative, '累计base(万)': base * (index + 1) } }
      })
      return { rows: table.map((record) => ({ label: record.dimensions[0], value: record.values['每日cost6(万)'] })), table, measures: Object.keys(table[0].values).map((alias) => ({ alias, unit: 'number' })), dimensions: [{ column: '日期' }], value: table.at(-1).values['累计cost6(万)'], metric: '已记录每日cost6(万)', unit: 'number', operation: 'group', query: { filters: action.filters || [], operation: 'policy_trend' }, evidence: `筛选${customers.length}个客户，${report.elapsedDays}天。缺行只计入观测下界，不据此断言真实零；按同天数base比较。`, answer: describePolicySummary(summarizeCustomers(customers, report.elapsedDays), '消耗过程汇总') }
    },
  }
}
