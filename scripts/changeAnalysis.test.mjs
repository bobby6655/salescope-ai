import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { parseCsv, prepareDataset, parseDate } from '../src/datasetEngine.js'
import { analyzeChange } from '../src/changeAnalysis.js'
import { runAgentLoop } from '../server/agentLoop.js'
import { renderChartSvg } from '../src/chartGenerator.js'

const source = parseCsv(await readFile(new URL('../data/specialty-data.csv', import.meta.url), 'utf8'))
const action = { action: 'analyze_change', date_column: '日期', category_column: '专项', metric: '消耗' }
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`)
const mock = (actions) => { let index = 0; return async () => JSON.stringify(actions[index++]) }

test('compact dates become valid dates while eight-digit monetary values and identifiers stay numeric/text', () => {
  assert.equal(source.columns[0].type, 'date')
  assert.equal(parseDate('20260230'), null)
  assert.equal(parseDate('20261001'), '2026-10-01')
  const data = parseCsv('日期,金额,客户id\n20261001,20261001,20261001\n20261002,20261002,20261002')
  assert.deepEqual(data.columns.map(column => column.type), ['date', 'number', 'string'])
})

test('open change analysis separates growth leaders, absolute contributors and negative drags', () => {
  const result = analyzeChange(source, action)
  assert.equal(result.comparison.topGrowth[0].label, '专项B')
  assert.equal(result.comparison.drivers[0].label, '专项A')
  assert.equal(result.comparison.drags[0].label, '专项C')
  close(result.comparison.delta, 20)
  close(result.comparison.growth, 20 / 210)
  close(result.comparison.positive, 50)
  close(result.comparison.negative, 30)
  close(result.comparison.groups.find(group => group.label === '专项B').growth, 2)
  close(result.comparison.drivers[0].positiveShare, .6)
  assert.equal(result.comparison.comparableCount, 4)
  assert.equal(result.value, 1760)
  assert.ok(result.answer.includes('自动采用前后等长窗口'))
})

test('unequal periods compare daily averages instead of totals or record averages', () => {
  const result = analyzeChange(source, { ...action, baseline: ['2026-10-01', '2026-10-02'], current: ['2026-10-05', '2026-10-08'] })
  const a = result.comparison.groups.find(group => group.label === '专项A')
  assert.equal(a.before.total, 200)
  assert.equal(a.after.total, 520)
  close(a.growth, .3)
  const extra = prepareDataset([...source.rawRows, { 日期: '20261001', 专项: '专项A', 消耗: 50 }], source.headers)
  close(analyzeChange(extra, action).comparison.groups[0].before.daily, 112.5)
})

test('missing days and null metrics remain pending; explicit zero confirmation applies only to missing rows', () => {
  const missing = prepareDataset(source.rawRows.filter(row => !(row.日期 === '20261008' && row.专项 === '专项C')), source.headers)
  const pending = analyzeChange(missing, action).comparison.groups.find(group => group.label === '专项C')
  assert.equal(pending.delta, null)
  assert.equal(pending.status, '缺数待核验')
  assert.equal(analyzeChange(missing, { ...action, missing_as_zero: true }).comparison.comparableCount, 4)
  const nullData = prepareDataset(source.rawRows.map(row => row.日期 === '20261008' && row.专项 === '专项C' ? { ...row, 消耗: '' } : row), source.headers)
  assert.equal(analyzeChange(nullData, { ...action, missing_as_zero: true }).comparison.groups.find(group => group.label === '专项C').growth, null)
})

test('zero/negative baselines do not invent infinite growth and no decline does not invent a laggard', () => {
  const data = prepareDataset(source.rawRows.map(row => ({ ...row, 消耗: row.日期 < '20261005' ? 0 : 10 })), source.headers)
  const result = analyzeChange(data, action)
  assert.ok(result.comparison.groups.every(group => group.growth === null))
  assert.equal(result.comparison.drags.length, 0)
  assert.ok(result.answer.includes('不强行指定'))
  const negative = prepareDataset(source.rawRows.map(row => ({ ...row, 消耗: -10 })), source.headers)
  assert.equal(analyzeChange(negative, action).comparison.growth, null)
})

test('sparse snapshots can compare explicit first/last observations without inventing missing daily zeros', () => {
  const sparse = parseCsv('日期,专项,消耗\n2026-01-01,A,100\n2026-02-01,A,110\n2026-03-01,A,150')
  assert.equal(analyzeChange(sparse, action).comparison.comparableCount, 0)
  const result = analyzeChange(sparse, { ...action, mode: 'endpoints' })
  close(result.comparison.groups[0].growth, .5)
  assert.equal(result.comparison.baseline.start, '2026-01-01')
  assert.equal(result.comparison.current.start, '2026-03-01')
  assert.ok(result.answer.includes('不代表持续增长'))
  assert.equal(result.views.trend.rows.length, 3)
})

test('filters, odd-day default windows and invalid ranges have explicit semantics', () => {
  const result = analyzeChange(source, { ...action, range: ['2026-10-01', '2026-10-07'], filters: [{ column: '专项', operator: 'equals', value: '专项A' }] })
  assert.equal(result.comparison.groups.length, 1)
  assert.equal(result.comparison.baseline.days, 3)
  assert.equal(result.comparison.current.start, '2026-10-05')
  assert.ok(result.comparison.warnings.some(warning => warning.includes('中间1天')))
  assert.throws(() => analyzeChange(source, { ...action, baseline: ['2026-10-01', '2026-10-05'], current: ['2026-10-05', '2026-10-08'] }), /重叠/)
  assert.throws(() => analyzeChange(source, { ...action, range: ['2026-10-01', '2026-10-01'] }), /两个日期/)
})

test('ReAct corrects a shallow summary, calculates changes, renders negative deltas and retains extra evidence', async () => {
  const plan = { group_by: [{ column: '专项' }], measures: [{ column: '消耗', aggregate: 'sum' }], filters: [], limit: null }
  const actions = [ { action: 'query_data', plan }, { action: 'finish', result_id: 'result-1' }, action, { action: 'render_chart', result_id: 'result-2', view: 'delta', type: 'bar' }, { action: 'finish', result_id: 'result-2', supporting_result_ids: ['result-1'], chart_id: 'chart-1' } ]
  const result = await runAgentLoop({ question: '分析各个专项的消耗变化，哪个涨得好、谁拖后腿，画柱状图', rows: source.rawRows, headers: source.headers, callModel: mock(actions), saveChart: async options => {
    assert.ok(options.rows.some(row => row.value < 0))
    assert.ok(!/NaN|Infinity/.test(renderChartSvg(options)))
    return { type: options.type, relativePath: 'charts/changes.svg' }
  } })
  assert.equal(result.operation, 'compare')
  assert.equal(result.supportingResults.length, 1)
  assert.ok(result.answer.includes('专项C日均减少30'))
  assert.ok(result.answer.includes('图片已保存到'))
})

test('ambiguous cash/cost fields must be clarified and unknown result references cannot finish', async () => {
  const data = prepareDataset(source.rawRows.map(row => ({ ...row, cost_6: row.消耗, cost_4: Number(row.消耗) * .8 })), [...source.headers, 'cost_6', 'cost_4'])
  const actions = [{ ...action, metric: 'cost_6' }, { action: 'clarify', message: '消耗是cost_6还是cost_4？' }]
  const result = await runAgentLoop({ question: '各专项消耗变化如何？', rows: data.rawRows, headers: data.headers, callModel: mock(actions), saveChart: async () => {} })
  assert.equal(result.status, 'clarify')
  assert.ok(result.answer.includes('cost_6'))
  await assert.rejects(runAgentLoop({ question: '各专项变化', rows: source.rawRows, headers: source.headers, callModel: mock([action, { action: 'finish', result_id: 'result-1', supporting_result_ids: ['unknown'] }]), maxTurns: 2, saveChart: async () => {} }), /补充result_id不存在/)
})
