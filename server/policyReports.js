import { storageDirectory, atomicWrite } from './storageContext.js'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { policyRoot } from './policyIO.js'
import { policyCustomerRows } from '../src/policyAnalysis.js'
import { describePolicySummary } from './policyTools.js'

const amount = (value) => value == null ? '—' : value.toLocaleString('zh-CN', { maximumFractionDigits: 4 })
const percent = (value) => value == null ? '—' : `${amount(value * 100)}%`
const textCell = (value) => String(value ?? '').replace(/\|/g, '\\|').replace(/[\r\n]/g, ' ')

export function policyMarkdown(report) {
  const lines = [`# ${report.rules.name} · 消耗达成复盘`, '', `政策期：${report.rules.startDate}—${report.rules.endDate}；截至 ${report.asOf}；${report.phase}；金额单位：万元。`, '', describePolicySummary(report.summary), '', '## 口径与假设', '', '客户数达成率＝一档及以上客户数/base客户数；base加权达成率＝已达成客户日均base之和/全部日均base之和。二档单独列示。', '', '增长＝cost6/(日均base×同天数)−1；政策返货＝min(正cost6增量×cost4/cost6，日均base×二档增速×封顶系数×天数)×达成档返点率（默认公式）。', '', `框架返货＝正cost6增量×现金率×${percent(report.rules.annualRate)}；渠道返货＝正cost6增量×现金率×${percent(report.rules.channelRate)}；ROI仅纳入政策返货>0的客户；ROI＝获返客户cost6增量之和/(同一批客户政策＋框架＋渠道返货之和)。无政策获返客户时ROI不适用。`, '', `缺行处理：${report.rules.missingAsZero ? '用户确认缺行视零' : '缺数待核验，达成率显示观测下界'}；封顶模式：${report.rules.capMode}；过程额外奖励：忽略。`, '', ...report.warnings.map((warning) => `- ${warning}`), '', '## 数据关联与完整性', '', `base ${report.summary.count} 客户，匹配 ${report.summary.matchedCount} 客户；缺客户日组合 ${report.reconciliation.missingCustomerDays}。无明细客户：${report.reconciliation.missingCustomers.join('、') || '无'}。`, '', '## 分维度复盘', '']
  for (const [dimension, groups] of Object.entries(report.groups)) {
    lines.push(`### ${dimension}`, '', '|分组|客户数|达成客户|客户达成率|base加权达成率|cost6|净增量|增速|政策返货|ROI获返客户数|获返客户增量|获返客户三项返货|获返客户ROI|', '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|')
    groups.forEach((group) => lines.push(`|${textCell(group.label)}|${group.count}|${group.hit1Count}|${percent(group.countRate)}|${percent(group.baseWeightedRate)}|${amount(group.cost6)}|${amount(group.increment)}|${percent(group.growth)}|${amount(group.policyRebate)}|${group.roiCustomerCount}|${amount(group.roiIncrement)}|${amount(group.roiTotalRebate)}|${amount(group.roi)}|`))
    lines.push('')
  }
  lines.push('## 日度消耗过程', '', '|日期|已记录客户数|cost6|cost4|累计cost6|累计base|累计增速|客户达成率|base加权达成率|', '|---|---:|---:|---:|---:|---:|---:|---:|---:|')
  report.trend.forEach((day) => lines.push(`|${day.date}|${day.recordedCustomers}|${amount(day.cost6)}|${amount(day.cost4)}|${amount(day.cumulativeCost6)}|${amount(day.cumulativeBase)}|${percent(day.growth)}|${percent(day.countRate)}|${percent(day.baseWeightedRate)}|`))
  lines.push('', '## 原始政策与输入', '', report.rules.sourceUrl || '用户提供结构化规则', '', ...(report.sources || []).map((source) => `- ${source.name} / ${source.sheet} / SHA256 ${source.sha256}`), '')
  return lines.join('\n')
}

export function policyCsv(report) {
  const rows = policyCustomerRows(report)
  const headers = Object.keys(rows[0] || {})
  const cell = (value) => {
    let text = String(value ?? '')
    if (typeof value === 'string' && /^[=+\-@]/.test(value)) text = `'${text}`
    return `"${text.replace(/"/g, '""')}"`
  }
  return '\uFEFF' + [headers.map(cell).join(','), ...rows.map((row) => headers.map((header) => cell(row[header])).join(','))].join('\r\n')
}

export async function savePolicyReport(report) {
  const directory = storageDirectory('policy-reports')
  await mkdir(directory, { recursive: true })
  await Promise.all([atomicWrite(path.join(directory, 'latest.json'), JSON.stringify(report, null, 2)), atomicWrite(path.join(directory, 'latest.md'), policyMarkdown(report)), atomicWrite(path.join(directory, 'customers.csv'), policyCsv(report))])
  return { markdown: 'policy-reports/latest.md', json: 'policy-reports/latest.json', customers: 'policy-reports/customers.csv' }
}
