const ROLE_ALIASES = {
  revenue: ['销售额', '营收', '收入', '实收金额', '订单金额', 'revenue', 'sales', 'net_amount', 'gross_amount'],
  cost: ['成本', '消耗', '花费', 'spend', 'cost', 'cost_amount', 'cost_6', 'cost_4', 'cost_6_amount', 'cost_4_amount'],
  quantity: ['数量', '销量', 'quantity', 'units'],
  discount: ['折扣', 'discount'],
  date: ['订单日期', '日期', '时间', 'date', 'order_date', 'created_at'],
  region: ['地区', '区域', '城市', 'region', 'city'],
  product: ['产品', '商品', 'product', 'product_name'],
  category: ['产品类别', '类别', 'category'],
  customerType: ['客户类型', 'customer_type'],
}
const AGGREGATES = ['sum', 'avg', 'count', 'count_distinct', 'min', 'max']
const normalizedName = (value) => String(value).toLowerCase().replace(/[\s_-]/g, '')
const missing = (value) => value == null || value === ''

export function parseNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const text = String(value ?? '').trim()
  if (!text) return null
  const withoutCurrency = text.replace(/^[￥¥$€]\s*/, '')
  if (withoutCurrency.includes(',') && !/^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?%?$/.test(withoutCurrency)) return null
  const cleaned = text.replace(/^[￥¥$€]\s*/, '').replace(/,/g, '')
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?%?$/i.test(cleaned)) return null
  const number = Number(cleaned.replace(/%$/, '')) / (cleaned.endsWith('%') ? 100 : 1)
  return Number.isFinite(number) ? number : null
}

