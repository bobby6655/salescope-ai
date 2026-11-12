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

export default function PolicyPanel({ guest = false, guided = false, onComplete, onDesign }) {
  const [report, setReport] = useState(null)
  const [step, setStep] = useState(0)
  const [demoMode, setDemoMode] = useState(guided)
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
  useEffect(() => { let active = true; busyRef.current = true; setBusy(true); fetch(`${guest ? '/api/demo/policy/current' : '/api/policy/current'}${demoMode ? '?demo=true' : ''}`).then(async (response) => { const result = await response.json(); if (!response.ok) throw new Error(result.error); if (active) accept(result) }).catch((failure) => { if (active) setError(failure.message) }).finally(() => { if (active) { busyRef.current = false; setBusy(false) } }); return () => { active = false } }, [guest, demoMode])
  const post = async (route, payload) => {
    const response = await fetch(`${guest ? '/api/demo/policy' : '/api/policy'}/${route}${demoMode && route === 'question' ? '?demo=true' : ''}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, requestId: crypto.randomUUID() }) })
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
    const result = await post('import', { base, consumption, rules, fields: JSON.parse(fieldText) }); setDemoMode(false); accept(result); setStep(1)
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

  return <section className="policy-panel"><div className={guided ? 'demo-intro' : 'page-heading'}><div><div className="eyebrow">政策复盘 · 演示体验</div><h1>一眼看懂客户达成，算清激励回报。</h1><p>20个模拟客户、两张配套数据表和激励规则已准备好，跟随步骤体验达成核算与客户分析。</p></div></div>
    {guided && <ol className="demo-steps" aria-label="政策复盘体验步骤">{['了解数据与规则','查看达成与回报','分析客户并导出'].map((label,i)=><li key={label} aria-current={i===step?'step':undefined}><span>{i+1}</span>{label}</li>)}</ol>}
    {guided && step===0 && <section className="panel demo-explainer"><h2>演示材料已准备好</h2><p>base表提供客户的基期日均消耗；每日消耗表记录活动期间的考核消耗与现金消耗。政策根据增长门槛计算返货，并考虑封顶。</p><p>本次模拟周期为2026-09-25至2026-10-07，共13天。覆盖达标、下降、缺数、零现金和返货封顶等情况。</p><p>下一步会看到两种达成率和增量ROI，了解覆盖面与大客户权重的区别。</p></section>}
    {!guest && <details className="demo-options"><summary>使用自己的数据或确认规则</summary>{!guest&&<><button className="button secondary" disabled={busy} onClick={()=>setDemoMode(false)}>查看我的上传数据</button><button className="button secondary" disabled={busy} onClick={()=>setDemoMode(true)}>使用默认模拟演示</button></>}
    <section className="panel"><div className="panel-heading"><div><h2>政策达成监控</h2><p>cost6考核、cost4计返；万元口径；忽略过程额外奖励。</p></div>{report && <span className="ai-badge">{report.phase} · 截至{report.asOf}</span>}</div><div className="v2-controls"><label>客户base表<input aria-label="政策base文件" type="file" accept=".xlsx,.csv" disabled={busy || guest} onChange={(event) => setBaseFile(event.target.files[0])} /></label><label>客户每日消耗表<input aria-label="政策消耗文件" type="file" accept=".xlsx,.csv" disabled={busy || guest} onChange={(event) => setCostFile(event.target.files[0])} /></label><button className="button primary" disabled={busy || !baseFile || !costFile} onClick={upload}>{busy ? '正在计算…' : '关联并生成政策复盘'}</button></div><details><summary>政策规则与字段映射（可确认、可修改）</summary><p>默认提供模拟政策；所有演示客户及消耗均为虚构。上传自己的两表后，按确认的政策规则生成复盘。</p><textarea aria-label="政策规则JSON" className="policy-editor" value={rulesText} disabled={busy || guest} onChange={(event) => setRulesText(event.target.value)} /><textarea aria-label="政策字段映射JSON" className="policy-editor" value={fieldText} disabled={busy || guest} onChange={(event) => setFieldText(event.target.value)} /><textarea aria-label="政策正文" className="policy-editor" placeholder="其他同类二档增量政策可粘贴正文，由模型提取规则后人工确认" value={policyText} disabled={busy || guest} onChange={(event) => setPolicyText(event.target.value)} /><button className="button secondary" disabled={busy || !policyText.trim()} onClick={() => run(async () => { const result = await post('parse-rules', { text: policyText }); if (result.kind === 'clarify') throw new Error(result.message); setRulesText(JSON.stringify(result.rules, null, 2)) })}>解析粘贴规则（不自动应用）</button></details></section></details>}
    {report?.datasetKind === 'demo' && <p className="v2-alert" role="status">当前展示模拟测试数据：20个虚构客户，金额与政策仅用于功能演示。</p>}
    {report?.historyId && <p className="history-saved">本次政策复盘已自动保存到历史分析。</p>}
    {report?.historyWarning && <p className="v2-alert" role="alert">{report.historyWarning}</p>}
    {error && <div role="alert" className="v2-alert">{error}</div>}
    {report && (!guided || step>0) && <>
      <details className="demo-options"><summary>查看完整口径或调整核算参数</summary><section className="panel">{demoMode&&<p>当前是只读模拟演示。要修改自己的核算，请先在上方切换到我的上传数据。</p>}<div className="policy-settings"><label>截止日<input aria-label="政策截止日" type="date" min={report.rules.startDate} max={report.rules.endDate} value={asOf} disabled={busy || guest} onChange={(event) => setAsOf(event.target.value)} /></label><label>框架返货率（%）<input aria-label="框架返货率" type="number" min="0" max="100" step="0.1" value={annualRate} disabled={busy || guest} onChange={(event) => setAnnualRate(event.target.value)} /></label><label>渠道返货率（%）<input aria-label="渠道返货率" type="number" min="0" max="100" step="0.1" value={channelRate} disabled={busy || guest} onChange={(event) => setChannelRate(event.target.value)} /></label><label><input aria-label="确认缺行视零" type="checkbox" checked={missingZero} disabled={busy || guest} onChange={(event) => setMissingZero(event.target.checked)} />确认SQL缺行代表零消耗</label><button className="button secondary" disabled={busy || guest || demoMode} onClick={recalculate}>应用口径并重算</button></div><p>统计分母为全部base名单；缺行未确认时显示观测下界与待核验。框架/渠道按正cost6增量×现金率计返；ROI仅统计政策返货大于0的客户，并汇总同一批客户的增量和三项返货。无政策返货的客户ROI显示「—」。返货/ROI为试算，不等于正式结算。</p><details><summary>数据与政策口径提示（{report.warnings.length}条）</summary>{report.warnings.map((warning, index) => <p className="v2-alert" key={index}>{warning}</p>)}<p>无明细客户：{report.reconciliation.missingCustomers.join('、') || '无'}；缺客户日组合{report.reconciliation.missingCustomerDays}。</p></details></section>
      </details><details className="demo-options"><summary>按销售、部门或客户筛选</summary><section className="panel policy-filters">{Object.entries(dimensions).map(([field, label]) => <label key={field}>{label}<select aria-label={`政策筛选${label}`} value={filters[field] || ''} disabled={busy} onChange={(event) => { setFilters({ ...filters, [field]: event.target.value }); resetChat() }}><option value="">全部</option>{[...new Set(report.customers.map((customer) => customer[field]))].sort().map((value) => <option key={value}>{value}</option>)}</select></label>)}<label>客户名<input aria-label="政策客户搜索" value={search} disabled={busy} onChange={(event) => setSearch(event.target.value)} /></label></section>
      </details><div className="kpi-grid"><article className="kpi-card accent"><div className="kpi-top">客户数达成率（含二档）</div><strong>{percent(summary.countRate)}</strong><div className="kpi-foot">{summary.hit1Count}/{summary.count} · 二档{summary.hit2Count}</div></article><article className="kpi-card"><div className="kpi-top">base加权达成率</div><strong>{percent(summary.baseWeightedRate)}</strong><div className="kpi-foot">达成客户base / 当前群体base</div></article><article className="kpi-card"><div className="kpi-top">考核消耗cost6（万）</div><strong>{amount(summary.cost6)}</strong><div className="kpi-foot">相对同天数base增速{percent(summary.growth)}</div></article><article className="kpi-card"><div className="kpi-top">cost6净增量（万）</div><strong>{amount(summary.increment)}</strong><div className="kpi-foot">同天数base {amount(summary.baseTotal)}万</div></article><article className="kpi-card"><div className="kpi-top">政策返货试算（万）</div><strong>{amount(summary.policyRebate)}</strong><div className="kpi-foot">仅消耗达成，无过程+1%</div></article><article className="kpi-card"><div className="kpi-top">框架 / 渠道增量返货（万）</div><strong>{amount(summary.annualRebate)} / {amount(summary.channelRebate)}</strong><div className="kpi-foot">正cost6增量 × 现金率 × {percent(report.rules.annualRate)} / {percent(report.rules.channelRate)}</div></article><article className="kpi-card"><div className="kpi-top">获返客户增量ROI</div><strong>{amount(summary.roi)}</strong><div className="kpi-foot">{summary.roiCustomerCount}个政策获返客户 · 增量{amount(summary.roiIncrement)}万 / 返货{amount(summary.roiTotalRebate)}万</div></article><article className="kpi-card"><div className="kpi-top">政策单独ROI / 待核验</div><strong>{amount(summary.policyRoi)} / {summary.unknownCount}</strong><div className="kpi-foot">未确认缺数上界：客户{percent(summary.countRateUpper)} / base{percent(summary.baseWeightedRateUpper)}</div></article></div>
      {(!guided || step===2) && <><div className="dashboard-grid"><section className="panel"><h2>政策期间每日消耗过程</h2><p>当前筛选下已记录cost6；缺行不等于真实零。</p><Chart rows={dailyRows} title="已记录每日cost6消耗" /></section><section className="panel"><div className="panel-heading"><h2>分维度复盘</h2><select aria-label="政策复盘维度" value={groupBy} onChange={(event) => setGroupBy(event.target.value)}>{Object.entries(dimensions).map(([field, label]) => <option value={field} key={field}>{label}</option>)}</select></div><Chart type="bar" rows={grouped.map((group) => ({ label: group.label, value: group.cost6 }))} title={`${dimensions[groupBy]}考核消耗对比`} /></section></div>
      <section className="panel"><h2>{dimensions[groupBy]}达成与ROI</h2><p>消耗、增速和达成率覆盖当前筛选全部客户；ROI仅纳入政策获返客户。</p><GroupTable groups={grouped} /></section>
      <section className="panel"><div className="panel-heading"><h2>客户达成清单（{selected.length}）</h2><select aria-label="政策客户过程" value={customerName} onChange={(event) => setCustomerName(event.target.value)}><option value="">选择客户查看消耗过程</option>{selected.map((customer) => <option key={customer.customer}>{customer.customer}</option>)}</select></div><div className="v2-table-scroll"><table className="v2-table" aria-label="政策客户达成表"><thead><tr>{['客户', '销售', '部门/类型', '档位', '状态', 'base日均', 'cost6', 'cost4', '增速', '返货政策/框架/渠道', '获返客户ROI', '明细天数'].map((label) => <th key={label}>{label}</th>)}</tr></thead><tbody>{selected.map((customer) => <tr key={customer.customer}><td><button className="policy-customer-link" onClick={() => setCustomerName(customer.customer)}>{customer.customer}</button></td><td>{customer.sales}</td><td>{customer.department}/{customer.type}</td><td>{customer.tier}</td><td>{customer.status}</td><td>{amount(customer.baseDaily)}</td><td>{customer.hasConsumption || report.rules.missingAsZero ? amount(customer.cost6) : '—'}</td><td>{customer.hasConsumption || report.rules.missingAsZero ? amount(customer.cost4) : '—'}</td><td>{percent(customer.growth)}</td><td>{amount(customer.policyRebate)}/{amount(customer.annualRebate)}/{amount(customer.channelRebate)}</td><td>{amount(customer.roi)}</td><td>{customer.coverageDays}/{report.elapsedDays}{customer.uncertain ? '待核验' : ''}</td></tr>)}</tbody></table></div></section>
      {focused && <section className="panel"><h2>{focused.customer} · 消耗过程</h2><p>{focused.status}；一档增速门槛{percent(focused.growth1)}，二档{percent(focused.growth2)}；全期一档目标{amount(focused.target1)}万，观测缺口{amount(focused.gap1)}万；二档目标{amount(focused.target2)}万。{report.remainingDays ? `剩余${report.remainingDays}天，一档所需日均${amount(focused.neededDaily1)}万。` : '政策期已结束。'}</p><Chart title={`${focused.customer}已记录每日cost6`} rows={focused.daily.map((day) => ({ label: day.date, value: day.cost6 }))} /><button className="button secondary" disabled={busy} onClick={() => ask(`${focused.customer}这个客户消耗过程冲得怎么样，达成和ROI情况如何？`)}>问这个客户的达成与消耗过程</button></section>}
      <section className="panel"><div className="panel-heading"><h2>销售政策问答</h2><span>{answer?.source === 'wanqing' ? '万擎工具分析' : answer?.source === 'openai-compatible' ? '在线模型工具分析' : '数字由本地政策引擎计算'}</span></div><div className="query-box"><input aria-label="政策问答" value={question} disabled={busy} placeholder="例如：模拟销售甲名下客户达成如何？小游戏ROI是多少？" onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') ask() }} /><button aria-label="发送政策问题" className="query-send" disabled={busy || !question.trim()} onClick={() => ask()}>➜</button></div><div className="suggestions">{['整个政策客户数和base加权达成率是多少？', '不同部门和客户类型的达成与ROI怎么样？', '小游戏的消耗增量和ROI是多少？', '画一下政策每天的消耗过程折线图'].map((item) => <button key={item} disabled={busy} onClick={() => ask(item)}>{item}</button>)}</div>{busy && <p role="status">正在关联、计算或调用模型…</p>}{answer && <>{answer.historyId && <p className="history-saved">本次政策分析已保存到历史。</p>}{answer.historyWarning && <p className="v2-alert" role="alert">{answer.historyWarning}</p>}<div className="final-answer"><p>{answer.answer}</p></div><p>{answer.detail}</p>{answer.chart && <figure className="chart-figure"><img alt={answer.chart.title} src={answer.chart.publicPath} /><figcaption>图片已保存：{answer.chart.relativePath}</figcaption></figure>}<ol className="agent-steps">{answer.agentSteps?.map((step, index) => <li className={`agent-step ${step.status || ''}`} key={index}><div className="agent-step-index">{index + 1}</div><div><b>{step.title}</b><p>{step.result}</p></div></li>)}</ol></>}<details><summary>最近10条政策对话</summary>{history.map((message, index) => <div className="v2-message" key={index}><b>{message.role === 'user' ? '你' : '政策助手'}</b><p>{message.content}</p></div>)}</details></section>
      <section className="panel"><h2>导出完整政策复盘（当前规则与截止日，包含全部base客户）</h2><div className="heading-actions"><a className="button primary" href={`${guest ? '/api/demo/policy' : '/api/policy'}/export?format=md${demoMode ? '&demo=true' : ''}`}>下载Markdown复盘</a><a className="button secondary" href={`${guest ? '/api/demo/policy' : '/api/policy'}/export?format=csv${demoMode ? '&demo=true' : ''}`}>下载客户达成CSV</a><a className="button secondary" href={`${guest ? '/api/demo/policy' : '/api/policy'}/export?format=json${demoMode ? '&demo=true' : ''}`}>下载完整JSON</a></div></section>
      </>}
    </>}
    {guided && <section className="demo-flow-actions">{step>0&&<button className="button secondary" disabled={busy} onClick={()=>setStep(step-1)}>上一步</button>}{step===0&&<button className="button primary" disabled={busy||!report} onClick={()=>setStep(1)}>下一步：查看达成与回报</button>}{step===1&&<button className="button primary" disabled={busy} onClick={()=>setStep(2)}>下一步：分析客户与消耗过程</button>}{step===2&&<><button className="button primary" onClick={onComplete}>完成体验，返回数据分析</button>{!guest&&onDesign&&<details className="demo-options"><summary>进一步设计政策</summary><button className="button secondary" onClick={onDesign}>进入政策设计工作台</button></details>}</>}</section>}
  </section>
}
