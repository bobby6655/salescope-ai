const REQUIRED_COLUMNS = ['订单日期', '地区', '产品', '产品类别', '客户类型', '销售额', '成本', '折扣', '数量']
const GROUP_FIELDS = ['地区', '产品', '产品类别', '客户类型']

export function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean)
  if (lines.length < 2) throw new Error('数据表至少需要一行表头和一行数据')
  const headers = lines[0].split(',').map((header) => header.trim())
  const missing = REQUIRED_COLUMNS.filter((column) => !headers.includes(column))
  if (missing.length) throw new Error(`缺少必要列：${missing.join('、')}`)

  const rows = lines.slice(1).map((line, index) => {
    const values = line.split(',').map((value) => value.trim())
    if (values.length !== headers.length) throw new Error(`第 ${index + 2} 行列数不正确`)
    const row = Object.fromEntries(headers.map((header, valueIndex) => [header, values[valueIndex]]))
    const date = new Date(row['订单日期'])
    const sales = Number(row['销售额'])
    const cost = Number(row['成本'])
    const discount = Number(row['折扣'])
    const quantity = Number(row['数量'])
    if (Number.isNaN(date.valueOf())) throw new Error(`第 ${index + 2} 行订单日期无法识别`)
    if (!Number.isFinite(sales) || sales < 0) throw new Error(`第 ${index + 2} 行销售额不是有效数字`)
    if (!Number.isFinite(cost) || cost < 0) throw new Error(`第 ${index + 2} 行成本不是有效数字`)
    if (!Number.isFinite(discount) || discount <= 0 || discount > 1) throw new Error(`第 ${index + 2} 行折扣需要在 0 到 1 之间`)
    if (!Number.isInteger(quantity) || quantity < 0) throw new Error(`第 ${index + 2} 行数量不是有效整数`)
    return {
      ...row,
      date,
      year: date.getFullYear(),
      monthKey: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`,
      monthLabel: `${date.getMonth() + 1}月`,
      sales,
      cost,
      discount,
      quantity,
    }
  })
  return { headers, rows }
}

function money(value) {
  return `￥${value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`
}

function percent(value) {
  return `${(value * 100).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}%`
}

function metricValue(row, metric) {
  if (metric === '销售额') return row.sales
  if (metric === '数量') return row.quantity
  if (metric === '折扣') return row.discount
  if (metric === '利润') return row.sales - row.cost
  throw new Error(`不支持的统计指标：${metric}`)
}

function groupRows(rows, groupBy, metric) {
  if (groupBy === '订单日期') {
    const groups = new Map()
    rows.forEach((row) => {
      groups.set(row.monthKey, (groups.get(row.monthKey) ?? 0) + metricValue(row, metric))
    })
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([monthKey, value]) => {
      const [year, month] = monthKey.split('-')
      return [`${Number(month)}月`, value]
    })
  }
  if (!GROUP_FIELDS.includes(groupBy)) throw new Error(`不支持的分组列：${groupBy}`)
  const groups = new Map()
  rows.forEach((row) => {
    const key = String(row[groupBy])
    groups.set(key, (groups.get(key) ?? 0) + metricValue(row, metric))
  })
  return [...groups.entries()]
}

function averageBy(rows, groupBy, metric) {
  if (!GROUP_FIELDS.includes(groupBy)) throw new Error(`不支持的分组列：${groupBy}`)
  const groups = new Map()
  rows.forEach((row) => {
    const key = String(row[groupBy])
    const current = groups.get(key) ?? { total: 0, count: 0 }
    current.total += metricValue(row, metric)
    current.count += 1
    groups.set(key, current)
  })
  return [...groups.entries()].map(([label, group]) => [label, group.total / group.count])
}

function formatMetric(value, metric) {
  if (metric === '销售额') return money(value)
  if (metric === '折扣') return percent(value)
  if (metric === '利润') return money(value)
  return value.toLocaleString('zh-CN')
}

function filterRows(rows, filters = []) {
  return filters.reduce((filtered, filter) => {
    if (!filter?.field) throw new Error('筛选条件缺少列名')
    if (filter.operator === 'year') return filtered.filter((row) => row.year === Number(filter.value))
    if (filter.operator === 'equals') {
      if (!(filter.field in (rows[0] ?? {}))) throw new Error(`筛选列不存在：${filter.field}`)
      return filtered.filter((row) => String(row[filter.field]) === String(filter.value))
    }
    throw new Error(`不支持的筛选方式：${filter.operator}`)
  }, rows)
}

export function executePlan(rows, plan) {
  if (!rows?.length) throw new Error('没有可分析的数据')
  if (!['sum', 'group', 'average', 'share'].includes(plan?.operation)) throw new Error('查询计划缺少有效操作')
  const metric = plan.metric || '销售额'
  const filtered = filterRows(rows, plan.filters)
  if (!filtered.length) throw new Error('筛选后没有可计算的数据')

  if (Array.isArray(plan.group_by) || plan.operation === 'share') {
    const dimensions = plan.group_by ?? ['订单日期', '地区']
    if (!Array.isArray(dimensions) || dimensions.length !== 2 || new Set(dimensions).size !== 2 || dimensions.some((field) => !['订单日期', ...GROUP_FIELDS].includes(field))) {
      throw new Error('交叉分析需要两个不同的有效分组列')
    }
    const monthMap = new Map()
    const regionSet = new Set()
    filtered.forEach((row) => {
      const key = dimensions[0] === '订单日期' ? row.monthKey : String(row[dimensions[0]])
      const month = monthMap.get(key) ?? { label: key, totals: new Map(), counts: new Map(), total: 0 }
      const region = dimensions[1] === '订单日期' ? row.monthKey : String(row[dimensions[1]])
      const value = metricValue(row, metric)
      if (!Number.isFinite(value)) throw new Error('分析数据包含无效数值')
      month.totals.set(region, (month.totals.get(region) ?? 0) + value)
      month.counts.set(region, (month.counts.get(region) ?? 0) + 1)
      month.total += metricValue(row, metric)
      monthMap.set(key, month)
      regionSet.add(region)
    })
    const regions = [...regionSet].sort()
    const resultRows = [...monthMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, month]) => ({
      label: month.label,
      value: month.total,
      series: regions.map((region) => {
        const total = month.totals.get(region) ?? 0
        if (plan.operation === 'share' && (month.total <= 0 || total < 0)) throw new Error('占比分母必须大于零，分子不能为负数')
        return { label: region, value: plan.operation === 'share' ? total / month.total * 100 : plan.operation === 'average' ? total / (month.counts.get(region) || 1) : total }
      }),
    }))
    const orderedRows = plan.order ? resultRows.sort((left, right) => plan.order === 'asc' ? left.value - right.value : right.value - left.value) : resultRows
    const selectedRows = plan.limit ? orderedRows.slice(0, plan.limit) : orderedRows
    return {
      value: selectedRows.length,
      rows: selectedRows,
      evidence: `${filtered.length} 条记录按${dimensions.join(' × ')}${plan.operation === 'share' ? '计算组内占比（每组分母为该组总额）' : plan.operation === 'average' ? '计算平均值' : '汇总'}${metric}，共 ${selectedRows.length} 组、${regions.length} 个系列；缺失组合按 0 展示${dimensions.includes('订单日期') ? '，无记录月份不推断为零收入' : ''}`,
      answer: `已按${dimensions.join(' × ')}计算${metric}${plan.operation === 'share' ? '占比' : plan.operation === 'average' ? '平均值' : ''}，共 ${selectedRows.length} 组、${regions.length} 个系列`,
    }
  }

  if (plan.operation === 'sum') {
    const value = filtered.reduce((sum, row) => sum + metricValue(row, metric), 0)
    return {
      value,
      rows: [{ label: '符合条件的记录', value }],
      evidence: `${filtered.length} 条记录的${metric}相加`,
      answer: formatMetric(value, metric),
    }
  }

  if (plan.operation === 'average') {
    if (!plan.group_by) throw new Error('平均值分析需要指定分组列')
    const sortedGroups = averageBy(filtered, plan.group_by, metric)
      .sort((a, b) => (plan.order === 'asc' ? a[1] - b[1] : b[1] - a[1]))
    const sorted = plan.limit ? sortedGroups.slice(0, plan.limit) : sortedGroups
    return {
      value: sorted[0][1],
      rows: sorted.map(([label, value]) => ({ label, value })),
      evidence: `${filtered.length} 条记录按${plan.group_by}求${metric}平均值`,
      answer: `${sorted[0][0]}，平均${metric} ${formatMetric(sorted[0][1], metric)}`,
    }
  }

  if (!plan.group_by) throw new Error('分组排名需要指定分组列')
  const groups = groupRows(filtered, plan.group_by, metric)
  const sortedGroups = plan.order
    ? groups.sort((a, b) => (plan.order === 'asc' ? a[1] - b[1] : b[1] - a[1]))
    : groups
  const sorted = plan.limit ? sortedGroups.slice(0, plan.limit) : sortedGroups
  return {
    value: sorted[0][1],
    rows: sorted.map(([label, value]) => ({ label, value })),
    evidence: `${filtered.length} 条记录按${plan.group_by === '订单日期' ? '月份' : plan.group_by}汇总${metric}`,
    answer: sorted.map(([label, value], index) => `${index + 1}. ${label}（${formatMetric(value, metric)}）`).join('；'),
  }
}

function guessPlan(question) {
  const normalized = question.trim()
  if (/(每个月|每月|按月).*(不同地区|各地区).*(占比|比例)|地区.*收入占比/.test(normalized)) {
    return { operation: 'share', metric: '销售额', filters: [], group_by: ['订单日期', '地区'], order: null, limit: null, chart: /堆[积叠]|stack/i.test(normalized) ? 'stacked-bar' : 'multi-line' }
  }
  if (/(每个月|每月|按月).*(不同地区|各地区)/.test(normalized)) {
    return { operation: 'group', metric: '销售额', filters: [], group_by: ['订单日期', '地区'], order: null, limit: null, chart: /堆[积叠]|stack/i.test(normalized) ? 'stacked-bar' : 'multi-line' }
  }
  if (/(每个月|每月|按月).*(趋势|营收|图)|月度.*营收.*趋势/.test(normalized)) {
    return { operation: 'group', metric: '销售额', filters: [], group_by: '订单日期', order: null, limit: null }
  }
  if (/不同地区|地区.*对比|地区.*分布|地区.*图/.test(normalized)) {
    const region = ['华东', '华南', '华北', '西南', '西北'].find((name) => normalized.includes(name))
    return { operation: 'group', metric: '销售额', filters: region ? [{ field: '地区', operator: 'equals', value: region }] : [], group_by: '地区', order: 'desc', limit: null }
  }
  if (/平均折扣.*地区|地区.*平均折扣/.test(normalized)) {
    return { operation: 'average', metric: '折扣', filters: [], group_by: '地区', order: 'desc', limit: 1 }
  }
  if (/利润|毛利/.test(normalized)) {
    return { operation: /最高|最大|最好/.test(normalized) ? 'group' : 'sum', metric: '利润', filters: [], group_by: /产品/.test(normalized) ? '产品' : null, order: 'desc', limit: /产品/.test(normalized) ? 1 : null }
  }
  if (/哪个月|月份.*最高|月.*最高/.test(normalized)) {
    return { operation: 'group', metric: '销售额', filters: [], group_by: '订单日期', order: 'desc', limit: 1 }
  }
  if (/前三|前3|产品.*最高|最高.*产品|产品.*排行/.test(normalized)) {
    return { operation: 'group', metric: '销售额', filters: [], group_by: '产品', order: 'desc', limit: 3 }
  }
  if (/地区.*最低|最低.*地区/.test(normalized)) {
    return { operation: 'group', metric: '销售额', filters: [], group_by: '地区', order: 'asc', limit: 1 }
  }
  if (/哪个地区|区域.*最高/.test(normalized)) {
    return { operation: 'group', metric: '销售额', filters: [], group_by: '地区', order: 'desc', limit: 1 }
  }
  if (/客户类型|会员|新客|普通/.test(normalized)) {
    return { operation: 'group', metric: '销售额', filters: [], group_by: '客户类型', order: 'desc', limit: null }
  }
  const region = ['华东', '华南', '华北', '西南', '西北'].find((name) => normalized.includes(name))
  const years = [...normalized.matchAll(/(20\d{2})/g)].map((match) => Number(match[1]))
  const filters = []
  if (/去年/.test(normalized)) filters.push({ field: '订单日期', operator: 'year', value: new Date().getFullYear() - 1 })
  else if (years.length === 1) filters.push({ field: '订单日期', operator: 'year', value: years[0] })
  if (/总营收|总收入|销售额总计|总销售额|营收多少/.test(normalized)) {
    return { operation: 'sum', metric: '销售额', filters: region ? [...filters, { field: '地区', operator: 'equals', value: region }] : filters, group_by: null, order: null, limit: null }
  }
  throw new Error('暂时支持总营收、产品排名、地区营收、月度营收、地区收入占比和平均折扣')
}

function planText(plan) {
  const filters = plan.filters.length
    ? `先筛选 ${plan.filters.map((filter) => `${filter.field}=${filter.value}`).join(' 且 ')}，`
    : ''
  if (plan.operation === 'sum') return `${filters}对「${plan.metric}」求和`
  if (plan.operation === 'share') return `${filters}按月份和地区计算「${plan.metric}」收入占比`
  if (plan.operation === 'average') return `${filters}按「${plan.group_by}」分组，求「${plan.metric}」平均值，从高到低比较`
  return `${filters}按「${plan.group_by === '订单日期' ? '月份' : plan.group_by}」分组，汇总「${plan.metric}」，从${plan.order === 'asc' ? '低' : '高'}到${plan.order === 'asc' ? '高' : '低'}排序${plan.limit ? `，取前 ${plan.limit} 名` : ''}`
}

function buildAgentSteps(rows, plan, computed) {
  const years = [...new Set(rows.map((row) => row.year))].sort((a, b) => a - b)
  return [
    {
      title: '理解问题',
      method: `识别统计指标、筛选条件和输出形式。数据覆盖 ${years.join('、')} 年。`,
      result: `分析目标：${planText(plan)}`,
    },
    {
      title: '尝试这样计算',
      method: planText(plan),
      result: computed.evidence,
    },
    {
      title: '根据结果继续分析',
      method: '检查记录数、分组数量和数值有效性，再转换成业务答案。',
      result: `${computed.rows.length} 组结果已通过校验${Array.isArray(plan.group_by) ? '。' : `，结果值为 ${formatMetric(computed.value, plan.metric)}。`}`,
    },
    {
      title: '给出最终答案',
      method: `依据：${computed.evidence}`,
      result: computed.answer,
    },
  ]
}

export function analyzeQuestion(rows, question) {
  const plan = guessPlan(question)
  const computed = executePlan(rows, plan)
  const agentSteps = buildAgentSteps(rows, plan, computed)
  return {
    type: plan.operation,
    title: '真实数据计算结果',
    answer: computed.answer,
    detail: computed.evidence,
    steps: agentSteps.map((step) => `${step.title}：${step.result}`),
    agentSteps,
    plan,
    rows: computed.rows,
    totalSteps: agentSteps.length,
  }
}
