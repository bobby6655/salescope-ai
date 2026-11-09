import React, { useEffect, useMemo, useRef, useState } from 'react'
import salesCsv from '../data/sales-data.csv?raw'
import ordersCsv from '../data/orders-en.csv?raw'
import adsCsv from '../data/ads-data.csv?raw'
import { parseCsv, prepareDataset, executeQuery, formatValue } from './datasetEngine.js'
import { renderChartSvg } from './chartGenerator.js'
import { evaluationCases } from './evaluationCases.js'
import PolicyPanel from './PolicyPanel.jsx'
import HistoryPanel from './HistoryPanel.jsx'
import DataPreparationPanel from './DataPreparationPanel.jsx'

const samples = { sales: { name: '销售样表', csv: salesCsv }, orders: { name: '英文订单表', csv: ordersCsv }, ads: { name: '广告投放表', csv: adsCsv } }
const initialDataset = parseCsv(salesCsv)
const roles = { revenue: '收入', cost: '成本', quantity: '数量', discount: '折扣', date: '日期', region: '地区', product: '产品', category: '类别', customerType: '客户类型' }
const defaultSelection = (dataset) => ({ metric: dataset.roles.revenue.column || dataset.columns.find((column) => column.type === 'number')?.name || '', date: dataset.roles.date.column || dataset.columns.find((column) => column.type === 'date')?.name || '', dimension: dataset.roles.region.column || dataset.columns.find((column) => column.type === 'string' && column.distinctCount > 1 && column.distinctCount < dataset.rows.length)?.name || '' })

function previewQuery(dataset, selection, groupBy = []) {
  if (!selection.metric) return null
  try { return executeQuery(dataset, { group_by: groupBy, measures: [{ column: selection.metric, aggregate: 'sum' }], filters: [], order: null, limit: null }) } catch (error) { return { error: error.message } }
}

