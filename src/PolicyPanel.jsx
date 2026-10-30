import React, { useEffect, useMemo, useRef, useState } from 'react'
import { NATIONAL_DAY_POLICY, POLICY_FIELDS } from './policyRules.js'
import { summarizeCustomers } from './policyAnalysis.js'
import { renderChartSvg } from './chartGenerator.js'

const amount = (value) => value == null ? '—' : value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
const percent = (value) => value == null ? '—' : `${amount(value * 100)}%`
const dimensions = { sales: '负责销售', department: '部门', departmentType: '部门×类型', type: '客户类型', tier: 'base档位', status: '达成状态' }

function Chart({ title, rows, type = 'line', metric = 'cost6(万)' }) {
  if (!rows.length) return <div className="empty-state">暂无消耗明细，不能断言为零</div>
  try { const svg = renderChartSvg({ type, title, rows, metric }); return <figure className="chart-figure"><img alt={title} src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`} /></figure> } catch (error) { return <p role="alert">{error.message}</p> }
}

function GroupTable({ groups }) {
  return <div className="v2-table-scroll"><table className="v2-table"><thead><tr>{['分组', '客户数', '达成/二档', '客户达成率', 'base加权达成率', 'base日均(万)', 'cost6(万)', '增量(万)', '增速', '政策返货(万)', 'ROI获返客户数', '获返客户增量(万)', '获返客户三项返货(万)', '获返客户ROI', '待核验'].map((label) => <th key={label}>{label}</th>)}</tr></thead><tbody>{groups.map((group) => <tr key={group.label}><td>{group.label}</td><td>{group.count}</td><td>{group.hit1Count}/{group.hit2Count}</td><td>{percent(group.countRate)}</td><td>{percent(group.baseWeightedRate)}</td><td>{amount(group.baseDaily)}</td><td>{amount(group.cost6)}</td><td>{amount(group.increment)}</td><td>{percent(group.growth)}</td><td>{amount(group.policyRebate)}</td><td>{group.roiCustomerCount}</td><td>{amount(group.roiIncrement)}</td><td>{amount(group.roiTotalRebate)}</td><td>{amount(group.roi)}</td><td>{group.unknownCount}</td></tr>)}</tbody></table></div>
}

export default function PolicyPanel() {
  const [report, setReport] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [baseFile, setBaseFile] = useState(null)
  const [costFile, setCostFile] = useState(null)
  const [rulesText, setRulesText] = useState(JSON.stringify(NATIONAL_DAY_POLICY, null, 2))
  const [fieldText, setFieldText] = useState(JSON.stringify(POLICY_FIELDS, null, 2))
  const [policyText, setPolicyText] = useState('')
  const [filters, setFilters] = useState({})
  const [search, setSearch] = useState('')
  const [groupBy, setGroupBy] = useState('department')
  const [customerName, setCustomerName] = useState('')
  const [question, setQuestion] = useState('')
  const [history, setHistory] = useState([])
  const [answer, setAnswer] = useState(null)
  const [asOf, setAsOf] = useState(NATIONAL_DAY_POLICY.endDate)
  const [annualRate, setAnnualRate] = useState(12)
  const [channelRate, setChannelRate] = useState(8.5)
  const [missingZero, setMissingZero] = useState(false)
  const resetChat = () => { setHistory([]); setAnswer(null); setQuestion('') }
  const accept = (result) => {
    setReport(result); setRulesText(JSON.stringify(result.rules, null, 2)); setAsOf(result.asOf)
    setAnnualRate(result.rules.annualRate * 100); setChannelRate(result.rules.channelRate * 100)
    setMissingZero(result.rules.missingAsZero)
    setFilters({}); setSearch(''); setCustomerName(''); resetChat()
  }
  useEffect(() => { let active = true; busyRef.current = true; setBusy(true); fetch('/api/policy/current').then(async (response) => { const result = await response.json(); if (!response.ok) throw new Error(result.error); if (active) accept(result) }).catch((failure) => { if (active) setError(failure.message) }).finally(() => { if (active) { busyRef.current = false; setBusy(false) } }); return () => { active = false } }, [])
  const post = async (route, payload) => {
    const response = await fetch(`/api/policy/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error || '政策操作失败')
    return result
  }
  const run = async (callback) => { if (busyRef.current) return; busyRef.current = true; setBusy(true); setError(''); try { await callback() } catch (failure) { setError(failure.message) } finally { busyRef.current = false; setBusy(false) } }
  const filePayload = (file) => new Promise((resolve, reject) => {
    if (!file) { reject(new Error('请分别选择客户base表与消耗明细表')); return }
    const reader = new FileReader()
    reader.onload = () => resolve({ name: file.name, data: String(reader.result).split(',')[1] })
    reader.onerror = () => reject(new Error('文件读取失败'))
    reader.readAsDataURL(file)
  })
  const upload = () => run(async () => {
    const [base, consumption] = await Promise.all([filePayload(baseFile), filePayload(costFile)])
    const rules = JSON.parse(rulesText)
    accept(await post('import', { base, consumption, rules, fields: JSON.parse(fieldText) }))
  })
  const recalculate = () => run(async () => accept(await post('recalculate', { asOf, rules: { ...JSON.parse(rulesText), annualRate: Number(annualRate) / 100, channelRate: Number(channelRate) / 100, regularRebateBasis: 'cashIncrement', missingAsZero: missingZero } })))
  const ask = (next = question) => run(async () => {
    if (!next.trim()) throw new Error('请输入政策问题')
    const scope = Object.entries(filters).filter(([, value]) => value).map(([field, value]) => ({ field, operator: 'equals', value }))
    if (search) scope.push({ field: 'customer', operator: 'contains', value: search })
    const scopedQuestion = scope.length ? `当前筛选${JSON.stringify(scope)}，除非问题明确指定其他客户或范围，请沿用筛选。问题：${next}` : next
    const result = await post('question', { question: scopedQuestion, history })
    setAnswer(result); setHistory((previous) => [...previous, { role: 'user', content: next }, { role: 'assistant', content: result.answer }].slice(-10)); setQuestion('')
  })
  const selected = useMemo(() => report ? report.customers.filter((customer) => Object.entries(filters).every(([field, value]) => !value || customer[field] === value) && (!search || customer.customer.toLowerCase().includes(search.toLowerCase()))) : [], [report, filters, search])
  const summary = report ? summarizeCustomers(selected, report.elapsedDays) : null
  const grouped = report ? [...new Set(selected.map((customer) => customer[groupBy]))].map((label) => ({ label, ...summarizeCustomers(selected.filter((customer) => customer[groupBy] === label), report.elapsedDays) })).sort((left, right) => right.baseDaily - left.baseDaily) : []
  const focused = report?.customers.find((customer) => customer.customer === customerName)
  const dailyRows = report ? report.trend.map((day) => ({ label: day.date, value: selected.reduce((total, customer) => total + (customer.daily.find((record) => record.date === day.date)?.cost6 || 0), 0) })) : []

  return <section className="policy-panel"><div className="page-heading"><div><div className="eyebrow">独立业务板块 · 政策监控</div><h1>政策达成与增量回报。</h1><p>关联客户base和每日消耗，复盘达成与获返客户ROI。</p></div></div>
    <section className="panel"><div className="panel-heading"><div><h2>政策达成监控</h2><p>cost6考核、cost4计返；万元口径；忽略过程额外奖励。</p></div>{report && <span className="ai-badge">{report.phase} · 截至{report.asOf}</span>}</div><div className="v2-controls"><label>客户base表<input aria-label="政策base文件" type="file" accept=".xlsx,.csv" disabled={busy} onChange={(event) => setBaseFile(event.target.files[0])} /></label><label>客户每日消耗表<input aria-label="政策消耗文件" type="file" accept=".xlsx,.csv" disabled={busy} onChange={(event) => setCostFile(event.target.files[0])} /></label><button className="button primary" disabled={busy || !baseFile || !costFile} onClick={upload}>{busy ? '正在计算…' : '关联并生成政策复盘'}</button></div><details><summary>政策规则与字段映射（可确认、可修改）</summary><p><a href={NATIONAL_DAY_POLICY.sourceUrl} target="_blank" rel="noreferrer">原始游戏国庆政策</a>；原文示例与明确封顶公式不一致，默认按明确公式计算。</p><textarea aria-label="政策规则JSON" className="policy-editor" value={rulesText} disabled={busy} onChange={(event) => setRulesText(event.target.value)} /><textarea aria-label="政策字段映射JSON" className="policy-editor" value={fieldText} disabled={busy} onChange={(event) => setFieldText(event.target.value)} /><textarea aria-label="政策正文" className="policy-editor" placeholder="其他同类二档增量政策可粘贴正文，由模型提取规则后人工确认" value={policyText} disabled={busy} onChange={(event) => setPolicyText(event.target.value)} /><button className="button secondary" disabled={busy || !policyText.trim()} onClick={() => run(async () => { const result = await post('parse-rules', { text: policyText }); if (result.kind === 'clarify') throw new Error(result.message); setRulesText(JSON.stringify(result.rules, null, 2)) })}>解析粘贴规则（不自动应用）</button></details></section>
    {error && <div role="alert" className="v2-alert">{error}</div>}
    {report && <>
      <section className="panel"><div className="policy-settings"><label>截止日<input aria-label="政策截止日" type="date" min={report.rules.startDate} max={report.rules.endDate} value={asOf} disabled={busy} onChange={(event) => setAsOf(event.target.value)} /></label><label>框架返货率（%）<input aria-label="框架返货率" type="number" min="0" max="100" step="0.1" value={annualRate} disabled={busy} onChange={(event) => setAnnualRate(event.target.value)} /></label><label>渠道返货率（%）<input aria-label="渠道返货率" type="number" min="0" max="100" step="0.1" value={channelRate} disabled={busy} onChange={(event) => setChannelRate(event.target.value)} /></label><label><input aria-label="确认缺行视零" type="checkbox" checked={missingZero} disabled={busy} onChange={(event) => setMissingZero(event.target.checked)} />确认SQL缺行代表零消耗</label><button className="button secondary" disabled={busy} onClick={recalculate}>应用口径并重算</button></div><p>统计分母为全部base名单；缺行未确认时显示观测下界与待核验。框架/渠道按正cost6增量×现金率计返；ROI仅统计政策返货大于0的客户，并汇总同一批客户的增量和三项返货。无政策返货的客户ROI显示「—」。返货/ROI为试算，不等于正式结算。</p><details><summary>数据与政策口径提示（{report.warnings.length}条）</summary>{report.warnings.map((warning, index) => <p className="v2-alert" key={index}>{warning}</p>)}<p>无明细客户：{report.reconciliation.missingCustomers.join('、') || '无'}；缺客户日组合{report.reconciliation.missingCustomerDays}。</p></details></section>
      <section className="panel policy-filters">{Object.entries(dimensions).map(([field, label]) => <label key={field}>{label}<select aria-label={`政策筛选${label}`} value={filters[field] || ''} disabled={busy} onChange={(event) => { setFilters({ ...filters, [field]: event.target.value }); resetChat() }}><option value="">全部</option>{[...new Set(report.customers.map((customer) => customer[field]))].sort().map((value) => <option key={value}>{value}</option>)}</select></label>)}<label>客户名<input aria-label="政策客户搜索" value={search} disabled={busy} onChange={(event) => setSearch(event.target.value)} /></label></section>
      <div className="kpi-grid"><article className="kpi-card accent"><div className="kpi-top">客户数达成率（含二档）</div><strong>{percent(summary.countRate)}</strong><div className="kpi-foot">{summary.hit1Count}/{summary.count} · 二档{summary.hit2Count}</div></article><article className="kpi-card"><div className="kpi-top">base加权达成率</div><strong>{percent(summary.baseWeightedRate)}</strong><div className="kpi-foot">达成客户base / 当前群体base</div></article><article className="kpi-card"><div className="kpi-top">考核消耗cost6（万）</div><strong>{amount(summary.cost6)}</strong><div className="kpi-foot">相对同天数base增速{percent(summary.growth)}</div></article><article className="kpi-card"><div className="kpi-top">cost6净增量（万）</div><strong>{amount(summary.increment)}</strong><div className="kpi-foot">同天数base {amount(summary.baseTotal)}万</div></article><article className="kpi-card"><div className="kpi-top">政策返货试算（万）</div><strong>{amount(summary.policyRebate)}</strong><div className="kpi-foot">仅消耗达成，无过程+1%</div></article><article className="kpi-card"><div className="kpi-top">框架 / 渠道增量返货（万）</div><strong>{amount(summary.annualRebate)} / {amount(summary.channelRebate)}</strong><div className="kpi-foot">正cost6增量 × 现金率 × {percent(report.rules.annualRate)} / {percent(report.rules.channelRate)}</div></article><article className="kpi-card"><div className="kpi-top">获返客户增量ROI</div><strong>{amount(summary.roi)}</strong><div className="kpi-foot">{summary.roiCustomerCount}个政策获返客户 · 增量{amount(summary.roiIncrement)}万 / 返货{amount(summary.roiTotalRebate)}万</div></article><article className="kpi-card"><div className="kpi-top">政策单独ROI / 待核验</div><strong>{amount(summary.policyRoi)} / {summary.unknownCount}</strong><div className="kpi-foot">未确认缺数上界：客户{percent(summary.countRateUpper)} / base{percent(summary.baseWeightedRateUpper)}</div></article></div>
      <div className="dashboard-grid"><section className="panel"><h2>政策期间每日消耗过程</h2><p>当前筛选下已记录cost6；缺行不等于真实零。</p><Chart rows={dailyRows} title="已记录每日cost6消耗" /></section><section className="panel"><div className="panel-heading"><h2>分维度复盘</h2><select aria-label="政策复盘维度" value={groupBy} onChange={(event) => setGroupBy(event.target.value)}>{Object.entries(dimensions).map(([field, label]) => <option value={field} key={field}>{label}</option>)}</select></div><Chart type="bar" rows={grouped.map((group) => ({ label: group.label, value: group.cost6 }))} title={`${dimensions[groupBy]}考核消耗对比`} /></section></div>
      <section className="panel"><h2>{dimensions[groupBy]}达成与ROI</h2><p>消耗、增速和达成率覆盖当前筛选全部客户；ROI仅纳入政策获返客户。</p><GroupTable groups={grouped} /></section>
      <section className="panel"><div className="panel-heading"><h2>客户达成清单（{selected.length}）</h2><select aria-label="政策客户过程" value={customerName} onChange={(event) => setCustomerName(event.target.value)}><option value="">选择客户查看消耗过程</option>{selected.map((customer) => <option key={customer.customer}>{customer.customer}</option>)}</select></div><div className="v2-table-scroll"><table className="v2-table" aria-label="政策客户达成表"><thead><tr>{['客户', '销售', '部门/类型', '档位', '状态', 'base日均', 'cost6', 'cost4', '增速', '返货政策/框架/渠道', '获返客户ROI', '明细天数'].map((label) => <th key={label}>{label}</th>)}</tr></thead><tbody>{selected.map((customer) => <tr key={customer.customer}><td><button className="policy-customer-link" onClick={() => setCustomerName(customer.customer)}>{customer.customer}</button></td><td>{customer.sales}</td><td>{customer.department}/{customer.type}</td><td>{customer.tier}</td><td>{customer.status}</td><td>{amount(customer.baseDaily)}</td><td>{customer.hasConsumption || report.rules.missingAsZero ? amount(customer.cost6) : '—'}</td><td>{customer.hasConsumption || report.rules.missingAsZero ? amount(customer.cost4) : '—'}</td><td>{percent(customer.growth)}</td><td>{amount(customer.policyRebate)}/{amount(customer.annualRebate)}/{amount(customer.channelRebate)}</td><td>{amount(customer.roi)}</td><td>{customer.coverageDays}/{report.elapsedDays}{customer.uncertain ? '待核验' : ''}</td></tr>)}</tbody></table></div></section>
      {focused && <section className="panel"><h2>{focused.customer} · 消耗过程</h2><p>{focused.status}；一档增速门槛{percent(focused.growth1)}，二档{percent(focused.growth2)}；全期一档目标{amount(focused.target1)}万，观测缺口{amount(focused.gap1)}万；二档目标{amount(focused.target2)}万。{report.remainingDays ? `剩余${report.remainingDays}天，一档所需日均${amount(focused.neededDaily1)}万。` : '政策期已结束。'}</p><Chart title={`${focused.customer}已记录每日cost6`} rows={focused.daily.map((day) => ({ label: day.date, value: day.cost6 }))} /><button className="button secondary" disabled={busy} onClick={() => ask(`${focused.customer}这个客户消耗过程冲得怎么样，达成和ROI情况如何？`)}>问这个客户的达成与消耗过程</button></section>}
      <section className="panel"><div className="panel-heading"><h2>销售政策问答</h2><span>{answer?.source === 'wanqing' ? '万擎工具分析' : '数字由本地政策引擎计算'}</span></div><div className="query-box"><input aria-label="政策问答" value={question} disabled={busy} placeholder="例如：lvxiaoqi名下客户达成如何？小游戏ROI是多少？" onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') ask() }} /><button aria-label="发送政策问题" className="query-send" disabled={busy || !question.trim()} onClick={() => ask()}>➜</button></div><div className="suggestions">{['整个政策客户数和base加权达成率是多少？', '不同部门和客户类型的达成与ROI怎么样？', '小游戏的消耗增量和ROI是多少？', '画一下政策每天的消耗过程折线图'].map((item) => <button key={item} disabled={busy} onClick={() => ask(item)}>{item}</button>)}</div>{busy && <p role="status">正在关联、计算或调用模型…</p>}{answer && <><div className="final-answer"><p>{answer.answer}</p></div><p>{answer.detail}</p>{answer.chart && <figure className="chart-figure"><img alt={answer.chart.title} src={answer.chart.publicPath} /><figcaption>图片已保存：{answer.chart.relativePath}</figcaption></figure>}<ol className="agent-steps">{answer.agentSteps?.map((step, index) => <li className={`agent-step ${step.status || ''}`} key={index}><div className="agent-step-index">{index + 1}</div><div><b>{step.title}</b><p>{step.result}</p></div></li>)}</ol></>}<details><summary>最近10条政策对话</summary>{history.map((message, index) => <div className="v2-message" key={index}><b>{message.role === 'user' ? '你' : '政策助手'}</b><p>{message.content}</p></div>)}</details></section>
      <section className="panel"><h2>导出完整政策复盘（当前规则与截止日，包含全部base客户）</h2><div className="heading-actions"><a className="button primary" href="/api/policy/export?format=md">下载Markdown复盘</a><a className="button secondary" href="/api/policy/export?format=csv">下载客户达成CSV</a><a className="button secondary" href="/api/policy/export?format=json">下载完整JSON</a></div></section>
    </>}
  </section>
}
