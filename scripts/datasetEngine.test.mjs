import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { parseCsv, prepareDataset, executeQuery, resolveColumn, parseNumber } from '../src/datasetEngine.js'
import { runAgentLoop } from '../server/agentLoop.js'

const load = async (name) => parseCsv(await readFile(new URL(`../data/${name}`, import.meta.url), 'utf8'))
const sales = await load('sales-data.csv')
const orders = await load('orders-en.csv')
const ads = await load('ads-data.csv')
const sum = (column) => ({ group_by: [], measures: [{ column, aggregate: 'sum' }] })

test('三种不同表头使用相同执行器，金额结果正确', () => {
  assert.equal(executeQuery(sales, sum('销售额')).value, 57100)
  assert.equal(executeQuery(orders, sum('revenue')).value, 7200)
  assert.equal(executeQuery(ads, sum('消耗')).value, 10000)
  assert.equal(orders.rows[0].order_id, '001')
  assert.equal(ads.roles.revenue.column, null)
})

test('RFC CSV 支持 BOM、引号、逗号、嵌入换行及双引号', () => {
  const dataset = parseCsv('\uFEFF编号,描述,金额\r\n001,"一行,两项", "1,200.50"\r\n002,"多行\n描述 ""引号""",300\r\n')
  assert.equal(dataset.rows.length, 2)
  assert.equal(dataset.rows[0].金额, 1200.5)
  assert.equal(dataset.rows[1].描述, '多行\n描述 "引号"')
  assert.throws(() => parseCsv('a,a\n1,2'), /表头/)
  assert.throws(() => parseCsv('a,b\n1'), /列数/)
  assert.throws(() => parseCsv('a\n"未闭合'), /未闭合/)
  assert.equal(parseNumber('1,2'), null)
  assert.equal(parseCsv('text,value\n" keep spaces ",1').rows[0].text, ' keep spaces ')
  assert.equal(parseCsv('customerId,amount\n1234567890123456789,1').rows[0].customerId, '1234567890123456789')
})

test('空值不变成零，百分数识别，标识符不变成金额', () => {
  const dataset = parseCsv('id,amount,rate\n001,100,10%\n002,,20%\n003,300,30%')
  assert.equal(dataset.rows[1].amount, null)
  assert.equal(dataset.rows[0].rate, 0.1)
  assert.equal(dataset.columns.find((column) => column.name === 'rate').unit, 'percent')
  assert.equal(executeQuery(dataset, { measures: [{ column: 'amount', aggregate: 'avg' }] }).value, 200)
  assert.equal(executeQuery(dataset, { measures: [{ column: 'amount', aggregate: 'count' }] }).value, 2)
  assert.equal(executeQuery(dataset, { measures: [{ aggregate: 'count' }] }).value, 3)
  assert.throws(() => executeQuery(dataset, sum('id')), /数值列/)
})

test('数值列的类型异常会提示并阻止错误聚合，可确认类型', () => {
  const dataset = parseCsv('amount\n1\n2\n3\n4\nbad')
  assert.equal(dataset.columns[0].invalidCount, 1)
  assert.throws(() => executeQuery(dataset, sum('amount')), /包含非数值/)
  const textDataset = prepareDataset(dataset.rawRows, dataset.headers, { types: { amount: 'string' } })
  assert.equal(textDataset.columns[0].type, 'string')
  assert.throws(() => executeQuery(textDataset, sum('amount')), /不是数值列/)
})

test('含义歧义不会默认选择，支持确认映射', () => {
  const dataset = parseCsv('order_date,net_amount,gross_amount\n2025-01-01,80,100')
  assert.equal(dataset.roles.revenue.ambiguous, true)
  assert.throws(() => resolveColumn(dataset, '收入'), /含义不明确/)
  const confirmed = prepareDataset(dataset.rawRows, dataset.headers, { bindings: { revenue: 'net_amount' } })
  assert.equal(resolveColumn(confirmed, '收入'), 'net_amount')
  assert.equal(executeQuery(confirmed, sum('收入')).value, 80)
  assert.throws(() => prepareDataset(dataset.rows, dataset.headers, { bindings: { revenue: 'fake' } }), /映射列不存在/)
})

test('日期范围、数值范围、集合与年份筛选', () => {
  assert.equal(executeQuery(ads, { ...sum('消耗'), filters: [{ column: '投放日期', operator: 'between', value: ['2025-02-01', '2025-02-28'] }] }).value, 4000)
  assert.equal(executeQuery(orders, { ...sum('revenue'), filters: [{ column: 'city', operator: 'in', value: ['Shanghai', 'Shenzhen'] }] }).value, 4500)
  assert.equal(executeQuery(orders, { ...sum('revenue'), filters: [{ column: 'revenue', operator: 'gte', value: 1800 }] }).value, 4200)
  assert.equal(executeQuery(orders, { ...sum('revenue'), filters: [{ column: 'order_date', operator: 'year', value: 2025 }] }).value, 7200)
  assert.throws(() => executeQuery(orders, { ...sum('revenue'), filters: [{ column: 'revenue', operator: 'year', value: 2025 }] }), /日期列/)
})