export function parseDate(value) {
  let text = value instanceof Date ? value.toISOString() : String(value ?? '').trim()
  if (/^\d{8}$/.test(text)) text = `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6)}`
  const match = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(.*)$/)
  if (!match || (match[4] && !/^[T ]\d{2}:\d{2}/.test(match[4]))) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return null
  const prefix = `${match[1]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  if (match[4] && Number.isNaN(new Date(`${prefix}${match[4].replace(/^ /, 'T')}`).valueOf())) return null
  return prefix + match[4].replace(/^ /, 'T')
}

function readRecords(text) {
  const source = String(text ?? '').replace(/^\uFEFF/, '')
  const records = []
  let cells = []
  let cell = ''
  let quoted = false
  let closed = false
  let cellQuoted = false
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') { cell += '"'; index += 1 }
      else if (character === '"') { quoted = false; closed = true }
      else cell += character
    } else if (character === '"') {
      if (cell.trim() || closed) throw new Error('CSV 引号位置不合法')
      cell = ''
      quoted = true
      cellQuoted = true
    } else if (character === ',' || character === '\n' || character === '\r') {
      cells.push(cellQuoted ? cell : cell.trim())
      cell = ''
      closed = false
      cellQuoted = false
      if (character !== ',') {
        if (cells.some((value) => value !== '')) records.push(cells)
        cells = []
        if (character === '\r' && source[index + 1] === '\n') index += 1
      }
    } else {
      if (closed && character.trim()) throw new Error('CSV 闭合引号后只能有分隔符')
      if (!closed) cell += character
    }
  }
  if (quoted) throw new Error('CSV 存在未闭合引号')
  cells.push(cellQuoted ? cell : cell.trim())
  if (cells.some((value) => value !== '')) records.push(cells)
  return records
}

export function prepareDataset(inputRows, headers = Object.keys(inputRows[0] ?? {}), options = {}) {
  if (!inputRows.length || !headers.length) throw new Error('数据表至少需要一行表头和一行数据')
  if (headers.some((name) => typeof name !== 'string' || !name.trim()) || new Set(headers).size !== headers.length) throw new Error('表头不能重复或为空')
  for (const name of Object.keys(options.types ?? {})) if (!headers.includes(name)) throw new Error(`类型设置的列不存在：${name}`)
  const columns = headers.map((name) => {
    const values = inputRows.map((row) => row[name]).filter((value) => !missing(value))
    const identifiers = /(?:编号|编码|邮编|电话|手机|(^|[_\s])id$|_code$|[\u4e00-\u9fff]id$)/i.test(name) || /[a-z](?:Id|ID)$/.test(name) || values.some((value) => typeof value === 'string' && (/^0\d+$/.test(value) || (/^\d+$/.test(value) && !Number.isSafeInteger(Number(value)))))
    const numberCount = values.filter((value) => parseNumber(value) !== null).length
    const dateNamed = /日期|时间|年月日|date|time|(^|[._])p_date$/i.test(name)
    const dateCount = values.filter((value) => parseDate(value) !== null && (dateNamed || !/^\d{8}$/.test(String(value)))).length
    const inferred = identifiers ? 'string' : values.length && dateCount / values.length >= 0.8 ? 'date' : values.length && numberCount / values.length >= 0.8 ? 'number' : 'string'
    const type = options.types?.[name] ?? inferred
    if (!['number', 'date', 'string'].includes(type)) throw new Error(`不支持的字段类型：${type}`)
    const invalidCount = type === 'number' ? values.length - numberCount : type === 'date' ? values.length - dateCount : 0
    const numbers = type === 'number' ? values.map(parseNumber).filter((value) => value !== null) : []
    const unit = values.some((value) => String(value).endsWith('%')) || ROLE_ALIASES.discount.some((alias) => normalizedName(alias) === normalizedName(name)) ? 'percent' : values.some((value) => /^[￥¥]/.test(String(value))) || ['销售额', '实收金额', '订单金额', '营收', '成本', '收入'].includes(name) ? 'CNY' : values.some((value) => /^\$/.test(String(value))) ? 'USD' : 'number'
    return { name, type, unit, nullCount: inputRows.length - values.length, invalidCount, distinctCount: new Set(values.map(String)).size, samples: [...new Set(values.map(String))].slice(0, 5), min: numbers.length ? numbers.reduce((current, value) => Math.min(current, value), Infinity) : null, max: numbers.length ? numbers.reduce((current, value) => Math.max(current, value), -Infinity) : null }
  })
  const rows = inputRows.map((row) => Object.fromEntries(columns.map((column) => {
    const value = row[column.name]
    return [column.name, missing(value) ? null : column.type === 'number' ? parseNumber(value) ?? value : column.type === 'date' ? parseDate(value) ?? value : String(value)]
  })))
  const roles = Object.fromEntries(Object.entries(ROLE_ALIASES).map(([role, aliases]) => {
    const expectedType = role === 'date' ? 'date' : ['revenue', 'cost', 'quantity', 'discount'].includes(role) ? 'number' : 'string'
    let candidates = columns.filter((column) => column.type === expectedType && aliases.some((alias) => normalizedName(alias) === normalizedName(column.name))).map((column) => column.name)
    if (role === 'date' && !candidates.length) candidates = columns.filter((column) => column.type === 'date').map((column) => column.name)
    if (Object.hasOwn(options.bindings ?? {}, role)) {
      const bound = options.bindings[role]
      if (bound && !headers.includes(bound)) throw new Error(`映射列不存在：${bound}`)
      candidates = bound ? [bound] : []
    }
    return [role, { candidates, column: candidates.length === 1 ? candidates[0] : null, ambiguous: candidates.length > 1 }]
  }))
  const dateColumns = columns.filter((column) => column.type === 'date')
  const years = [...new Set(rows.flatMap((row) => dateColumns.map((column) => parseDate(row[column.name])?.slice(0, 4)).filter(Boolean)))].sort()
  const duplicateCount = rows.length - new Set(rows.map((row) => JSON.stringify(headers.map((name) => row[name])))).size
  return { headers, rows, rawRows: inputRows, columns, roles, years, duplicateCount, warnings: columns.filter((column) => column.nullCount || column.invalidCount).map((column) => `${column.name}：${column.nullCount} 个空值，${column.invalidCount} 个类型异常`), bindings: options.bindings ?? {}, types: options.types ?? {} }
}

export function parseCsv(text, options = {}) {
  const records = readRecords(text)
  if (records.length < 2) throw new Error('数据表至少需要一行表头和一行数据')
  const headers = records.shift().map((name) => name.trim())
  const rows = records.map((cells, index) => {
    if (cells.length !== headers.length) throw new Error(`第 ${index + 2} 条记录列数不正确`)
    return Object.fromEntries(headers.map((name, columnIndex) => [name, cells[columnIndex]]))
  })
  return prepareDataset(rows, headers, options)
}

export function resolveColumn(dataset, name, role = null) {
  if (dataset.headers.includes(name)) return name
  const semanticRole = role ?? Object.keys(ROLE_ALIASES).find((key) => ROLE_ALIASES[key].some((alias) => normalizedName(alias) === normalizedName(name)))
  const mapping = dataset.roles[semanticRole]
  if (mapping?.ambiguous) throw new Error(`字段含义不明确：「${name}」可能对应 ${mapping.candidates.join('、')}，请确认指标口径或直接指定真实列名`)
  if (mapping?.column) return mapping.column
  throw new Error(`列不存在或尚未映射：${name}`)
}

function numericValue(row, column) {
  const value = row[column]
  if (missing(value)) return null
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`「${column}」包含非数值，不能直接聚合，请修复数据或确认字段类型`)
  return value
}

function aggregate(rows, measure, dataset, depth = 0) {
  if (depth > 8) throw new Error('指标公式过于复杂')
  if (measure.expression) {
    const expression = measure.expression
    if (!['add', 'subtract', 'multiply', 'divide'].includes(expression.operator)) throw new Error('公式只允许 add/subtract/multiply/divide')
    const left = aggregate(rows, expression.left, dataset, depth + 1)
    const right = aggregate(rows, expression.right, dataset, depth + 1)
    if (left == null || right == null) return null
    if (expression.operator === 'divide' && right === 0) throw new Error('指标公式分母为零')
    const value = expression.operator === 'add' ? left + right : expression.operator === 'subtract' ? left - right : expression.operator === 'multiply' ? left * right : left / right
    if (!Number.isFinite(value)) throw new Error('指标公式产生无效数值')
    return value
  }
  if (!AGGREGATES.includes(measure?.aggregate)) throw new Error('不支持的聚合方式')
  if (measure.aggregate === 'count' && !measure.column) return rows.length
  const column = resolveColumn(dataset, measure.column)
  if (measure.aggregate === 'count') return rows.filter((row) => !missing(row[column])).length
  if (measure.aggregate === 'count_distinct') return new Set(rows.map((row) => row[column]).filter((value) => !missing(value))).size
  if (dataset.columns.find((item) => item.name === column).type !== 'number') throw new Error(`「${column}」不是数值列，求和/平均/极值只能使用数值列`)
  const values = rows.map((row) => numericValue(row, column)).filter((value) => value !== null)
  if (!values.length) return null
  if (measure.aggregate === 'sum') return values.reduce((total, value) => total + value, 0)
  if (measure.aggregate === 'avg') return values.reduce((total, value) => total + value, 0) / values.length
  return measure.aggregate === 'min' ? values.reduce((current, value) => Math.min(current, value), Infinity) : values.reduce((current, value) => Math.max(current, value), -Infinity)
}

function dimensionValue(row, dimension, dataset) {
  const column = resolveColumn(dataset, typeof dimension === 'string' ? dimension : dimension.column)
  const grain = typeof dimension === 'string' ? null : dimension.time_grain
  if (missing(row[column])) return '（空值）'
  if (!grain) return String(row[column])
  if (!['day', 'month', 'year'].includes(grain)) throw new Error('时间粒度只支持 day/month/year')
  const date = parseDate(row[column])
  if (!date || dataset.columns.find((item) => item.name === column).type !== 'date') throw new Error(`「${column}」不是有效日期列`)
  return date.slice(0, grain === 'year' ? 4 : grain === 'month' ? 7 : 10)
}

export function applyFilters(rows, filters, dataset) {
  if (!Array.isArray(filters)) throw new Error('filters 必须是数组')
  return filters.reduce((selected, filter) => {
    const column = resolveColumn(dataset, filter.column ?? filter.field)
    const type = dataset.columns.find((item) => item.name === column).type
    const value = filter.value
    const compareValue = (input) => {
      if (type === 'number') { const parsed = parseNumber(input); if (parsed === null) throw new Error(`「${column}」筛选值不是数字`); return parsed }
      if (type === 'date') { const parsed = parseDate(input); if (!parsed) throw new Error(`「${column}」筛选值不是日期`); return parsed.slice(0, 10) }
      return String(input)
    }
    const operators = ['equals', 'not_equals', 'in', 'gt', 'gte', 'lt', 'lte', 'between', 'year', 'is_null', 'contains']
    if (!operators.includes(filter.operator)) throw new Error(`不支持的筛选方式：${filter.operator}`)
    if (filter.operator === 'year' && type !== 'date') throw new Error('year 筛选只能用于日期列')
    if (['in', 'between'].includes(filter.operator) && !Array.isArray(value)) throw new Error('in/between 的 value 必须是数组')
    if (filter.operator === 'between' && value.length !== 2) throw new Error('between 需要两个边界值')
    return selected.filter((row) => {
      const raw = row[column]
      if (filter.operator === 'is_null') return missing(raw)
      if (missing(raw)) return false
      if (filter.operator === 'year') return Number(parseDate(raw)?.slice(0, 4)) === Number(value)
      const actual = compareValue(raw)
      if (filter.operator === 'contains') return String(raw).includes(String(value))
      if (filter.operator === 'in') return value.map(compareValue).includes(actual)
      if (filter.operator === 'between') return actual >= compareValue(value[0]) && actual <= compareValue(value[1])
      const expected = compareValue(value)
      return filter.operator === 'equals' ? actual === expected : filter.operator === 'not_equals' ? actual !== expected : filter.operator === 'gt' ? actual > expected : filter.operator === 'gte' ? actual >= expected : filter.operator === 'lt' ? actual < expected : actual <= expected
    })
  }, rows)
}

export function formatValue(value, unit = 'number') {
  if (value == null) return '—'
  if (!Number.isFinite(value)) throw new Error('结果不是有效数值')
  const formatted = (unit === 'percent' ? value * 100 : value).toLocaleString('zh-CN', { maximumFractionDigits: 2 })
  return unit === 'percent' ? `${formatted}%` : unit === 'CNY' ? `￥${formatted}` : unit === 'USD' ? `$${formatted}` : formatted
}

function legacyQuery(dataset, plan) {
  if (!['sum', 'group', 'average', 'share'].includes(plan.operation)) throw new Error('查询计划缺少有效操作')
  const metric = plan.metric ?? '销售额'
  const profit = metric === '利润'
  const column = profit ? null : resolveColumn(dataset, metric)
  const measure = profit ? { alias: '利润', unit: dataset.columns.find((item) => item.name === resolveColumn(dataset, '收入')).unit, expression: { operator: 'subtract', left: { column: resolveColumn(dataset, '收入'), aggregate: 'sum' }, right: { column: resolveColumn(dataset, '成本'), aggregate: 'sum' } } } : { column, aggregate: plan.operation === 'average' ? 'avg' : 'sum', alias: metric }
  const dimensions = plan.group_by == null ? [] : Array.isArray(plan.group_by) ? plan.group_by : [plan.group_by]
  return { group_by: dimensions.map((name) => { const resolved = resolveColumn(dataset, name); return { column: resolved, ...(dataset.columns.find((item) => item.name === resolved).type === 'date' ? { time_grain: 'month' } : {}) } }), measures: [measure], filters: plan.filters ?? [], order: plan.order ? { direction: plan.order, measure: metric } : null, limit: plan.limit ?? null, share: plan.operation === 'share' }
}

export function executeQuery(dataset, inputPlan) {
  const legacy = !inputPlan.measures
  const plan = legacy ? legacyQuery(dataset, inputPlan) : inputPlan
  const dimensions = plan.group_by ?? []
  if (!Array.isArray(dimensions) || dimensions.length > 2) throw new Error('group_by 必须是最多两个维度的数组')
  const dimensionNames = dimensions.map((dimension) => resolveColumn(dataset, typeof dimension === 'string' ? dimension : dimension.column))
  if (new Set(dimensionNames).size !== dimensionNames.length) throw new Error('分组维度不能重复')
  if (!Array.isArray(plan.measures) || !plan.measures.length || plan.measures.length > 8) throw new Error('需要 1 到 8 个指标')
  const measures = plan.measures.map((measure, index) => {
    const column = measure.column ? resolveColumn(dataset, measure.column) : null
    const unit = measure.unit ?? (['count', 'count_distinct'].includes(measure.aggregate) ? 'number' : dataset.columns.find((item) => item.name === column)?.unit ?? 'number')
    if (!['number', 'CNY', 'USD', 'percent'].includes(unit)) throw new Error('不支持的指标单位')
    return { ...measure, column, alias: String(measure.alias || column || `指标${index + 1}`), unit }
  })
  if (new Set(measures.map((measure) => measure.alias)).size !== measures.length) throw new Error('指标名称不能重复')
  const selected = applyFilters(dataset.rows, plan.filters ?? [], dataset)
  if (!selected.length) throw new Error('筛选后没有可计算的数据')
  const groups = new Map()
  selected.forEach((row) => {
    const labels = dimensions.map((dimension) => dimensionValue(row, dimension, dataset))
    const key = JSON.stringify(labels)
    const group = groups.get(key) ?? { labels, source: [] }
    group.source.push(row)
    groups.set(key, group)
  })
  let table = [...groups.values()].map((group) => ({ dimensions: group.labels, values: Object.fromEntries(measures.map((measure) => [measure.alias, aggregate(group.source, measure, dataset)])) }))
  const share = plan.share === true || plan.operation === 'share'
  if (share) {
    const denominators = new Map()
    table.forEach((record) => {
      const key = dimensions.length === 2 ? record.dimensions[0] : 'all'
      const sums = denominators.get(key) ?? Object.fromEntries(measures.map((measure) => [measure.alias, 0]))
      for (const measure of measures) {
        const value = record.values[measure.alias]
        if (value == null || value < 0) throw new Error('占比需要有效的非负数值')
        sums[measure.alias] += value
      }
      denominators.set(key, sums)
    })
    table = table.map((record) => ({ ...record, values: Object.fromEntries(measures.map((measure) => {
      const denominator = denominators.get(dimensions.length === 2 ? record.dimensions[0] : 'all')[measure.alias]
      if (denominator <= 0) throw new Error('占比的分母必须大于零')
      return [measure.alias, record.values[measure.alias] / denominator]
    })) }))
    measures.forEach((measure) => { measure.unit = 'percent' })
  }
  const order = plan.order
  const orderMetric = typeof order === 'object' && order ? order.measure ?? measures[0].alias : measures[0].alias
  const direction = typeof order === 'string' ? order : order?.direction
  if (order && !['asc', 'desc'].includes(direction)) throw new Error('排序方向需要 asc/desc')
  if (order && !measures.some((measure) => measure.alias === orderMetric)) throw new Error('排序指标不存在')
  table.sort((left, right) => direction ? (direction === 'asc' ? 1 : -1) * ((left.values[orderMetric] ?? -Infinity) - (right.values[orderMetric] ?? -Infinity)) : JSON.stringify(left.dimensions).localeCompare(JSON.stringify(right.dimensions)))
  const limit = plan.limit == null ? null : Number(plan.limit)
  if (limit !== null && (!Number.isInteger(limit) || limit <= 0)) throw new Error('limit 必须为正整数')
  if (dimensions.length !== 2 && limit) table = table.slice(0, limit)
  const first = measures[0]
  let rows
  if (dimensions.length === 2) {
    const seriesNames = [...new Set(table.map((record) => record.dimensions[1]))].sort()
    const matrix = new Map()
    table.forEach((record) => {
      const group = matrix.get(record.dimensions[0]) ?? new Map()
      group.set(record.dimensions[1], record.values[first.alias])
      matrix.set(record.dimensions[0], group)
    })
    rows = [...matrix.entries()].map(([label, values]) => ({ label, series: seriesNames.map((name) => ({ label: name, value: share ? (values.get(name) ?? 0) * 100 : values.has(name) ? values.get(name) : 0 })) }))
    rows.forEach((row) => { row.value = row.series.reduce((total, item) => total + (item.value ?? 0), 0) })
    if (direction) rows.sort((left, right) => (direction === 'asc' ? 1 : -1) * (left.value - right.value))
    if (limit) rows = rows.slice(0, limit)
    table = table.filter((record) => rows.some((row) => row.label === record.dimensions[0]))
  } else {
    rows = table.map((record) => ({ label: record.dimensions.join(' × ') || '合计', value: record.values[first.alias] }))
    if (legacy && dimensions[0]?.time_grain === 'month' && dataset.years.length === 1) rows.forEach((row) => { row.label = `${Number(row.label.slice(5, 7))}月` })
  }
  const answer = dimensions.length === 2 ? `已按${dimensionNames.join(' × ')}计算${first.alias}${share ? '占比' : ''}，共 ${rows.length} 组、${rows[0]?.series.length ?? 0} 个系列` : table.map((record, index) => `${record.dimensions.length ? `${index + 1}. ${rows[index].label}（` : ''}${measures.map((measure) => `${measures.length > 1 ? `${measure.alias}：` : ''}${formatValue(record.values[measure.alias], measure.unit)}`).join('，')}${record.dimensions.length ? '）' : ''}`).join('；')
  const nullCount = measures.filter((measure) => measure.column).reduce((total, measure) => total + selected.filter((row) => missing(row[measure.column])).length, 0)
  const evidence = `${selected.length}/${dataset.rows.length} 条记录；分组：${dimensionNames.join(' × ') || '全部记录'}；指标：${measures.map((measure) => `${measure.alias} (${measure.aggregate || '受控公式'})`).join('、')}${share ? '；占比分母为组内总额' : ''}${nullCount ? `；指标空值 ${nullCount} 个，聚合时排除` : ''}${dimensions.some((dimension) => dimension.time_grain) ? '；无记录时间段不推断为零' : ''}`
  return { rows, table, measures, dimensions, value: rows[0]?.value, metric: first.alias, unit: first.unit, operation: share ? 'share' : 'group', answer, evidence, query: { ...plan, measures } }
}

export function executePlan(rows, plan, options = {}) {
  return executeQuery(prepareDataset(rows, options.headers ?? Object.keys(rows[0] ?? {}), options), plan)
}
