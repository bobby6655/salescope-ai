import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { parseCsv, executePlan } from '../src/dataAnalysis.js'
import { renderChartSvg, detectChartIntent } from '../src/chartGenerator.js'
import { runAgentLoop, normalizePlan } from '../server/agentLoop.js'

const dataset = parseCsv(await readFile(new URL('../data/sales-data.csv', import.meta.url), 'utf8'))
const matrixPlan = { operation: 'group', metric: '销售额', filters: [], group_by: ['订单日期', '地区'], order: null, limit: null }
const fixture = parseCsv('订单日期,地区,产品,产品类别,客户类型,销售额,成本,折扣,数量\n2025-01-02,华东,A,电子,会员,100,50,1,1\n2025-01-03,华南,B,电子,会员,300,100,1,2\n2025-02-02,华东,A,电子,会员,200,50,1,1\n2026-01-02,华东,A,电子,会员,50,20,1,1')

function scriptedModel(actions, observations = []) {
  let index = 0
  return async (messages) => {
    observations.push(structuredClone(messages))
    assert.ok(index < actions.length, '模型不应超出脚本轮数')
    const action = actions[index++]
    return typeof action === 'string' ? action : JSON.stringify(action)
  }
}

async function mockChart(options) {
  const svg = renderChartSvg(options)
  assert.ok(!/NaN|Infinity/.test(svg))
  return { type: options.type, title: options.title, relativePath: `charts/${options.type}.svg`, bytes: Buffer.byteLength(svg) }
}

test('二维汇总保留年份、补零，并且系列金额之和等于原始收入', () => {
  const result = executePlan(fixture.rows, matrixPlan)
  assert.deepEqual(result.rows.map((row) => row.label), ['2025-01', '2025-02', '2026-01'])
  assert.equal(result.rows[0].series.find((item) => item.label === '华南').value, 300)
  assert.equal(result.rows[1].series.find((item) => item.label === '华南').value, 0)
  assert.equal(result.rows.flatMap((row) => row.series).reduce((sum, item) => sum + item.value, 0), 650)
  const real = executePlan(dataset.rows, matrixPlan)
  assert.equal(real.rows.length, new Set(dataset.rows.map((row) => row.monthKey)).size)
  assert.equal(real.rows.reduce((sum, row) => sum + row.value, 0), 57100)
})

test('占比按每个月的总额计算，金额图和百分比图保留不同单位', () => {
  const result = executePlan(fixture.rows, { ...matrixPlan, operation: 'share' })
  assert.equal(result.rows[0].series.find((item) => item.label === '华东').value, 25)
  for (const row of result.rows) assert.ok(Math.abs(row.series.reduce((sum, item) => sum + item.value, 0) - 100) < 0.00001)
  assert.throws(() => executePlan(fixture.rows.map((row) => ({ ...row, sales: 0 })), { ...matrixPlan, operation: 'share' }), /分母/)
  const svg = renderChartSvg({ type: 'stacked-bar', rows: result.rows, operation: 'share' })
  assert.ok(svg.includes('data-value="25"'))
  assert.ok(svg.includes('100%'))
  assert.ok(!renderChartSvg({ type: 'multi-line', rows: executePlan(fixture.rows, matrixPlan).rows }).includes('占比'))
})

test('地区 × 产品和二维平均值支持工具组合', () => {
  const result = executePlan(fixture.rows, { ...matrixPlan, group_by: ['地区', '产品'] })
  assert.equal(result.rows.find((row) => row.label === '华东').series.find((item) => item.label === 'A').value, 350)
  const average = executePlan(fixture.rows, { ...matrixPlan, operation: 'average' })
  assert.equal(average.rows[0].series.find((item) => item.label === '华南').value, 300)
  assert.throws(() => executePlan(fixture.rows, { ...matrixPlan, group_by: ['不存在', '地区'] }), /分组列/)
})

test('堆积柱形分段是真实金额，拒绝把二维结果降级成普通柱形', () => {
  const rows = executePlan(fixture.rows, matrixPlan).rows
  const svg = renderChartSvg({ type: 'stacked-bar', title: '<收入>', rows })
  assert.equal((svg.match(/data-series=/g) ?? []).length, 6)
  assert.ok(svg.includes('&lt;收入&gt;'))
  assert.ok(svg.includes('data-value="300"'))
  assert.throws(() => renderChartSvg({ type: 'bar', rows }), /多维/)
  assert.throws(() => renderChartSvg({ type: 'stacked-bar', rows: [{ label: 'a', series: [{ label: 'x', value: NaN }] }] }), /有效/)
  assert.equal(detectChartIntent('每个月各地区堆积柱状图', matrixPlan).type, 'stacked-bar')
})

