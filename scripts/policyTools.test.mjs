import assert from 'node:assert/strict'
import { test } from 'node:test'
import { analyzePolicy } from '../src/policyAnalysis.js'
import { createPolicyTools } from '../server/policyTools.js'
import { runAgentLoop } from '../server/agentLoop.js'
import { policyCsv } from '../server/policyReports.js'

const dates = Array.from({ length: 13 }, (unused, index) => new Date(Date.UTC(2026, 8, 25 + index)).toISOString().slice(0, 10))
const baseRows = [{ 客户: 'A', 属性: '小游戏', 行业分组: '部门甲', 负责销售: 'sales-a', 'base(万/日)': 1 }, { 客户: 'B', 属性: '小游戏', 行业分组: '部门乙', 负责销售: 'sales-b', 'base(万/日)': 10 }, { 客户: '=危险公式', 属性: '小游戏', 行业分组: '部门乙', 负责销售: 'sales-b', 'base(万/日)': 1 }]
const costs = dates.flatMap((date) => [{ 日期: date, 客户: 'A', 'cost_6消耗(万)': 2, 'cost_4现金(万)': 2 }, { 日期: date, 客户: 'B', 'cost_6消耗(万)': 8, 'cost_4现金(万)': 8 }])
const report = analyzePolicy(baseRows, costs)
const tools = createPolicyTools(async (asOf) => asOf ? analyzePolicy(baseRows, costs, undefined, { asOf }) : report)

test('policy tools compute scoped weighted rates and policy recipient ROI locally', async () => {
  const result = await tools.policy_summary({ filters: [{ field: 'sales', operator: 'equals', value: 'sales-a' }], metric: 'baseWeightedRate' })
  assert.equal(result.value, 1)
  assert.equal(result.table[0].values['客户数'], 1)
  const all = await tools.policy_summary({ metric: 'roi' })
  assert.equal(all.value, report.summary.roi)
  assert.ok(all.value > 0)
  assert.equal(all.table[0].values['ROI获返客户数'], 1)
  const noRebate = await tools.policy_summary({ filters: [{ field: 'customer', value: 'B' }], metric: 'roi' })
  assert.equal(noRebate.value, null)
  await assert.rejects(tools.policy_summary({ group_by: 'cluster' }), /分组/)
  const grouped = await tools.policy_summary({ group_by: 'department', metric: 'cost6' })
  assert.equal(grouped.rows.length, 2)
})

test('customer and trend tools preserve elapsed dates and do not claim missing spend is zero', async () => {
  const customer = await tools.policy_customer({ customer: 'A', asOf: '2026-09-27' })
  assert.equal(customer.rows.length, 3)
  assert.equal(customer.value, 6)
  const absent = await tools.policy_customer({ customer: '=危险公式' })
  assert.ok(absent.answer.includes('不能断言'))
  assert.equal(absent.rows[0].value, null)
  const trend = await tools.policy_trend({ filters: [{ field: 'customer', value: 'A' }] })
  assert.equal(trend.rows.reduce((total, row) => total + row.value, 0), 26)
  await assert.rejects(tools.policy_summary({ filters: [{ field: 'SQL', value: 'DROP' }] }), /字段/)
})

test('custom policy results participate in ReAct observations and finish references', async () => {
  const actions = [{ action: 'policy_summary', filters: [{ field: 'sales', value: 'sales-a' }], metric: 'roi' }, { action: 'finish', result_id: 'result-1' }]
  let index = 0
  const result = await runAgentLoop({ question: '销售ROI是多少', rows: [{ customer: 'A', cost6: 26 }], headers: ['customer', 'cost6'], extraTools: tools, callModel: async (messages) => {
    assert.ok(messages[0].content.includes('policy_summary'))
    if (index === 1) assert.ok(messages.at(-1).content.includes('result-1'))
    return JSON.stringify(actions[index++])
  }, saveChart: async () => {} })
  assert.ok(result.answer.includes('sales-a') || result.answer.includes('筛选客户'))
  assert.equal(result.table[0].values['客户数'], 1)
})

test('CSV export neutralizes formula-like client text without changing negative numeric values', () => {
  const csv = policyCsv(report)
  assert.ok(csv.includes("'=危险公式"))
  assert.ok(csv.includes('"-26"'))
})
