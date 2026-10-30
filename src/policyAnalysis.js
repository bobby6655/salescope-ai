import { NATIONAL_DAY_POLICY, POLICY_FIELDS } from './policyRules.js'

const sum = (rows, field) => rows.reduce((total, row) => total + (row[field] ?? 0), 0)
const ratio = (numerator, denominator) => denominator > 0 ? numerator / denominator : null
const nameKey = (value) => String(value ?? '').normalize('NFKC').trim()
const dayNumber = (date) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) throw new Error(`日期格式不正确：${date}`)
  const value = Date.parse(`${date}T00:00:00Z`)
  if (!Number.isFinite(value) || new Date(value).toISOString().slice(0, 10) !== date) throw new Error(`日期无效：${date}`)
  return value / 86400000
}
const number = (value, label) => {
  if (value == null || (typeof value === 'string' && !value.trim()) || !Number.isFinite(Number(value))) throw new Error(`${label}不是有效数值`)
  return Number(value)
}
const above = (value, threshold) => value + Number.EPSILON * Math.max(1, Math.abs(value), Math.abs(threshold)) * 8 >= threshold

export function validatePolicy(input = NATIONAL_DAY_POLICY) {
  const rules = { ...NATIONAL_DAY_POLICY, ...input }
  const days = dayNumber(rules.endDate) - dayNumber(rules.startDate) + 1
  if (days < 1 || days > 366) throw new Error('政策天数必须在1到366之间')
  for (const field of ['annualRate', 'channelRate']) if (!Number.isFinite(rules[field]) || rules[field] < 0 || rules[field] > 1) throw new Error(`${field}需要是0到1的比例`)
  if (rules.processBonusRate !== 0) throw new Error('当前忽略过程奖励，只允许processBonusRate=0')
  // 旧输入的全量基数字段迁移为当前固定增量现金口径。
  if (!['cost4', 'cost6', 'cashIncrement'].includes(rules.regularRebateBasis)) throw new Error('框架/渠道计返基数必须为增量现金')
  rules.regularRebateBasis = 'cashIncrement'
  rules.roiScope = 'policyRecipients'
  if (!['cashAdjusted', 'growthOnly'].includes(rules.capMode)) throw new Error('封顶模式无效')
  if (!Number.isFinite(rules.capCoefficient) || rules.capCoefficient <= 0) throw new Error('封顶系数必须为正数')
  if (!Array.isArray(rules.tiers) || !rules.tiers.length || rules.tiers.length > 50) throw new Error('政策需要有效分层规则')
  const tiers = rules.tiers.map((tier) => {
    if (!tier.type || !tier.label || !Number.isFinite(tier.min) || tier.min < 0 || (tier.max != null && (!Number.isFinite(tier.max) || tier.max <= tier.min))) throw new Error('档位上下界或类型无效')
    for (const field of ['growth1', 'growth2', 'rate1', 'rate2']) if (!Number.isFinite(tier[field]) || tier[field] < 0) throw new Error(`档位${field}无效`)
    if (tier.growth2 < tier.growth1 || tier.rate2 < tier.rate1 || tier.rate2 > 1) throw new Error('二档门槛/返点不得低于一档，返点不得超过100%')
    return { ...tier }
  })
  for (const type of new Set(tiers.map((tier) => tier.type))) {
    const grouped = tiers.filter((tier) => tier.type === type).sort((left, right) => left.min - right.min)
    for (let index = 1; index < grouped.length; index += 1) if ((grouped[index - 1].max ?? Infinity) > grouped[index].min) throw new Error(`${type}档位存在重叠`)
  }
  const warnings = (Array.isArray(rules.warnings) ? rules.warnings : []).filter((warning) => !/cost4总额|可切换cost6|默认cost4试算/.test(warning))
  return { ...rules, tiers, days, warnings }
}

