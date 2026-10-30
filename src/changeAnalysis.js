import { applyFilters, parseDate, resolveColumn, formatValue } from './datasetEngine.js'

const day = (value) => {
  const parsed = parseDate(value)
  if (!parsed) throw new Error(`无效比较日期：${value}`)
  return parsed.slice(0, 10)
}
const dayIndex = (value) => Date.parse(`${value}T00:00:00Z`) / 86400000
const dateAt = (value) => new Date(value * 86400000).toISOString().slice(0, 10)
const sum = (rows, field) => rows.reduce((total, row) => total + (row[field] ?? 0), 0)
const period = (range) => {
  if (!Array.isArray(range) || range.length !== 2) throw new Error('比较窗口需要起止日期数组')
  const [start, end] = range.map(day)
  const days = dayIndex(end) - dayIndex(start) + 1
  if (days < 1 || days > 3660) throw new Error('比较窗口必须为1到3660天，起始日期不得晚于结束日期')
  return { start, end, days }
}

// 模型选择字段和窗口；本地执行全部计算，不接受任意代码或模型提供的数字。
export function analyzeChange(dataset, action) {
  const dateColumn = resolveColumn(dataset, action.date_column)
  const metric = resolveColumn(dataset, action.metric)
  const category = action.category_column ? resolveColumn(dataset, action.category_column) : null
  const column = (name) => dataset.columns.find((entry) => entry.name === name)
  if (column(dateColumn).type !== 'date' || column(dateColumn).invalidCount) throw new Error('变化分析需要有效日期列；请确认日期字段类型')
  if (column(metric).type !== 'number' || column(metric).invalidCount || column(metric).unit === 'percent') throw new Error('变化分析需要可求和的数值指标，不能累加比例或含异常的指标')
  if (category && column(category).type !== 'string') throw new Error('变化分析的分类字段需要文本类型，不能使用数值指标或日期')
  if (action.missing_as_zero != null && typeof action.missing_as_zero !== 'boolean') throw new Error('missing_as_zero必须为布尔值，只有明确确认缺行代表零才可设置true')
  const filtered = applyFilters(dataset.rows, action.filters ?? [], dataset)
  const dated = filtered.filter((row) => row[dateColumn] != null)
  if (!dated.length) throw new Error('筛选范围内没有有效日期记录')
  const dates = dated.map((row) => day(row[dateColumn])).sort()
  const range = period(action.range ?? [dates[0], dates.at(-1)])
  const selected = dated.filter((row) => day(row[dateColumn]) >= range.start && day(row[dateColumn]) <= range.end)
  if (!selected.length) throw new Error('分析时段内没有记录')
  let baseline, current
  const mode = action.mode ?? 'window'
  if (!['window', 'endpoints'].includes(mode)) throw new Error('变化比较mode支持window或endpoints')
  const automatic = action.baseline == null && action.current == null
  if (mode === 'endpoints') {
    if (!automatic) throw new Error('endpoints使用时段首末观测日，不同时指定baseline/current')
    const observed = [...new Set(selected.map((row) => day(row[dateColumn])))].sort()
    if (observed.length < 2) throw new Error('首末观测比较至少需要两个日期')
    baseline = period([observed[0], observed[0]])
    current = period([observed.at(-1), observed.at(-1)])
  } else if (automatic) {
    if (range.days < 2) throw new Error('至少需要两个日期才能分析变化；请提供比较时段')
    const half = Math.floor(range.days / 2)
    baseline = period([range.start, dateAt(dayIndex(range.start) + half - 1)])
    current = period([dateAt(dayIndex(range.end) - half + 1), range.end])
  } else {
    if (!action.baseline || !action.current) throw new Error('需要同时指定baseline和current比较窗口')
    baseline = period(action.baseline); current = period(action.current)
    if (baseline.end >= current.start) throw new Error('基期必须早于后期，两个比较窗口不能重叠')
    if (baseline.start < range.start || current.end > range.end) throw new Error('比较窗口必须位于分析时段内；请扩大range')
  }
  const warnings = []
  if (mode === 'window' && automatic && range.days % 2) warnings.push('为保持前后窗口等长，中间1天仅计入全期消耗，不参与前后对比。')
  if (mode === 'endpoints') warnings.push('本次比较首末观测日的指标快照；不将中间未采样日判零，也不代表持续增长或整期增长。')
  if (filtered.length !== dated.length) warnings.push(`${filtered.length - dated.length}条日期空值记录未纳入趋势比较。`)
  const missingCategory = selected.filter((row) => category && row[category] == null).length
  if (missingCategory) warnings.push(`${missingCategory}条分类空值记录独立列为「未填写分类」，未丢弃。`)
  const label = (row) => category ? row[category] ?? '（未填写分类）' : '整体'
  const labels = [...new Set(selected.map(label))].sort()
  const within = (row, window) => { const date = day(row[dateColumn]); return date >= window.start && date <= window.end }
  const windowStats = (rows, window) => {
    const records = rows.filter((row) => within(row, window))
    const valid = records.filter((row) => row[metric] != null)
    const validDays = new Set(valid.map((row) => day(row[dateColumn]))).size
    const nulls = records.length - valid.length
    const complete = nulls === 0 && (validDays === window.days || action.missing_as_zero === true)
    const total = valid.length ? sum(valid, metric) : action.missing_as_zero && !nulls ? 0 : null
    return { total, daily: total == null ? null : total / window.days, validDays, nulls, complete }
  }
  const groups = labels.map((name) => {
    const rows = selected.filter((row) => label(row) === name)
    const before = windowStats(rows, baseline), after = windowStats(rows, current)
    const comparable = before.complete && after.complete
    const delta = comparable ? after.daily - before.daily : null
    const growth = comparable && before.daily > 0 ? delta / before.daily : null
    const total = rows.some((row) => row[metric] != null) ? sum(rows, metric) : null
    return { label: name, total, before, after, comparable, delta, growth, status: !comparable ? '缺数待核验' : before.daily === 0 ? after.daily > 0 ? '零基期新增，涨幅不适用' : '两期均零，涨幅不适用' : before.daily < 0 ? '负基期，涨幅不适用' : delta > 0 ? '增长' : delta < 0 ? '下降' : '持平' }
  })
  const comparable = groups.filter((group) => group.comparable)
  const positive = sum(comparable.filter((group) => group.delta > 0), 'delta')
  const negative = -sum(comparable.filter((group) => group.delta < 0), 'delta')
  const beforeTotal = sum(comparable.map((group) => ({ value: group.before.daily })), 'value')
  const afterTotal = sum(comparable.map((group) => ({ value: group.after.daily })), 'value')
  const delta = afterTotal - beforeTotal
  const growth = beforeTotal > 0 ? delta / beforeTotal : null
  groups.forEach((group) => {
    group.positiveShare = group.delta > 0 && positive > 0 ? group.delta / positive : null
    group.negativeShare = group.delta < 0 && negative > 0 ? -group.delta / negative : null
  })
  const unit = column(metric).unit
  const f = (value) => formatValue(value, unit)
  const pct = (value) => formatValue(value, 'percent')
  const topGrowth = comparable.filter((group) => group.growth > 0).sort((a, b) => b.growth - a.growth).slice(0, 3)
  const drivers = comparable.filter((group) => group.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 3)
  const drags = comparable.filter((group) => group.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 3)
  const pending = groups.filter((group) => !group.comparable)
  if (pending.length) warnings.push(`${pending.length}/${groups.length}个分类的日期覆盖或指标空值不完整，未纳入涨幅、贡献和拖累排名；不能把缺行当零。`)
  const lines = [
    `分析口径：${metric}按${category || '整体'}分析；全期${range.start}至${range.end}。${mode === 'endpoints' ? '比较首末观测日快照' : automatic ? '自动采用前后等长窗口' : '本次比较窗口'}：基期${baseline.start}至${baseline.end}（${baseline.days}天），后期${current.start}至${current.end}（${current.days}天）。比较日均，避免不同天数扭曲涨幅。`,
    comparable.length ? `整体变化（${comparable.length}/${groups.length}个可比分类）：日均从${f(beforeTotal)}变为${f(afterTotal)}，变化${f(delta)}，涨幅${pct(growth)}。正向日均增量${f(positive)}，下降抵消${f(negative)}。` : '整体变化：没有日期覆盖完整的可比分类，无法可靠计算涨幅或判断谁拖后腿。',
    `涨幅领先：${topGrowth.length ? topGrowth.map((group) => `${group.label} ${pct(group.growth)}（基期日均${f(group.before.daily)}，后期${f(group.after.daily)}）`).join('；') : '暂无可比正增长分类'}。`,
    `增量贡献：${drivers.length ? drivers.map((group) => `${group.label}日均增加${f(group.delta)}，占正向增量${pct(group.positiveShare)}`).join('；') : '暂无正向增量'}。涨幅排名与增量贡献排名分别计算，避免小基数高涨幅误判。`,
    `下滑拖累：${drags.length ? drags.map((group) => `${group.label}日均减少${f(-group.delta)}，涨幅${pct(group.growth)}，占下降总量${pct(group.negativeShare)}`).join('；') : '暂无可比下降分类，不强行指定拖后腿专项'}。`,
    ...groups.map((group) => `${group.label}：全期${f(group.total)}；基期${f(group.before.total)}，后期${f(group.after.total)}；日均${f(group.before.daily)}→${f(group.after.daily)}，涨幅${pct(group.growth)}；${group.status}。`),
    ...warnings.map((warning) => `数据提示：${warning}`),
    '以上为观测变化与贡献分解；未读取投放、客户或活动证据，不能据此断言业务原因。',
  ]
  const measures = [
    { alias: '全期消耗', unit }, { alias: '基期消耗', unit }, { alias: '后期消耗', unit },
    { alias: '基期日均', unit }, { alias: '后期日均', unit }, { alias: '日均变化', unit },
    { alias: '涨幅', unit: 'percent' }, { alias: '正向增量贡献', unit: 'percent' }, { alias: '下降拖累占比', unit: 'percent' },
  ]
  const table = groups.map((group) => ({ dimensions: [group.label], values: Object.fromEntries(measures.map((measure, i) => [measure.alias, [group.total, group.before.total, group.after.total, group.before.daily, group.after.daily, group.delta, group.growth, group.positiveShare, group.negativeShare][i]])) }))
  const trendRows = [...new Set(selected.map((row) => day(row[dateColumn])))].sort().map((date) => {
    const records = selected.filter((row) => day(row[dateColumn]) === date)
    return { label: date, value: records.some((row) => row[metric] != null) ? sum(records, metric) : null }
  })
  return {
    rows: groups.map((group) => ({ label: group.label, value: group.total })), table, measures, dimensions: [{ column: category || '整体' }],
    value: sum(groups, 'total'), metric, unit, operation: 'compare', answer: lines.join('\n\n'),
    evidence: `${selected.length}条时段内记录；时间列${dateColumn}；比较日均而非记录均值；贡献分母为正向增量总和，拖累分母为下降绝对量总和；${warnings.join('；') || '比较窗口日期覆盖完整'}。缺行视零=${action.missing_as_zero === true ? '用户确认' : '未确认'}。`,
    query: { ...action, operation: 'compare', filters: action.filters ?? [], range: [range.start, range.end], baseline: [baseline.start, baseline.end], current: [current.start, current.end] },
    comparison: { range, baseline, current, automatic, mode, comparableCount: comparable.length, groups, growth, delta, positive, negative, topGrowth, drivers, drags, warnings },
    views: {
      trend: { rows: trendRows, metric: `每日${metric}`, unit },
      delta: { rows: comparable.map((group) => ({ label: group.label, value: group.delta })).sort((a, b) => b.value - a.value), metric: `${metric}日均变化`, unit },
      growth: { rows: comparable.filter((group) => group.growth != null).map((group) => ({ label: group.label, value: group.growth })).sort((a, b) => b.value - a.value), metric: '涨幅', unit: 'percent' },
    },
  }
}