test('模型观察数据和查询后自主选择绘图、完成，历史保持在上下文', async () => {
  const observations = []
  const result = await runAgentLoop({ ...dataset, question: '画一个每个月各地区的堆积柱状图', history: [{ role: 'user', content: '分析销售额' }], saveChart: mockChart, callModel: scriptedModel([
    { action: 'inspect_data' },
    { action: 'query_data', plan: matrixPlan },
    { action: 'render_chart', result_id: 'result-1', type: 'stacked-bar' },
    { action: 'finish', result_id: 'result-1', chart_id: 'chart-1' },
  ], observations) })
  assert.equal(result.chart.type, 'stacked-bar')
  assert.equal(result.agentTurns, 4)
  assert.ok(result.answer.includes('charts/stacked-bar.svg'))
  assert.ok(observations[2].at(-1).content.includes('result-1'))
  assert.ok(observations[3].at(-1).content.includes('chart-1'))
  assert.ok(observations[0].some((message) => message.content === '分析销售额'))
})

test('JSON 解析错误和工具错误回传模型，支持重新查询后修正绘图', async () => {
  const observations = []
  const steps = []
  const result = await runAgentLoop({ ...fixture, question: '画每个月各地区堆积柱状图', agentSteps: steps, saveChart: mockChart, callModel: scriptedModel([
    '不是 JSON',
    { action: 'query_data', plan: { ...matrixPlan, group_by: '地区' } },
    { action: 'render_chart', result_id: 'result-1', type: 'stacked-bar' },
    { action: 'query_data', plan: matrixPlan },
    { action: 'render_chart', result_id: 'result-2', type: 'stacked-bar' },
    { action: 'finish', result_id: 'result-2', chart_id: 'chart-1' },
  ], observations) })
  assert.equal(result.rows.length, 3)
  assert.equal(steps.filter((step) => step.status === 'error').length, 2)
  assert.ok(observations[1].at(-1).content.includes('JSON'))
  assert.ok(observations[3].at(-1).content.includes('序列'))
})

test('finish 缺图和错误图表都会触发继续行动', async () => {
  const steps = []
  const result = await runAgentLoop({ ...fixture, question: '画每个月各地区堆积柱状图', agentSteps: steps, saveChart: mockChart, callModel: scriptedModel([
    { action: 'query_data', plan: matrixPlan },
    { action: 'finish', result_id: 'result-1' },
    { action: 'render_chart', result_id: 'result-1', type: 'multi-line' },
    { action: 'finish', result_id: 'result-1', chart_id: 'chart-1' },
    { action: 'render_chart', result_id: 'result-1', type: 'stacked-bar' },
    { action: 'finish', result_id: 'result-1', chart_id: 'chart-2' },
  ]) })
  assert.equal(result.chart.type, 'stacked-bar')
  assert.equal(steps.filter((step) => step.status === 'error').length, 2)
})

test('数字字符串 limit 正规化；去年缺筛选和陈旧图表不能结束成功', async () => {
  assert.equal(normalizePlan({ ...matrixPlan, limit: '3' }).limit, 3)
  assert.throws(() => normalizePlan({ ...matrixPlan, operation: 'sum' }), /sum 不能指定分组/)
  const plan = { ...matrixPlan, operation: 'sum', group_by: null }
  const result = await runAgentLoop({ ...dataset, question: '去年总营收是多少', currentDate: new Date('2026-10-29T04:00:00Z'), saveChart: mockChart, callModel: scriptedModel([
    { action: 'query_data', plan },
    { action: 'finish', result_id: 'result-1' },
    { action: 'query_data', plan: { ...plan, filters: [{ field: '订单日期', operator: 'year', value: 2025 }] } },
    { action: 'finish', result_id: 'result-2' },
  ]) })
  assert.equal(result.answer, '￥57,100')
  await assert.rejects(runAgentLoop({ ...fixture, question: '画图', maxTurns: 4, saveChart: mockChart, callModel: scriptedModel([
    { action: 'query_data', plan: matrixPlan },
    { action: 'render_chart', result_id: 'result-1', type: 'stacked-bar' },
    { action: 'query_data', plan: matrixPlan },
    { action: 'finish', result_id: 'result-2', chart_id: 'chart-1' },
  ]) }), /不一致/)
})

test('循环有上限，真实模型连接失败不会冒充工具成功', async () => {
  await assert.rejects(runAgentLoop({ ...dataset, question: '分析', maxTurns: 2, saveChart: mockChart, callModel: scriptedModel([{ action: 'inspect_data' }, { action: 'inspect_data' }]) }), /2 轮/)
  await assert.rejects(runAgentLoop({ ...dataset, question: '分析', saveChart: mockChart, callModel: async () => { throw new Error('服务不可用') } }), /服务不可用/)
})

test('429 按服务端提示重试，不重复执行查询工具', async () => {
  const actions = scriptedModel([{ action: 'query_data', plan: { ...matrixPlan, group_by: '地区' } }, { action: 'finish', result_id: 'result-1' }])
  let calls = 0
  const steps = []
  const result = await runAgentLoop({ ...dataset, question: '按地区汇总营收', agentSteps: steps, saveChart: mockChart, callModel: async (...args) => {
    calls += 1
    if (calls === 1) throw Object.assign(new Error('HTTP 429 限流'), { retryAfterMs: 1 })
    return actions(...args)
  } })
  assert.equal(calls, 3)
  assert.equal(steps.filter((step) => step.tool === 'query_data').length, 1)
  assert.equal(steps[0].title, '万擎限流，等待重试')
  assert.ok(result.answer.includes('26,200'))
})