test('动态分组、排名、多指标和去重计数', () => {
  const result = executeQuery(orders, { group_by: [{ column: 'city' }], measures: [{ column: 'revenue', aggregate: 'sum', alias: '收入' }, { column: 'order_id', aggregate: 'count_distinct', alias: '订单数' }], order: { measure: '收入', direction: 'desc' }, limit: 2 })
  assert.deepEqual(result.rows.map((row) => row.value), [3900, 2700])
  assert.equal(result.table[0].values.订单数, 3)
  const duplicates = parseCsv('id,value\n001,10\n001,20\n002,30')
  assert.equal(executeQuery(duplicates, { measures: [{ column: 'id', aggregate: 'count_distinct' }] }).value, 2)
})

test('min/max/avg 不依赖销售字段', () => {
  const result = executeQuery(ads, { measures: [{ column: '消耗', aggregate: 'min', alias: '最小' }, { column: '消耗', aggregate: 'max', alias: '最大' }, { column: '消耗', aggregate: 'avg', alias: '平均' }] })
  assert.equal(result.table[0].values.最小, 1000)
  assert.equal(result.table[0].values.最大, 2500)
  assert.ok(Math.abs(result.table[0].values.平均 - 10000 / 6) < 0.000001)
})

test('跨年分组和通用二维占比', () => {
  const crossYear = parseCsv('event_date,channel,amount\n2025-01-01,a,10\n2026-01-01,a,20')
  const grouped = executeQuery(crossYear, { ...sum('amount'), group_by: [{ column: 'event_date', time_grain: 'month' }] })
  assert.deepEqual(grouped.rows.map((row) => row.label), ['2025-01', '2026-01'])
  const result = executeQuery(ads, { ...sum('消耗'), group_by: [{ column: '投放日期', time_grain: 'month' }, { column: '渠道' }], share: true })
  assert.equal(result.rows.length, 3)
  for (const row of result.rows) assert.ok(Math.abs(row.series.reduce((total, item) => total + item.value, 0) - 100) < 0.000001)
  assert.throws(() => executeQuery(ads, { ...sum('消耗'), group_by: [{ column: '投放日期', time_grain: 'hour' }] }), /时间粒度/)
})

test('受控公式计算利润、客单价与加权转化率，并阻止除零/任意代码', () => {
  const result = executeQuery(orders, { measures: [{ alias: '利润', expression: { operator: 'subtract', left: { column: 'revenue', aggregate: 'sum' }, right: { column: 'cost', aggregate: 'sum' } } }, { alias: '客单价', expression: { operator: 'divide', left: { column: 'revenue', aggregate: 'sum' }, right: { column: 'order_id', aggregate: 'count_distinct' } } }] })
  assert.equal(result.table[0].values.利润, 3250)
  assert.equal(result.table[0].values.客单价, 1200)
  const conversion = executeQuery(ads, { measures: [{ alias: '转化率', unit: 'percent', expression: { operator: 'divide', left: { column: '转化数', aggregate: 'sum' }, right: { column: '点击数', aggregate: 'sum' } } }] })
  assert.ok(Math.abs(conversion.value - 404 / 7860) < 0.000001)
  assert.throws(() => executeQuery(ads, { measures: [{ expression: { operator: 'eval' } }] }), /公式只允许/)
  const zero = parseCsv('amount,denominator\n10,0')
  assert.throws(() => executeQuery(zero, { measures: [{ expression: { operator: 'divide', left: { column: 'amount', aggregate: 'sum' }, right: { column: 'denominator', aggregate: 'sum' } } }] }), /分母为零/)
})

test('未知列与非法查询不会执行', () => {
  assert.throws(() => executeQuery(orders, sum('not_a_column')), /列不存在/)
  assert.throws(() => executeQuery(orders, { ...sum('revenue'), group_by: [{ column: 'city' }, { column: 'city' }] }), /不能重复/)
  assert.throws(() => executeQuery(orders, { ...sum('revenue'), filters: [{ column: 'city', operator: 'sql', value: 'drop' }] }), /筛选方式/)
  assert.throws(() => executeQuery(orders, { ...sum('revenue'), limit: -1 }), /limit/)
})

test('Agent 使用通用计划分析广告表并获取字段解析反馈', async () => {
  const actions = [{ action: 'resolve_fields', concept: '渠道' }, { action: 'query_data', plan: { ...sum('点击数'), group_by: [{ column: '渠道' }] } }, { action: 'finish', result_id: 'result-1' }]
  let index = 0
  const result = await runAgentLoop({ ...ads, question: '按渠道汇总点击数', callModel: async (messages) => {
    if (index === 1) assert.ok(messages.at(-1).content.includes('candidates'))
    return JSON.stringify(actions[index++])
  }, saveChart: async () => { throw new Error('未要求图表') } })
  assert.equal(result.rows.find((row) => row.label === '搜索').value, 3210)
  assert.equal(result.rows.find((row) => row.label === '信息流').value, 4650)
})

test('Agent 不能在含义歧义时自行猜测收入字段', async () => {
  const dataset = parseCsv('net_amount,gross_amount\n80,100')
  const actions = [{ action: 'query_data', plan: sum('gross_amount') }, { action: 'clarify', message: '收入指 net_amount 还是 gross_amount？', suggestions: ['net_amount', 'gross_amount'] }]
  let index = 0
  const steps = []
  const result = await runAgentLoop({ ...dataset, question: '总收入是多少？', agentSteps: steps, callModel: async (messages) => {
    if (index === 1) assert.ok(messages.at(-1).content.includes('不能自行猜测'))
    return JSON.stringify(actions[index++])
  }, saveChart: async () => {} })
  assert.equal(result.status, 'clarify')
  assert.equal(steps.filter((step) => step.tool === 'query_data').length, 0)
})