export function summarizeCustomers(customers, days) {
  const matched = customers.filter((customer) => customer.hasConsumption)
  const hits1 = customers.filter((customer) => customer.hit1)
  const hits2 = customers.filter((customer) => customer.hit2)
  const unknown = customers.filter((customer) => customer.uncertain && !customer.hit1)
  const baseDaily = sum(customers, 'baseDaily')
  const baseTotal = baseDaily * days
  const cost6 = sum(customers, 'cost6')
  const cost4 = sum(customers, 'cost4')
  const policyRebate = sum(customers, 'policyRebate')
  const annualRebate = sum(customers, 'annualRebate')
  const channelRebate = sum(customers, 'channelRebate')
  const increment = cost6 - baseTotal
  const totalRebate = policyRebate + annualRebate + channelRebate
  const roiCustomers = customers.filter((customer) => customer.policyRebate > 0)
  const roiIncrement = sum(roiCustomers, 'increment')
  const roiAnnualRebate = sum(roiCustomers, 'annualRebate')
  const roiChannelRebate = sum(roiCustomers, 'channelRebate')
  const roiTotalRebate = policyRebate + roiAnnualRebate + roiChannelRebate
  return {
    count: customers.length, matchedCount: matched.length, unmatchedCount: customers.length - matched.length,
    hit1Count: hits1.length, hit2Count: hits2.length, unknownCount: unknown.length, pendingDataCount: customers.filter((customer) => customer.uncertain).length,
    countRate: ratio(hits1.length, customers.length), countRate2: ratio(hits2.length, customers.length), matchedCountRate: ratio(hits1.length, matched.length),
    baseWeightedRate: ratio(sum(hits1, 'baseDaily'), baseDaily), baseWeightedRate2: ratio(sum(hits2, 'baseDaily'), baseDaily),
    countRateUpper: ratio(hits1.length + unknown.length, customers.length), baseWeightedRateUpper: ratio(sum(hits1, 'baseDaily') + sum(unknown, 'baseDaily'), baseDaily),
    baseDaily, baseTotal, cost6, cost4, dailyCost6: cost6 / days, increment,
    positiveIncrement: sum(customers.filter((customer) => customer.increment > 0), 'increment'), negativeIncrement: sum(customers.filter((customer) => customer.increment < 0), 'increment'),
    growth: ratio(cost6, baseTotal) == null ? null : cost6 / baseTotal - 1,
    matchedGrowth: ratio(cost6, sum(matched, 'baseDaily') * days) == null ? null : cost6 / (sum(matched, 'baseDaily') * days) - 1,
    cashRate: ratio(cost4, cost6), policyRebate, annualRebate, channelRebate, totalRebate,
    roiCustomerCount: roiCustomers.length, roiIncrement, roiAnnualRebate, roiChannelRebate, roiTotalRebate,
    roi: ratio(roiIncrement, roiTotalRebate), policyRoi: ratio(roiIncrement, policyRebate), annualRoi: ratio(roiIncrement, roiAnnualRebate), channelRoi: ratio(roiIncrement, roiChannelRebate),
    cappedCount: customers.filter((customer) => customer.capped).length,
    needed1: sum(customers, 'gap1'), needed2: sum(customers, 'gap2'),
  }
}

