export function detectChartIntent(question, plan = {}) {
  const normalized = String(question ?? '')
  if (plan.chart) return { type: plan.chart, title: Array.isArray(plan.group_by) ? `${plan.group_by.join(' × ')}${plan.metric}${plan.operation === 'share' ? '占比' : ''}` : `${plan.metric}分析` }
  if (!/(画|图|柱状|折线|趋势|对比)/.test(normalized)) return null
  if (/堆[积叠]|stack/i.test(normalized)) return { type: 'stacked-bar', title: '每月各地区收入堆积柱状图' }
  if (/(每个月|每月|按月).*(不同地区|各地区).*(占比|比例)/.test(normalized)) {
    return { type: 'multi-line', title: '每月不同地区收入占比' }
  }
  if (plan.operation === 'sum' && plan.group_by == null && !/趋势|按月|每月|每个月/.test(normalized)) return null

  const type = /柱状/.test(normalized) ? 'bar' : /折线|趋势|按月|每月|每个月/.test(normalized)
    ? 'line'
    : /柱状|对比|排名|排行|地区|产品/.test(normalized)
      ? 'bar'
      : plan.group_by === '订单日期' ? 'line' : 'bar'

  const title = /每个月|每月|按月|月份|月度/.test(normalized)
    ? '每月营收趋势'
    : /地区/.test(normalized) ? '不同地区营收对比' : '营收排行'
  return { type, title }
}

function escapeXml(value) {
  return String(value ?? '').replace(/[<>&'"]/g, (char) => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    "'": '&apos;',
    '"': '&quot;',
  }[char]))
}

function formatAxis(value) {
  if (Math.abs(value) >= 10000) return `${(value / 10000).toLocaleString('zh-CN', { maximumFractionDigits: 1 })}万`
  return value.toLocaleString('zh-CN', { maximumFractionDigits: 1 })
}