function PreviewChart({ result, title, type }) {
  if (!result || result.error) return <div className="empty-state"><b>暂时无法绘图</b><span>{result?.error || '请选择数值指标和分组字段'}</span></div>
  try {
    const factor = result.unit === 'percent' ? 100 : 1
    const rows = result.rows.map((row) => ({ ...row, value: row.value == null ? NaN : row.value * factor }))
    const svg = renderChartSvg({ type, title, rows, metric: `${result.metric}${result.unit === 'percent' ? '（%）' : result.unit === 'CNY' ? '（元）' : ''}` })
    return <figure className="chart-figure"><img alt={title} src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`} /></figure>
  } catch (error) { return <div className="empty-state"><b>图表不可用</b><span>{error.message}</span></div> }
}

function DataTable({ headers, rows }) {
  return <div className="v2-table-scroll"><table className="v2-table"><thead><tr>{headers.map((name) => <th key={name}>{name}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{headers.map((name) => <td key={name}>{row[name] == null ? '—' : String(row[name])}</td>)}</tr>)}</tbody></table></div>
}

export default function AppV2() {
  const [nav, setNav] = useState(window.location.hash === '#policy' ? '政策监控' : window.location.hash === '#history' ? '历史分析' : '总览')
  useEffect(() => { window.history.replaceState(null, '', nav === '政策监控' ? '#policy' : nav === '历史分析' ? '#history' : window.location.pathname) }, [nav])
  const [signedInUser, setSignedInUser] = useState('')
  const [guest, setGuest] = useState(false)
  const [authReady, setAuthReady] = useState(false)
  const [authError, setAuthError] = useState('')
  useEffect(() => {
    let active = true
    const init = async () => {
      try {
        const response = await fetch('/api/auth/session')
        if (response.ok && response.headers.get('content-type')?.includes('application/json')) { const result = await response.json(); if (active) setSignedInUser(result.user) }
        else if (response.status === 401) {
          const demo = await fetch('/api/demo/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
          const result = await demo.json(); if (!demo.ok) throw new Error(result.error)
          if (active) setGuest(true)
        }
        if (active) setAuthReady(true)
      } catch (failure) { if (active) setAuthError('无法连接服务：' + failure.message) }
    }
    init(); return () => { active = false }
  }, [])
  const logout = async () => { const response=await fetch('/api/auth/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}); if(response.ok || response.status===401)window.location.assign('/login') }
  const [source, setSource] = useState(initialDataset)
  const [fileName, setFileName] = useState('sales-data.csv')
  const [versionId, setVersionId] = useState('')
  const [types, setTypes] = useState({})
  const [bindings, setBindings] = useState({})
  const [selection, setSelection] = useState(defaultSelection(initialDataset))
  const [query, setQuery] = useState('')
  const [history, setHistory] = useState([])
  const [analysis, setAnalysis] = useState(null)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [evaluationRunning, setEvaluationRunning] = useState(false)
  const [evaluations, setEvaluations] = useState([])
  const [savedPath, setSavedPath] = useState('')
  const fileRef = useRef(null)
  const dataset = useMemo(() => prepareDataset(source.rawRows, source.headers, { types, bindings }), [source, types, bindings])
  const numericColumns = dataset.columns.filter((column) => column.type === 'number')
  const dateColumns = dataset.columns.filter((column) => column.type === 'date')
  const active = { metric: numericColumns.some((column) => column.name === selection.metric) ? selection.metric : numericColumns[0]?.name || '', date: dateColumns.some((column) => column.name === selection.date) ? selection.date : '', dimension: dataset.headers.includes(selection.dimension) ? selection.dimension : '' }
  const total = useMemo(() => previewQuery(dataset, active), [dataset, active.metric])
  const trend = useMemo(() => active.date ? previewQuery(dataset, active, [{ column: active.date, time_grain: 'month' }]) : null, [dataset, active.metric, active.date])
  const ranking = useMemo(() => active.dimension ? previewQuery(dataset, active, [{ column: active.dimension }]) : null, [dataset, active.metric, active.dimension])
  const disabled = pending || evaluationRunning || !authReady
  const suggestions = active.metric ? [`「${active.metric}」的合计是多少？`, `按「${active.dimension || dataset.headers[0]}」比较「${active.metric}」，画柱状图。`, ...(active.date ? [`按「${active.date}」的月份汇总「${active.metric}」，画折线图。`] : []), ...(active.date && active.dimension ? [`画每个月「${active.dimension}」的「${active.metric}」堆积柱状图。`, `分析这段时间内「${active.dimension}」的「${active.metric}」变化，比较涨幅、增量贡献和下滑拖累。`] : [])] : ['这张表有多少条记录？', '请查看字段与数据质量。']

  const resetAnalysis = () => { setHistory([]); setAnalysis(null); setError(''); setQuery('') }
  const changeType = (name, type) => {
    if (guest) return
    const nextBindings = { ...bindings }
    for (const role of Object.keys(roles)) {
      const expectedType = role === 'date' ? 'date' : ['revenue', 'cost', 'quantity', 'discount'].includes(role) ? 'number' : 'string'
      if (dataset.roles[role].column === name && type !== expectedType) nextBindings[role] = ''
    }
    setTypes({ ...types, [name]: type }); setBindings(nextBindings); resetAnalysis()
  }
  const useDataset = (next, name) => { setVersionId(''); setSource(next); setFileName(name); setTypes({}); setBindings({}); setSelection(defaultSelection(next)); resetAnalysis(); setNav('数据源') }
  const useVersion = async version => {
    useDataset(prepareDataset(version.table.rows, version.table.headers), version.name)
    setVersionId(version.id); setNav('总览')
  }
  const continueHistory = async id => {
    const response = await fetch('/api/workspaces/versions/' + id), data = await response.json()
    if (!response.ok) throw new Error(data.error)
    await useVersion(data)
  }
  const upload = (event) => {
    const file = event.target.files?.[0]
    if (!file || guest) return
    if (!/\.csv$/i.test(file.name)) { setError('v2 当前支持 UTF-8 CSV 文件'); return }
    const reader = new FileReader()
    reader.onload = () => { try { useDataset(parseCsv(String(reader.result ?? '')), file.name) } catch (failure) { setError(failure.message) } }
    reader.onerror = () => setError('文件读取失败')
    reader.readAsText(file, 'UTF-8')
    event.target.value = ''
  }
  const submit = async (question = query) => {
    if (!question.trim() || disabled) return
    setPending(true); setError('')
    try {
      const response = await fetch(guest ? '/api/demo/assistant' : '/api/assistant', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question, rows: guest ? undefined : source.rawRows, headers: dataset.headers, types, bindings, history, sample: fileName.replace(/\.csv$/, ''), datasetName: fileName, requestId: crypto.randomUUID(), versionId: guest ? undefined : versionId }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || '分析失败')
      setAnalysis(result)
      setHistory((previous) => [...previous, { role: 'user', content: question }, { role: 'assistant', content: result.answer }].slice(-10))
      setQuery(''); setNav('分析报告')
    } catch (failure) { setError(failure.message) } finally { setPending(false) }
  }
  const runEvaluation = async () => {
    if (disabled || guest) return
    setEvaluationRunning(true); setEvaluations([]); setSavedPath(''); setError('')
    const results = []
    try {
      for (const test of evaluationCases) {
        try {
          const sample = parseCsv(samples[test.dataset || 'sales'].csv)
          const response = await fetch('/api/assistant', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: test.question, rows: sample.rawRows, headers: sample.headers, purpose: 'evaluation' }) })
          const result = await response.json()
          const passed = response.ok && ['wanqing', 'openai-compatible'].includes(result.source) && Boolean(test.match(result))
          results.push({ id: test.id, question: test.question, dataset: test.dataset, passed, source: result.source, answer: result.answer || result.error, chart: result.chart, steps: result.agentSteps || [], error: passed ? '' : result.error || '未通过真实模型结果验证' })
        } catch (failure) { results.push({ id: test.id, question: test.question, passed: false, error: failure.message, answer: failure.message }) }
        setEvaluations([...results])
      }
      const passed = results.filter((result) => result.passed).length
      const response = await fetch('/api/evaluation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: 'v2', total: results.length, passed, accuracy: `${passed / results.length * 100}%`, results }) })
      const saved = await response.json()
      if (!response.ok) throw new Error(saved.error)
      setSavedPath(saved.relativePath)
    } catch (failure) { setError(failure.message) } finally { setEvaluationRunning(false) }
  }

  return <div className="app-shell">
    <aside className="sidebar"><div className="brand"><div className="brand-mark">✦</div><div><strong>SaleScope V2</strong><span>UNIVERSAL DATA ANALYTICS</span></div></div><nav className="nav" aria-label="业务模块"><section className="nav-module" aria-label="基础数据分析"><p className="nav-label">基础数据分析</p>{['总览', ...(!guest ? ['数据准备'] : []), '数据源', '分析报告', ...(!guest ? ['自动评测'] : [])].map((item) => <button className={`nav-item ${nav === item ? 'active' : ''}`} aria-current={nav === item ? 'page' : undefined} key={item} onClick={() => setNav(item)}>{item}</button>)}</section><section className="nav-module policy-nav-module" aria-label="政策监控"><p className="nav-label">政策监控</p><button className={`nav-item ${nav === '政策监控' ? 'active' : ''}`} aria-current={nav === '政策监控' ? 'page' : undefined} onClick={() => setNav('政策监控')}>政策达成复盘</button></section><section className="nav-module" aria-label="历史记录"><p className="nav-label">我的记录</p><button className={`nav-item ${nav === '历史分析' ? 'active' : ''}`} onClick={() => setNav('历史分析')}>历史分析{guest ? '（需登录）' : ''}</button></section></nav><div className="sidebar-footer"><div className="help-card"><div><b>通用表格分析</b><span>动态字段 · 本地计算 · ReAct</span></div></div></div></aside>
    <main className="main-content"><header className="topbar"><div className="breadcrumb"><span>SaleScope V2</span><b>/</b><span>{nav === '政策监控' ? '政策监控' : '基础数据分析'}</span><b>/</b><strong>{nav === '政策监控' ? '政策达成复盘' : nav}</strong></div><div className="top-actions"><span className="live-status">{pending ? '正在分析' : '数据已加载'}</span>{guest && <><span className="signed-in-user">游客体验</span><a className="button primary" href="/login">登录</a></>}{signedInUser && <><span className="signed-in-user">{signedInUser}</span><button className="button secondary" onClick={logout}>退出登录</button></>}</div></header><div className="page-container">
      <nav className="v2-mobile-nav" aria-label="移动端业务模块"><section className="mobile-nav-module" aria-label="基础数据分析"><span>基础数据分析</span><div>{['总览', ...(!guest ? ['数据准备'] : []), '数据源', '分析报告', ...(!guest ? ['自动评测'] : [])].map((item) => <button key={item} className={`button ${nav === item ? 'primary' : 'secondary'}`} onClick={() => setNav(item)}>{item}</button>)}</div></section><section className="mobile-nav-module" aria-label="政策监控"><span>政策监控</span><div><button className={`button ${nav === '政策监控' ? 'primary' : 'secondary'}`} onClick={() => setNav('政策监控')}>政策达成复盘</button></div></section><button className="button secondary" onClick={() => setNav('历史分析')}>历史分析</button></nav>
      {!['政策监控', '历史分析', '数据准备'].includes(nav) && <section className="page-heading"><div><div className="eyebrow">V2 · 通用数据分析</div><h1>{nav === '总览' ? '每张表，都能看懂。' : nav === '数据源' ? '字段与口径，由你确认。' : nav === '分析报告' ? '分析过程，可查可追问。' : '跨表结构，验证分析能力。'}</h1><p>支持动态表头、字段类型、聚合分组和多轮工具分析。</p></div><div className="heading-actions"><button className="button secondary" disabled={disabled || guest} onClick={() => fileRef.current?.click()}>上传 CSV</button><input ref={fileRef} type="file" accept=".csv" hidden onChange={upload} /><select aria-label="选择样例数据" className="v2-select" value="" disabled={disabled} onChange={(event) => { const sample = samples[event.target.value]; if (sample) useDataset(parseCsv(sample.csv), `${event.target.value}.csv`) }}><option value="">切换样例表</option>{Object.entries(samples).map(([key, sample]) => <option key={key} value={key}>{sample.name}</option>)}</select></div></section>}
      {!['政策监控', '历史分析', '数据准备'].includes(nav) && <div className="status-strip"><div className="status-message"><span className={`status-dot ${error ? 'error-dot' : ''}`} /><span><b>{fileName}</b><small>{dataset.rows.length} 条记录 · {dataset.headers.length} 个字段 · {dataset.warnings.length ? '有数据质量提示' : '字段类型已识别'}</small></span></div><span>数值字段 {numericColumns.length} · 日期字段 {dateColumns.length}</span></div>}
      {nav === '政策监控' && authReady && <PolicyPanel guest={guest} />}
      {nav === '历史分析' && authReady && <HistoryPanel guest={guest} onContinue={continueHistory} />}
      {nav === '数据准备' && authReady && <DataPreparationPanel guest={guest} onUseVersion={useVersion} />}
      {versionId && !['政策监控', '历史分析', '数据准备'].includes(nav) && <p className="history-saved">正在分析已确认的数据版本，问题使用服务端保存的数据。</p>}
      {!authReady && <p className="v2-alert" role="status">正在连接服务…</p>}
      {authError && <p className="v2-alert" role="alert">{authError}</p>}
      {guest && <p className="v2-alert">游客仅分析模拟数据，结论不长期保存。登录后可上传文件、修改政策并保存历史。</p>}
      {error && <div className="v2-alert" role="alert">{error}</div>}
      {nav === '总览' && <>
        <section className="panel v2-controls"><label>概览指标<select aria-label="概览指标" value={active.metric} disabled={disabled} onChange={(event) => setSelection({ ...selection, metric: event.target.value })}><option value="">无数值指标</option>{numericColumns.map((column) => <option key={column.name}>{column.name}</option>)}</select></label><label>日期字段<select aria-label="日期字段" value={active.date} onChange={(event) => setSelection({ ...selection, date: event.target.value })}><option value="">不显示时间趋势</option>{dateColumns.map((column) => <option key={column.name}>{column.name}</option>)}</select></label><label>比较维度<select aria-label="比较维度" value={active.dimension} onChange={(event) => setSelection({ ...selection, dimension: event.target.value })}><option value="">不分组</option>{dataset.columns.filter((column) => column.type === 'string').map((column) => <option key={column.name}>{column.name}</option>)}</select></label></section>
        <div className="kpi-grid"><article className="kpi-card accent"><div className="kpi-top">{active.metric || '记录数'}合计</div><strong>{total && !total.error ? formatValue(total.value, total.unit) : active.metric ? '—' : dataset.rows.length}</strong><div className="kpi-foot">{total?.error || '当前数据真实计算'}</div></article><article className="kpi-card"><div className="kpi-top">记录数</div><strong>{dataset.rows.length}</strong><div className="kpi-foot">上传表格全部记录</div></article><article className="kpi-card"><div className="kpi-top">字段数</div><strong>{dataset.headers.length}</strong><div className="kpi-foot">无需固定表头</div></article><article className="kpi-card"><div className="kpi-top">重复行</div><strong>{dataset.duplicateCount}</strong><div className="kpi-foot">未自动删除</div></article></div>
        <div className="dashboard-grid"><section className="panel"><div className="panel-heading"><h2>{active.metric || '指标'}月度趋势</h2></div><PreviewChart result={trend} title={`${active.metric}月度趋势`} type="line" /></section><section className="panel"><div className="panel-heading"><h2>{active.dimension || '维度'}对比</h2></div><PreviewChart result={ranking} title={`${active.dimension} · ${active.metric}`} type="bar" /></section></div>
      </>}
      {nav === '数据源' && <>
        <section className="panel"><div className="panel-heading"><h2>字段类型与质量</h2><span>类型可手动确认</span></div><div className="v2-table-scroll"><table className="v2-table"><thead><tr><th>字段</th><th>类型</th><th>空值</th><th>类型异常</th><th>不同值</th><th>样例</th></tr></thead><tbody>{dataset.columns.map((column) => <tr key={column.name}><td>{column.name}</td><td><select aria-label={`${column.name}字段类型`} value={column.type} disabled={disabled || guest} onChange={(event) => changeType(column.name, event.target.value)}><option value="string">文本 / 标识符</option><option value="number">数值</option><option value="date">日期</option></select></td><td>{column.nullCount}</td><td>{column.invalidCount}</td><td>{column.distinctCount}</td><td>{column.samples.join('、')}</td></tr>)}</tbody></table></div>{dataset.warnings.length > 0 && <p className="v2-alert">{dataset.warnings.join('；')}。不会静默删除异常记录。</p>}</section>
        <section className="panel"><div className="panel-heading"><h2>业务含义映射（可选）</h2><span>直接按真实列名提问不需要映射</span></div><div className="v2-role-grid">{Object.entries(roles).map(([role, label]) => <label key={role}>{label}<select aria-label={`${label}字段映射`} value={Object.hasOwn(bindings, role) ? bindings[role] : dataset.roles[role].column || ''} disabled={disabled || guest} onChange={(event) => { setBindings({ ...bindings, [role]: event.target.value }); resetAnalysis() }}><option value="">{dataset.roles[role].ambiguous ? '多个候选，请确认' : '未映射'}</option>{dataset.columns.filter((column) => role === 'date' ? column.type === 'date' : ['revenue', 'cost', 'quantity', 'discount'].includes(role) ? column.type === 'number' : column.type === 'string').map((column) => <option key={column.name}>{column.name}</option>)}</select>{dataset.roles[role].ambiguous && <small>候选：{dataset.roles[role].candidates.join('、')}</small>}</label>)}</div></section>
        <section className="panel"><div className="panel-heading"><h2>数据预览</h2><span>前 20 行</span></div><DataTable headers={dataset.headers} rows={dataset.rows.slice(0, 20)} /></section>
      </>}
      {nav === '分析报告' && <><section className="panel"><div className="panel-heading"><h2>最终答案</h2><span className="ai-badge">{analysis?.source === 'wanqing' ? '万擎模型' : analysis?.source === 'openai-compatible' ? '在线模型' : analysis?.source === 'demo' ? '本地演示' : '等待提问'}</span></div>{analysis ? <>{analysis.historyId && <p className="history-saved">已自动保存到历史分析 <button className="button secondary" onClick={() => setNav('历史分析')}>查看历史</button></p>}{analysis.historyWarning && <p role="alert" className="v2-alert">{analysis.historyWarning}</p>}<div className={`final-answer ${analysis.operation === 'compare' ? 'change-answer' : ''}`}>{String(analysis.answer).split(/\n\n+/).map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div><p>{analysis.detail}</p>{analysis.chart && <figure className="chart-figure"><img alt={analysis.chart.title} src={analysis.chart.publicPath} /><figcaption><a href={analysis.chart.publicPath} target="_blank" rel="noreferrer">{analysis.chart.relativePath}</a></figcaption></figure>}{analysis.table?.length > 0 && <DataTable headers={['分组', ...(analysis.measures ?? []).map((measure) => measure.alias)]} rows={analysis.table.slice(0, 50).map((record) => Object.fromEntries([['分组', record.dimensions.join(' × ') || '全部记录'], ...(analysis.measures ?? []).map((measure) => [measure.alias, formatValue(record.values[measure.alias], measure.unit)])]))} />}{analysis.suggestions?.map((suggestion) => <button className="button secondary" key={suggestion} disabled={disabled} onClick={() => submit(suggestion)}>{suggestion}</button>)}</> : <div className="empty-state">输入问题开始分析，模型会选择查询和绘图工具。</div>}</section><section className="panel"><div className="panel-heading"><h2>工具执行过程</h2></div><ol className="agent-steps">{analysis?.agentSteps?.map((step, index) => <li key={index} className={`agent-step ${step.status || ''}`}><div className="agent-step-index">{index + 1}</div><div><b>{step.title}</b><p>{step.method}</p><small>{step.result}</small></div></li>)}{pending && <li className="agent-step pending">正在调用模型、执行查询或检查图表…</li>}</ol></section><section className="panel"><div className="panel-heading"><h2>最近对话</h2><span>最近 10 条 · 切换数据后重置</span></div>{history.map((message, index) => <div className={`v2-message ${message.role}`} key={index}><b>{message.role === 'user' ? '你' : '分析助手'}</b><p>{message.content}</p></div>)}</section></>}
      {nav === '自动评测' && <section className="panel"><div className="panel-heading"><div><h2>三种表结构回归评测</h2><p>使用销售、英文订单、广告投放样例；回退模式不计为真实模型通过。</p></div><button className="button primary" disabled={disabled} onClick={runEvaluation}>{evaluationRunning ? `正在评测 ${evaluations.length}/${evaluationCases.length}` : '开始评测样例'}</button></div><p>通过 {evaluations.filter((result) => result.passed).length}/{evaluationCases.length}{savedPath ? ` · 已保存 ${savedPath}` : ''}</p>{evaluationCases.map((test, index) => <article className={`evaluation-row ${evaluations[index]?.passed ? 'pass' : evaluations[index] ? 'fail' : ''}`} key={test.id}><span className="evaluation-number">{test.id}</span><div><b>{samples[test.dataset || 'sales'].name}</b><p>{test.question}</p></div><div><span>预期</span><p>{test.expected}</p></div><div><span>{evaluations[index]?.passed ? '通过' : evaluations[index] ? '失败' : '未运行'}</span><p>{evaluations[index]?.answer || '—'}</p></div></article>)}</section>}
      {!['政策监控', '历史分析', '数据准备'].includes(nav) && <><section className="query-box"><input aria-label="询问你的数据" placeholder="指定真实字段提问，也可以继续追问…" value={query} disabled={disabled} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') submit() }} /><button className="query-send" aria-label="发送问题" disabled={disabled || !query.trim()} onClick={() => submit()}>➜</button></section><div className="suggestions">{suggestions.map((question) => <button key={question} disabled={disabled} onClick={() => submit(question)}>{question}</button>)}</div><p className="footer-note">V2 动态字段与本地计算 · CSV 数据 · 图表保存为 SVG</p></>}
    </div></main>
  </div>
}