export function analyzePolicy(baseRows, consumptionRows, inputRules = NATIONAL_DAY_POLICY, options = {}) {
  const rules = validatePolicy(inputRules)
  const fields = { base: { ...POLICY_FIELDS.base, ...options.fields?.base }, consumption: { ...POLICY_FIELDS.consumption, ...options.fields?.consumption } }
  if (!Array.isArray(baseRows) || !baseRows.length || !Array.isArray(consumptionRows)) throw new Error('需要客户base表和消耗明细表')
  for (const key of ['customer', 'type', 'department', 'sales', 'base']) if (!Object.hasOwn(baseRows[0], fields.base[key])) throw new Error(`base表缺少字段：${fields.base[key]}`)
  if (consumptionRows.length) for (const key of ['date', 'customer', 'cost6', 'cost4']) if (!Object.hasOwn(consumptionRows[0], fields.consumption[key])) throw new Error(`消耗表缺少字段：${fields.consumption[key]}`)
  const asOf = options.asOf || rules.endDate
  const elapsed = dayNumber(asOf) - dayNumber(rules.startDate) + 1
  if (elapsed < 1 || elapsed > rules.days) throw new Error('截止日期必须位于政策期内')
  const names = new Set()
  const clients = baseRows.map((row) => {
    const customer = nameKey(row[fields.base.customer])
    if (!customer || names.has(customer)) throw new Error(`base表客户为空或重复：${customer}`)
    names.add(customer)
    const baseDaily = number(row[fields.base.base], `${customer} base`)
    if (baseDaily <= 0) throw new Error(`${customer}的base必须为正数`)
    const type = nameKey(row[fields.base.type])
    const tier = rules.tiers.find((candidate) => candidate.type === type && baseDaily >= candidate.min && baseDaily < (candidate.max ?? Infinity))
    if (!tier) throw new Error(`${customer}的类型/base不在政策档位中：${type} ${baseDaily}`)
    for (const [column, property] of [['增速1档', 'growth1'], ['增量返点1档', 'rate1'], ['增速2档', 'growth2'], ['增量返点2档', 'rate2']]) if (row[column] != null && Math.abs(number(row[column], column) - tier[property]) > 1e-9) throw new Error(`${customer}的base表${column}与政策规则不一致`)
    if (row['封顶系数'] != null && number(row['封顶系数'], '封顶系数') !== rules.capCoefficient) throw new Error(`${customer}的封顶系数与政策不一致`)
    if (row['封顶增速'] != null && Math.abs(number(row['封顶增速'], '封顶增速') - tier.growth2 * rules.capCoefficient) > 1e-9) throw new Error(`${customer}的封顶增速与政策不一致`)
    if (row[fields.base.tier] != null && nameKey(row[fields.base.tier]) !== tier.label) throw new Error(`${customer}的base档位标签与政策不一致`)
    const department = nameKey(row[fields.base.department]) || '未填写'
    return { customer, type, department, departmentType: `${department} / ${type}`, sales: nameKey(row[fields.base.sales]) || '未填写', baseDaily, tier: tier.label, ...Object.fromEntries(['growth1', 'rate1', 'growth2', 'rate2'].map((key) => [key, tier[key]])), daily: [] }
  })
  const byName = new Map(clients.map((client) => [client.customer, client]))
  const unmatchedNames = new Set()
  const seen = new Set()
  let outOfPeriod = 0
  let outOfCohortCost6 = 0
  let outOfCohortCost4 = 0
  for (const row of consumptionRows) {
    const customer = nameKey(row[fields.consumption.customer])
    const rawDate = row[fields.consumption.date]
    const date = rawDate instanceof Date ? rawDate.toISOString().slice(0, 10) : String(rawDate ?? '').slice(0, 10)
    dayNumber(date)
    const cost6 = number(row[fields.consumption.cost6], `${customer} cost6`)
    const cost4 = number(row[fields.consumption.cost4], `${customer} cost4`)
    if (cost6 < 0 || cost4 < 0 || cost4 > cost6 + 0.00011) throw new Error(`${customer} ${date} 的cost4/cost6为负数或cost4大于cost6，请核验钱包口径`)
    if (date < rules.startDate || date > asOf) { outOfPeriod += 1; continue }
    const key = JSON.stringify([customer, date])
    if (seen.has(key)) throw new Error(`客户日聚合明细重复：${customer} ${date}，请先确认是否重复导入`)
    seen.add(key)
    const client = byName.get(customer)
    if (!client) { unmatchedNames.add(customer); outOfCohortCost6 += cost6; outOfCohortCost4 += cost4; continue }
    client.daily.push({ date, cost6, cost4 })
  }
  const customers = clients.map((client) => {
    client.daily.sort((left, right) => left.date.localeCompare(right.date))
    const cost6 = sum(client.daily, 'cost6')
    const cost4 = sum(client.daily, 'cost4')
    const hasConsumption = client.daily.length > 0
    const baseTotal = client.baseDaily * elapsed
    const increment = cost6 - baseTotal
    const growth = hasConsumption || rules.missingAsZero ? cost6 / baseTotal - 1 : null
    const cashRate = ratio(cost4, cost6)
    const hit1 = growth != null && above(growth, client.growth1)
    const hit2 = growth != null && above(growth, client.growth2)
    const rebateRate = hit2 ? client.rate2 : hit1 ? client.rate1 : 0
    const positiveIncrement = Math.max(0, increment)
    const cashIncrement = positiveIncrement * (cashRate ?? 0)
    const cap = client.baseDaily * client.growth2 * rules.capCoefficient * elapsed
    const eligibleIncrement = rules.capMode === 'cashAdjusted' ? Math.min(cashIncrement, cap) : Math.min(positiveIncrement, cap) * (cashRate ?? 0)
    const policyRebate = eligibleIncrement * rebateRate
    const regularBase = cashIncrement
    const annualRebate = regularBase * rules.annualRate
    const channelRebate = regularBase * rules.channelRate
    const uncertain = !rules.missingAsZero && client.daily.length < elapsed
    const status = hit2 ? '二档达成' : hit1 ? '一档达成' : uncertain ? hasConsumption ? '未达成·缺日待核验' : '无消耗明细' : '未达成'
    const target1 = client.baseDaily * (1 + client.growth1) * rules.days
    const target2 = client.baseDaily * (1 + client.growth2) * rules.days
    return { ...client, cost6, cost4, hasConsumption, coverageDays: client.daily.length, missingDays: elapsed - client.daily.length, uncertain, baseTotal, increment, growth, cashRate, hit1, hit2, status, rebateRate, policyRebate, annualRebate, channelRebate, totalRebate: policyRebate + annualRebate + channelRebate, roi: policyRebate > 0 ? ratio(increment, policyRebate + annualRebate + channelRebate) : null, policyRoi: policyRebate > 0 ? ratio(increment, policyRebate) : null, roiEligible: policyRebate > 0, capped: rebateRate > 0 && (rules.capMode === 'cashAdjusted' ? cashIncrement > cap : positiveIncrement > cap), cashIncrement, capCashIncrement: cap, target1, target2, gap1: Math.max(0, target1 - cost6), gap2: Math.max(0, target2 - cost6), dailyCost6: cost6 / elapsed, phaseTarget1: baseTotal * (1 + client.growth1), phaseTarget2: baseTotal * (1 + client.growth2), fullTargetRate1: ratio(cost6, target1), fullTargetRate2: ratio(cost6, target2), neededDaily1: rules.days > elapsed ? Math.max(0, target1 - cost6) / (rules.days - elapsed) : null }
  })
  const summary = summarizeCustomers(customers, elapsed)
  const groupBy = (field) => [...new Set(customers.map((customer) => customer[field]))].map((label) => ({ label, ...summarizeCustomers(customers.filter((customer) => customer[field] === label), elapsed) })).sort((left, right) => right.baseDaily - left.baseDaily)
  const trend = Array.from({ length: elapsed }, (unusedDay, index) => {
    const date = new Date((dayNumber(rules.startDate) + index) * 86400000).toISOString().slice(0, 10)
    let cost6 = 0
    let cost4 = 0
    let recordedCustomers = 0
    let cumulative = 0
    let achieved = 0
    let achievedBase = 0
    customers.forEach((customer) => {
      const daily = customer.daily.find((day) => day.date === date)
      if (daily) { cost6 += daily.cost6; cost4 += daily.cost4; recordedCustomers += 1 }
      const cumulativeCost = sum(customer.daily.filter((day) => day.date <= date), 'cost6')
      cumulative += cumulativeCost
      if (above(cumulativeCost, customer.baseDaily * (index + 1) * (1 + customer.growth1))) { achieved += 1; achievedBase += customer.baseDaily }
    })
    return { date, cost6, cost4, recordedCustomers, cumulativeCost6: cumulative, cumulativeBase: summary.baseDaily * (index + 1), growth: ratio(cumulative, summary.baseDaily * (index + 1)) - 1, countRate: ratio(achieved, customers.length), baseWeightedRate: ratio(achievedBase, summary.baseDaily) }
  })
  const warnings = [...rules.warnings.filter((warning) => !/cost4总额|可切换cost6|默认cost4试算/.test(warning))]
  warnings.push('框架/渠道返货＝正cost6增量×现金率×对应返点率；ROI仅纳入政策返货大于0的客户，分子为这些客户的cost6增量合计，分母为同一批客户的三项返货合计。无获返客户时ROI不适用。')
  if (summary.unmatchedCount) warnings.push(`${summary.unmatchedCount}个base客户没有消耗明细；按${rules.missingAsZero ? '已确认缺行视为零' : '待核验'}处理。`)
  const missingDays = sum(customers, 'missingDays')
  if (missingDays && !rules.missingAsZero) warnings.push(`客户日明细缺少${missingDays}个组合；达成率按全base分母展示观测下界，附上界；返货/ROI为基于当前输入的试算。`)
  if (unmatchedNames.size) warnings.push(`${unmatchedNames.size}个消耗客户不在base表，未纳入达成和返货，其cost6=${outOfCohortCost6}万。`)
  if (elapsed < rules.days) warnings.push('当前为阶段节奏监控；当前日均达成不等于最终达成，返货为阶段试算。')
  return { rules, asOf, elapsedDays: elapsed, remainingDays: rules.days - elapsed, phase: elapsed === rules.days ? '期末复盘' : '阶段监控', unit: '万元', summary, customers, trend, groups: { sales: groupBy('sales'), department: groupBy('department'), departmentType: groupBy('departmentType'), type: groupBy('type'), tier: groupBy('tier'), status: groupBy('status') }, reconciliation: { baseCustomers: clients.length, matchedCustomers: summary.matchedCount, missingCustomers: customers.filter((customer) => !customer.hasConsumption).map((customer) => customer.customer), unmatchedCustomers: [...unmatchedNames], outOfPeriodRows: outOfPeriod, outOfCohortCost6, outOfCohortCost4, missingCustomerDays: missingDays }, warnings }
}

export function policyCustomerRows(report) {
  return report.customers.map((customer) => ({ 客户: customer.customer, 负责销售: customer.sales, 部门: customer.department, 类型: customer.type, 档位: customer.tier, 状态: customer.status, 'base日均(万)': customer.baseDaily, '基期同天数消耗(万)': customer.baseTotal, '考核消耗cost6(万)': customer.cost6, '计返消耗cost4(万)': customer.cost4, 'cost6增量(万)': customer.increment, 消耗增速: customer.growth, 现金率: customer.cashRate, 一档达成: customer.hit1 ? 1 : 0, 二档达成: customer.hit2 ? 1 : 0, '政策返货试算(万)': customer.policyRebate, '框架增量返货试算(万)': customer.annualRebate, '渠道增量返货试算(万)': customer.channelRebate, '总返货试算(万)': customer.totalRebate, '获政策返货客户ROI': customer.roi, '纳入ROI': customer.roiEligible ? 1 : 0, '一档缺口(万)': customer.gap1, '二档缺口(万)': customer.gap2, 有明细天数: customer.coverageDays, 缺明细天数: customer.missingDays, 待核验: customer.uncertain ? 1 : 0 }))
}