export function renderChartSvg({ type = 'bar', title = '数据图表', rows = [], metric = '销售额', operation = 'group' }) {
  if (!['bar', 'line', 'multi-line', 'stacked-bar'].includes(type)) throw new Error(`不支持的图表类型：${type}`)
  const points = rows.map((row) => ({
    label: String(row.label ?? ''),
    value: Number(row.value),
    series: Array.isArray(row.series) ? row.series : null,
  }))
  if (!points.length) throw new Error('没有可用于绘图的数据')
  const multiSeries = ['multi-line', 'stacked-bar'].includes(type)
  if (multiSeries && points.some((point) => !point.series?.length || point.series.some((item) => !Number.isFinite(Number(item.value)) || Number(item.value) < 0))) throw new Error('多系列图缺少有效的非负序列数据')
  if (!multiSeries && points.some((point) => point.series)) throw new Error('多维结果请使用 multi-line 或 stacked-bar 图表')
  const seriesNames = [...new Set(points.flatMap((point) => (point.series ?? []).map((item) => item.label)))]
  const dateAxis = points.every((point) => /^\d{4}-\d{2}(?:-\d{2})?$/.test(point.label))
  const labelWidth = Math.max(...points.map((point) => [...point.label].reduce((size, char) => size + (/[^\x00-\x7F]/.test(char) ? 11 : 6.5), 0)))
  const pointSpacing = dateAxis ? 76 : Math.max(70, labelWidth + 18)
  const width = Math.max(960, points.length * pointSpacing + 144)
  const legendRows = Math.ceil(seriesNames.length / 6)
  const height = 480 + Math.max(0, legendRows - 1) * 24
  const padding = { top: multiSeries ? 90 + Math.max(0, legendRows - 1) * 24 : 62, right: 72, bottom: 72, left: 72 }
  const plotWidth = width - padding.left - padding.right
  const plotHeight = height - padding.top - padding.bottom
  const seriesMax = type === 'stacked-bar' ? Math.max(...points.map((point) => (point.series ?? []).reduce((total, item) => total + Number(item.value), 0)), 1) : Math.max(...points.flatMap((point) => (point.series ?? []).map((item) => Number(item.value))), 1)
  const dataMax = multiSeries ? seriesMax : Math.max(...points.map((point) => point.value), 1)
  const scale = 10 ** Math.floor(Math.log10(Math.max(dataMax, 0.0001)))
  const axisMax = multiSeries && operation === 'share'
    ? 100
    : Math.ceil(dataMax / scale) * scale
  const axisMin = multiSeries ? 0 : Math.min(0, ...points.map((point) => point.value))
  const yTicks = Array.from({ length: 5 }, (_, index) => axisMin + (axisMax - axisMin) / 4 * index)
  const valueY = (value) => padding.top + plotHeight - ((value - axisMin) / (axisMax - axisMin)) * plotHeight
  const axisLabel = (point, x) => dateAxis
    ? `<text class="chart-x-label" data-label="${escapeXml(point.label)}" x="${x}" y="${height - 43}" text-anchor="middle" style="font-size:11px;fill:#696B80"><title>${escapeXml(point.label)}</title><tspan x="${x}">${point.label.slice(0, 4)}</tspan><tspan x="${x}" dy="16">${point.label.slice(5)}</tspan></text>`
    : `<text class="chart-x-label" x="${x}" y="${height - 35}" text-anchor="middle" style="font-size:11px;fill:#696B80">${escapeXml(point.label)}</text>`
  const seriesColors = ['#3B6CF4', '#00B09B', '#F5A623', '#9B59B6', '#E84848', '#00C9D7', '#8BC34A', '#FF6B8A', '#9395A8']
  if (type === 'stacked-bar') {
    const barWidth = Math.min(48, plotWidth / points.length * 0.65)
    const marks = points.map((point, index) => {
      const center = padding.left + (index + 0.5) * plotWidth / points.length
      let total = 0
      const segments = seriesNames.map((name, seriesIndex) => {
        const value = Number(point.series.find((item) => item.label === name)?.value ?? 0)
        const bottom = valueY(total)
        total += value
        return `<rect data-series="${escapeXml(name)}" data-value="${value}" x="${center - barWidth / 2}" y="${valueY(total)}" width="${barWidth}" height="${bottom - valueY(total)}" fill="${seriesColors[seriesIndex % seriesColors.length]}"><title>${escapeXml(point.label)} · ${escapeXml(name)}：${formatAxis(value)}${operation === 'share' ? '%' : ''}</title></rect>`
      }).join('')
      return `<g>${segments}<text x="${center}" y="${valueY(total) - 8}" text-anchor="middle">${formatAxis(total)}${operation === 'share' ? '%' : ''}</text>${axisLabel(point, center)}</g>`
    }).join('')
    const legend = seriesNames.map((name, index) => {
      const legendX = padding.left + index % 6 * 140
      const legendY = 65 + Math.floor(index / 6) * 24
      return `<rect x="${legendX}" y="${legendY - 9}" width="10" height="10" fill="${seriesColors[index % seriesColors.length]}"/><text x="${legendX + 16}" y="${legendY}">${escapeXml(name)}</text>`
    }).join('')
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(title)}"><title>${escapeXml(title)}</title><style>text{font-family:Manrope,PingFang SC,sans-serif;font-size:11px;fill:#696B80}</style><rect width="${width}" height="${height}" rx="8" fill="#FFFFFF"/><text x="${padding.left}" y="30" style="font-size:21px;font-weight:700;fill:#1A1A2E">${escapeXml(title)}</text><text x="${padding.left}" y="47">${escapeXml(metric)}${operation === 'share' ? '占比（%）' : ''} · 真实数据计算</text>${legend}${yTicks.map((value) => `<line x1="${padding.left}" y1="${valueY(value)}" x2="${width - padding.right}" y2="${valueY(value)}" stroke="#F0F1F5" stroke-dasharray="4 5"/><text x="${padding.left - 12}" y="${valueY(value) + 4}" text-anchor="end">${formatAxis(value)}${operation === 'share' ? '%' : ''}</text>`).join('')}${marks}</svg>`
  }
  if (type === 'multi-line') {
    if (points.some((point) => !point.series?.length)) throw new Error('多系列图缺少地区序列')
    const xStep = points.length > 1 ? plotWidth / (points.length - 1) : 0
    const lineGroups = seriesNames.map((name, seriesIndex) => {
      const path = points.map((point, index) => {
        const x = padding.left + (points.length > 1 ? index * xStep : plotWidth / 2)
        const y = valueY(Number(point.series.find((item) => item.label === name)?.value ?? 0))
        return `${index === 0 ? 'M' : 'L'}${x},${y}`
      }).join(' ')
      const dots = points.map((point, index) => {
        const x = padding.left + (points.length > 1 ? index * xStep : plotWidth / 2)
        const y = valueY(Number(point.series.find((item) => item.label === name)?.value ?? 0))
        return `<circle cx="${x}" cy="${y}" r="3.5" fill="#FFFFFF" stroke="${seriesColors[seriesIndex % seriesColors.length]}" stroke-width="2" />`
      }).join('')
      const legendX = padding.left + seriesIndex % 6 * 140
      const legendY = 65 + Math.floor(seriesIndex / 6) * 24
      return `<path d="${path}" fill="none" stroke="${seriesColors[seriesIndex % seriesColors.length]}" stroke-width="2.5" stroke-linecap="round" />${dots}<circle cx="${legendX}" cy="${legendY - 4}" r="4" fill="${seriesColors[seriesIndex % seriesColors.length]}" /><text x="${legendX + 10}" y="${legendY}" fill="#696B80" font-family="Manrope,PingFang SC,sans-serif" font-size="11">${escapeXml(name)}</text>`
    }).join('')
    const labels = points.map((point, index) => {
      const x = padding.left + (points.length > 1 ? index * xStep : plotWidth / 2)
      return `${axisLabel(point, x)}`
    }).join('')
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(title)}"><title>${escapeXml(title)}</title><style>text{font-family:Manrope,PingFang SC,sans-serif;font-size:11px;fill:#696B80}</style><rect width="${width}" height="${height}" rx="8" fill="#FFFFFF" /><text x="${padding.left}" y="30" fill="#1A1A2E" font-family="Manrope,PingFang SC,sans-serif" font-size="21" font-weight="700">${escapeXml(title)}</text><text x="${padding.left}" y="47" fill="#9395A8" font-family="Manrope,PingFang SC,sans-serif" font-size="12">${escapeXml(metric)}${operation === 'share' ? '占比' : ''} · 真实数据计算</text>${yTicks.map((value) => `<line x1="${padding.left}" y1="${valueY(value)}" x2="${width - padding.right}" y2="${valueY(value)}" stroke="#F0F1F5" stroke-dasharray="4 5" /><text x="${padding.left - 12}" y="${valueY(value) + 4}" text-anchor="end" fill="#9395A8" font-family="Manrope,PingFang SC,sans-serif" font-size="11">${formatAxis(value)}${operation === 'share' ? '%' : ''}</text>`).join('')}${lineGroups}${labels}</svg>`
  }
  if (points.some((point) => !Number.isFinite(point.value))) {
    throw new Error('绘图数据包含无效数值')
  }

  const xStep = points.length > 1 ? plotWidth / (points.length - 1) : 0

  const marks = points.map((point, index) => {
    const x = type === 'bar' ? padding.left + (index + 0.5) * plotWidth / points.length : padding.left + (points.length > 1 ? index * xStep : plotWidth / 2)
    const y = valueY(point.value)
    if (type === 'bar') {
      const barWidth = Math.min(64, plotWidth / points.length * 0.46)
      return `<g><rect x="${x - barWidth / 2}" y="${Math.min(y, valueY(0))}" width="${barWidth}" height="${Math.abs(valueY(0) - y)}" rx="5" fill="#3B6CF4" opacity="${Math.max(0.5, 0.94 - index * 0.05)}" /><text x="${x}" y="${y - 11}" text-anchor="middle">${formatAxis(point.value)}</text>${axisLabel(point, x)}</g>`
    }
    const lineX = padding.left + (points.length > 1 ? index * xStep : plotWidth / 2)
    return `<g><circle cx="${lineX}" cy="${y}" r="5" fill="#FFFFFF" stroke="#3B6CF4" stroke-width="2.5" /><text x="${lineX}" y="${y - 14}" text-anchor="middle">${formatAxis(point.value)}</text>${axisLabel(point, lineX)}</g>`
  }).join('')

  const linePath = type === 'line'
    ? `<path d="M${points.map((point, index) => `${padding.left + (points.length > 1 ? index * xStep : plotWidth / 2)},${valueY(point.value)}`).join(' L')}" fill="none" stroke="#3B6CF4" stroke-width="3" stroke-linecap="round" />`
    : ''

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(title)}"><title>${escapeXml(title)}</title><style>text{font-family:Manrope,PingFang SC,sans-serif;font-size:11px;fill:#696B80}</style><rect width="${width}" height="${height}" rx="9" fill="#FFFFFF" /><text x="${padding.left}" y="34" fill="#1A1A2E" font-family="Manrope,PingFang SC,sans-serif" font-size="21" font-weight="700">${escapeXml(title)}</text><text x="${padding.left}" y="55" fill="#9395A8" font-family="Manrope,PingFang SC,sans-serif" font-size="12">${escapeXml(metric)} · 真实数据计算</text>${yTicks.map((value) => `<line x1="${padding.left}" y1="${valueY(value)}" x2="${width - padding.right}" y2="${valueY(value)}" stroke="#F0F1F5" stroke-dasharray="4 5" /><text x="${padding.left - 12}" y="${valueY(value) + 4}" text-anchor="end" fill="#9395A8" font-family="Manrope,PingFang SC,sans-serif" font-size="11">${formatAxis(value)}</text>`).join('')}<line x1="${padding.left}" y1="${padding.top + plotHeight}" x2="${width - padding.right}" y2="${padding.top + plotHeight}" stroke="#DFE0E8" />${linePath}${marks}</svg>`
}
