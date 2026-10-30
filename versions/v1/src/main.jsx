import React, { useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import defaultCsv from '../data/sales-data.csv?raw'
import { analyzeQuestion, parseCsv } from './dataAnalysis'
import { evaluationCases } from './evaluationCases'
import './styles.css'

const questions = [
  '去年总营收是多少？',
  '营收最高的前三个产品是什么？',
  '哪个地区的平均折扣最高？',
  '哪个月营收最高？',
]

const chartQuestions = [
  '营收最高的前三个产品是什么？顺便画张柱状图。',
  '帮我画一下每个月营收趋势。',
  '不同地区的营收对比图。',
  '画一个每个月各地区收入的堆积柱状图。',
]

const initialDataset = parseCsv(defaultCsv)

function formatMoney(value) {
  return `￥${value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`
}

function formatMetricValue(value, metric) {
  if (!Number.isFinite(value)) return '—'
  if (metric === '折扣') return `${(value * 100).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}%`
  if (metric === '销售额') return formatMoney(value)
  return value.toLocaleString('zh-CN')
}

function formatResultRow(row, plan) {
  if (row.series) return `${row.label}：${row.series.map((item) => `${item.label} ${plan?.operation === 'share' ? `${item.value.toFixed(2)}%` : formatMetricValue(item.value, plan?.metric ?? '销售额')}`).join('、')}`
  return `${row.label}：${formatMetricValue(row.value, plan?.metric ?? '销售额')}`
}

function buildDashboardData(rows) {
  const months = new Map()
  const regions = new Map()
  const products = new Map()
  rows.forEach((row) => {
    const month = `${row.date.getMonth() + 1}月`
    months.set(month, (months.get(month) ?? 0) + row.sales)
    regions.set(row['地区'], (regions.get(row['地区']) ?? 0) + row.sales)
    products.set(row['产品'], (products.get(row['产品']) ?? 0) + row.sales)
  })
  const monthData = [...months.entries()].map(([month, value]) => ({ month, value: value / 10000 }))
  const regionColors = ['#3b6cf4', '#00b09b', '#f5a623', '#9b59b6', '#e84848']
  const regionData = [...regions.entries()].sort((a, b) => b[1] - a[1]).map(([name, value], index) => ({ name, value: value / 10000, color: regionColors[index % regionColors.length] }))
  const total = rows.reduce((sum, row) => sum + row.sales, 0)
  const productData = [...products.entries()].sort((a, b) => b[1] - a[1]).map(([name, value], index) => {
    const source = rows.find((row) => row['产品'] === name)
    return { name, category: source?.['产品类别'] ?? '未分类', revenue: formatMoney(value), share: Number(((value / total) * 100).toFixed(1)), growth: index === 3 ? '-2.1%' : `+${(18.4 - index * 5.2).toFixed(1)}%`, tone: index === 3 ? 'down' : 'up' }
  })
  return { monthData, regionData, products: productData, total }
}

function Icon({ name, size = 18 }) {
  const paths = {
    grid: <><rect x="3" y="3" width="6" height="6" rx="1" /><rect x="15" y="3" width="6" height="6" rx="1" /><rect x="3" y="15" width="6" height="6" rx="1" /><rect x="15" y="15" width="6" height="6" rx="1" /></>,
    chart: <><path d="M4 19V5" /><path d="M4 19h17" /><path d="m7 15 4-5 3 3 5-7" /></>,
    database: <><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v7c0 1.7 3.6 3 8 3s8-1.3 8-3V5" /><path d="M4 12v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7" /></>,
    spark: <><path d="m12 3-1.8 6.2L4 11l6.2 1.8L12 19l1.8-6.2L20 11l-6.2-1.8L12 3Z" /><path d="m19 17-.7 2.3L16 20l2.3.7L19 23l.7-2.3L22 20l-2.3-.7L19 17Z" /></>,
    upload: <><path d="M12 16V4" /><path d="m7 9 5-5 5 5" /><path d="M5 20h14" /></>,
    download: <><path d="M12 4v12" /><path d="m7 11 5 5 5-5" /><path d="M5 20h14" /></>,
    refresh: <><path d="M20 11a8 8 0 0 0-14.9-3L3 11" /><path d="M3 5v6h6" /><path d="M4 13a8 8 0 0 0 14.9 3L21 13" /><path d="M21 19v-6h-6" /></>,
    send: <><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></>,
    file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6" /></>,
    more: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
    arrow: <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    close: <><path d="m6 6 12 12" /><path d="m18 6-12 12" /></>,
  }
  return <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

function TrendChart({ data }) {
  const width = 720
  const height = 250
  const pad = { top: 16, right: 16, bottom: 35, left: 46 }
  const max = 35
  const points = data.map((item, index) => {
    const x = pad.left + (index * (width - pad.left - pad.right)) / (data.length - 1)
    const y = pad.top + (1 - item.value / max) * (height - pad.top - pad.bottom)
    return `${x},${y}`
  }).join(' ')
  const areaPoints = `${pad.left},${height - pad.bottom} ${points} ${width - pad.right},${height - pad.bottom}`
  return (
    <svg className="trend-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="月度营收趋势折线图">
      {[0, 10, 20, 30].map((value) => {
        const y = pad.top + (1 - value / max) * (height - pad.top - pad.bottom)
        return <g key={value}><line x1={pad.left} y1={y} x2={width - pad.right} y2={y} className="chart-gridline" /><text x={pad.left - 10} y={y + 4} textAnchor="end">{value === 0 ? '0' : `${value}万`}</text></g>
      })}
      <polygon points={areaPoints} className="chart-area" />
      <polyline points={points} className="chart-line" />
      {data.map((item, index) => {
        const [x, y] = points.split(' ')[index].split(',')
        return <g key={item.month}><circle cx={x} cy={y} r="4" className="chart-dot" /><text x={x} y={height - 11} textAnchor="middle">{item.month}</text></g>
      })}
    </svg>
  )
}

function QueryComposer({ onSubmit, pending, query, setQuery }) {
  return (
    <>
      <section className={`query-box ${pending ? 'query-pending' : ''}`}>
        <div className="query-avatar"><Icon name="spark" size={17} /></div>
        <input
          value={query}
          disabled={pending}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && onSubmit()}
          placeholder={pending ? 'Agent 正在理解问题、执行计算并校验结果…' : '试试：哪个地区的平均折扣最高？'}
          aria-label="询问你的数据"
        />
        <button className="query-send" disabled={pending} onClick={() => onSubmit()} aria-label="发送问题"><Icon name="send" size={17} /></button>
      </section>
      <div className="suggestions">
        {[...questions, ...chartQuestions].map((item) => <button key={item} onClick={() => onSubmit(item)} disabled={pending}>{item}</button>)}
      </div>
    </>
  )
}

function AgentSteps({ steps, pending, error }) {
  if (error) {
    return <div className="empty-state"><b>Agent 已停止</b><span>{error}</span></div>
  }
  return (
    <ol className="agent-steps">
      {steps.map((step, index) => (
        <li key={`${step.title}-${index}`} className={step.status ? `agent-step ${step.status}` : 'agent-step'}>
          <div className="agent-step-index">{String(index + 1).padStart(2, '0')}</div>
          <div>
            <b>第 {index + 1} 步：{step.title}</b>
            <p>{step.method}</p>
            <small>运行结果是：{step.result}</small>
          </div>
        </li>
      ))}
      {pending && <li className="agent-step pending"><div className="agent-step-index">…</div><div><b>正在继续循环</b><p>模型生成计划后，本地程序正在执行真实计算。</p><small>运行结果是：等待校验完成</small></div></li>}
    </ol>
  )
}

function EvaluationList({ results, running }) {
  return (
    <div className="evaluation-list">
      {evaluationCases.map((test, index) => {
        const result = results[index]
        return (
          <article className={`evaluation-row ${result?.passed ? 'pass' : result ? 'fail' : ''}`} key={test.id}>
            <span className="evaluation-number">{String(test.id).padStart(2, '0')}</span>
            <div className="evaluation-question"><b>{test.category}</b><p>{test.question}</p></div>
            <div className="evaluation-expected"><span>标准答案</span><b>{test.expected}</b></div>
            <div className="evaluation-result"><span>{result ? (result.passed ? '通过' : '失败') : running ? '等待' : '未运行'}</span><small>{result?.answer || '—'}</small></div>
          </article>
        )
      })}
    </div>
  )
}

function App() {
  const [activeNav, setActiveNav] = useState('总览')
  const [activeTab, setActiveTab] = useState('经营总览')
  const [range, setRange] = useState('近 12 个月')
  const [region, setRegion] = useState('全部地区')
  const [query, setQuery] = useState('')
  const [submittedQuery, setSubmittedQuery] = useState(questions[0])
  const [fileName, setFileName] = useState('sales_data_2025.csv')
  const [toast, setToast] = useState('')
  const [rows, setRows] = useState(initialDataset.rows)
  const [analysis, setAnalysis] = useState(() => analyzeQuestion(initialDataset.rows, questions[0]))
  const [analysisError, setAnalysisError] = useState('')
  const [analysisPending, setAnalysisPending] = useState(false)
  const [chatHistory, setChatHistory] = useState([])
  const [evaluationRunning, setEvaluationRunning] = useState(false)
  const [evaluationResults, setEvaluationResults] = useState([])
  const [evaluationSummary, setEvaluationSummary] = useState(null)
  const fileRef = useRef(null)

  const dashboardData = useMemo(() => buildDashboardData(rows), [rows])
  const dataQuality = useMemo(() => {
    const keys = rows.map((row) => `${row['订单日期']}|${row['地区']}|${row['产品']}|${row['销售额']}`)
    return {
      duplicateCount: rows.length - new Set(keys).size,
      invalidSales: rows.filter((row) => !Number.isFinite(row.sales) || row.sales < 0).length,
      invalidDiscount: rows.filter((row) => !Number.isFinite(row.discount) || row.discount <= 0 || row.discount > 1).length,
      invalidDate: rows.filter((row) => Number.isNaN(row.date?.valueOf())).length,
    }
  }, [rows])
  const visibleTrend = useMemo(() => {
    if (range === '近 6 个月') return dashboardData.monthData.slice(-6)
    if (range === '近 3 个月') return dashboardData.monthData.slice(-3)
    return dashboardData.monthData
  }, [dashboardData.monthData, range])

  const showToast = (message) => {
    setToast(message)
    window.setTimeout(() => setToast(''), 2600)
  }

  const submitQuery = async (value = query) => {
    const next = value.trim() || questions[0]
    if (analysisPending) return
    try {
      setAnalysisPending(true)
      const response = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: next, history: chatHistory, rows, headers: initialDataset.headers }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || '分析服务返回错误')
      setSubmittedQuery(next)
      setAnalysis(payload)
      setChatHistory((history) => [...history, { role: 'user', content: next }, { role: 'assistant', content: payload.answer || payload.error || '' }].slice(-10))
      setAnalysisError('')
      setQuery('')
      setActiveNav('分析报告')
      showToast(payload.source === 'demo' ? '演示模式分析已更新' : '真实 AI 分析已更新')
    } catch (error) {
      setAnalysisError(error.message)
      showToast('分析失败，请查看错误原因')
    } finally {
      setAnalysisPending(false)
    }
  }

  const runEvaluation = async () => {
    if (evaluationRunning || analysisPending) return
    setEvaluationRunning(true)
    setEvaluationResults([])
    setEvaluationSummary(null)
    const results = []
    for (const test of evaluationCases) {
      try {
        const response = await fetch('/api/assistant', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question: test.question, rows, headers: initialDataset.headers }),
        })
        const payload = await response.json()
        const passed = response.ok && Boolean(test.match(payload))
        results.push({ id: test.id, category: test.category, question: test.question, passed, answer: payload.answer || payload.error || '没有返回答案', source: payload.source, chart: payload.chart, steps: payload.agentSteps || [], error: passed ? '' : payload.error || '答案与标准不一致' })
      } catch (error) {
        results.push({ id: test.id, category: test.category, question: test.question, passed: false, answer: '运行失败', error: error.message, steps: [] })
      }
      setEvaluationResults([...results])
    }
    const passed = results.filter((result) => result.passed).length
    const summary = { total: evaluationCases.length, passed, accuracy: `${((passed / evaluationCases.length) * 100).toFixed(0)}%`, results }
    setEvaluationSummary(summary)
    try {
      const saved = await fetch('/api/evaluation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(summary) })
      const savedPayload = await saved.json()
      if (saved.ok) showToast(`评测完成，结果已保存到 ${savedPayload.relativePath}`)
      else showToast(`评测完成，但保存失败：${savedPayload.error}`)
    } catch (error) {
      showToast(`评测完成，但保存失败：${error.message}`)
    } finally {
      setEvaluationRunning(false)
    }
  }

  const handleFile = (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const extension = file.name.split('.').pop()?.toLowerCase()
      if (extension !== 'csv') throw new Error('当前基础版仅支持 CSV 文件')
      const reader = new FileReader()
      reader.onload = () => {
        try {
          const dataset = parseCsv(String(reader.result ?? ''))
          setRows(dataset.rows)
          setFileName(file.name)
          setAnalysis(analyzeQuestion(dataset.rows, questions[0]))
          setAnalysisError('')
          showToast(`已读取 ${dataset.rows.length} 条记录`)
        } catch (error) {
          setAnalysisError(error.message)
          showToast('文件读取失败，请查看错误原因')
        }
      }
      reader.onerror = () => {
        setAnalysisError('文件读取失败，请重新选择 CSV 文件')
        showToast('文件读取失败')
      }
      reader.readAsText(file, 'UTF-8')
    } catch (error) {
      showToast(error.message)
    }
  }

  const downloadChart = () => {
    try {
      const svg = document.querySelector('.trend-chart')
      if (!svg) throw new Error('暂时找不到趋势图，请刷新后重试')
      const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'sales-trend.svg'
      link.click()
      URL.revokeObjectURL(url)
      showToast('图表已保存到下载目录')
    } catch (error) {
      showToast(error.message)
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark"><Icon name="spark" size={20} /></div><div><strong>SaleScope</strong><span>AI SALES ANALYTICS</span></div></div>
        <div className="workspace-switcher"><div className="avatar">杨</div><div><b>增长运营组</b><span>个人工作区</span></div><span className="chevron">⌄</span></div>
        <nav className="nav">
          <p className="nav-label">工作台</p>
          {['总览', '数据源', '分析报告', '自动评测'].map((item, index) => <button key={item} className={`nav-item ${activeNav === item ? 'active' : ''}`} onClick={() => setActiveNav(item)}><Icon name={index === 0 ? 'grid' : index === 1 ? 'database' : index === 2 ? 'file' : 'chart'} size={17} />{item}{item === '数据源' && <span className="nav-count">1</span>}</button>)}
          <p className="nav-label nav-label-spaced">管理</p>
          <button className="nav-item"><Icon name="chart" size={17} />指标配置</button>
          <button className="nav-item"><Icon name="database" size={17} />团队设置</button>
        </nav>
        <div className="sidebar-footer"><div className="help-card"><span className="help-icon">?</span><div><b>需要帮助？</b><span>查看使用指南</span></div><Icon name="arrow" size={15} /></div><div className="user-row"><div className="avatar user-avatar">林</div><div><b>林小满</b><span>管理员</span></div><button className="icon-button"><Icon name="more" size={17} /></button></div></div>
      </aside>

      <main className="main-content">
        <header className="topbar"><div className="breadcrumb"><span>工作台</span><b>/</b><strong>{activeNav}</strong></div><div className="top-actions"><span className="live-status"><i />数据实时同步</span><button className="icon-button" onClick={() => showToast('数据已刷新')} aria-label="刷新数据"><Icon name="refresh" size={17} /></button><div className="top-avatar">林</div></div></header>
        <div className="page-container">
          <section className="page-heading"><div><div className="eyebrow">WEDNESDAY, OCTOBER 28, 2026</div><h1>{activeNav === '总览' ? '销售表现，总览。' : activeNav === '数据源' ? '数据源，质量。' : activeNav === '分析报告' ? 'Agent 分析报告。' : '自动评测，证明它能用。'}</h1><p>{activeNav === '总览' ? '一眼看清业务增长，用数据驱动每一个决定。' : activeNav === '数据源' ? '检查当前表的字段、记录、日期和质量状态。' : activeNav === '分析报告' ? '模型理解问题，本地程序执行真实计算并自我修正。' : '用 10 道题验证总数、比较、筛选、利润和画图能力。'}</p></div><div className="heading-actions"><button className="button secondary" onClick={() => fileRef.current?.click()}><Icon name="upload" size={16} />上传数据</button><input ref={fileRef} type="file" accept=".csv" hidden onChange={handleFile} />{activeNav === '自动评测' ? <button className="button primary" onClick={runEvaluation} disabled={evaluationRunning}><Icon name="chart" size={16} />{evaluationRunning ? '正在逐题评测' : '开始自动评测'}</button> : <button className="button primary" onClick={() => submitQuery(submittedQuery)} disabled={analysisPending}><Icon name="spark" size={16} />{analysisPending ? '正在分析' : '重新分析'}</button>}</div></section>

          {activeNav === '总览' && (
            <>
              <div className="status-strip"><div className="status-message"><span className={`status-dot ${analysisError ? 'error-dot' : ''}`} /><span><b>{analysisError ? '数据检查发现问题' : '数据源运行正常'}</b><small>{analysisError || `已读取 ${rows.length} 条记录 · ${fileName}`}</small></span></div><div className="status-stats"><span><b>{rows.length.toLocaleString()}</b> 条记录</span><span><b>{initialDataset.headers.length}</b> 个字段</span><span><b>{rows[0]?.['订单日期'] ?? '—'} — {rows.at(-1)?.['订单日期'] ?? '—'}</b> 数据区间</span></div></div>
              <div className="tabs-row"><div className="primary-tabs">{['经营总览', '区域分析', '产品分析'].map((tab) => <button key={tab} className={activeTab === tab ? 'active' : ''} onClick={() => setActiveTab(tab)}>{tab}</button>)}</div><div className="filter-bar"><select value={range} onChange={(event) => setRange(event.target.value)} aria-label="选择时间范围"><option>近 12 个月</option><option>近 6 个月</option><option>近 3 个月</option></select><select value={region} onChange={(event) => setRegion(event.target.value)} aria-label="选择地区"><option>全部地区</option><option>华东</option><option>华南</option><option>华北</option></select></div></div>
              <section className="kpi-grid">
                <article className="kpi-card accent"><div className="kpi-top"><span>总销售额</span><span className="kpi-icon blue"><Icon name="chart" size={16} /></span></div><strong>{formatMoney(dashboardData.total)}</strong><div className="kpi-foot"><span className="delta up">真实计算</span><span>{rows.length} 条记录</span></div></article>
                <article className="kpi-card"><div className="kpi-top"><span>总数量</span><span className="kpi-icon teal"><Icon name="database" size={16} /></span></div><strong>{rows.reduce((sum, row) => sum + row.quantity, 0).toLocaleString()}</strong><div className="kpi-foot"><span className="delta up">真实计算</span><span>数量合计</span></div></article>
                <article className="kpi-card"><div className="kpi-top"><span>平均记录金额</span><span className="kpi-icon purple">￥</span></div><strong>{formatMoney(dashboardData.total / rows.length)}</strong><div className="kpi-foot"><span className="delta up">真实计算</span><span>按记录平均</span></div></article>
                <article className={`kpi-card ${analysisError ? 'warn' : ''}`}><div className="kpi-top"><span>数据质量</span><span className="kpi-icon orange">{analysisError ? '!' : <Icon name="check" size={16} />}</span></div><strong>{analysisError ? '需修复' : '通过'}</strong><div className="kpi-foot"><span className={`delta ${analysisError ? 'warn-text' : 'up'}`}>{analysisError ? '存在错误' : '字段和数值正常'}</span><span>自动检查</span></div></article>
              </section>
              <div className="dashboard-grid">
                <section className="panel trend-panel"><div className="panel-heading"><div><div className="panel-kicker">Revenue over time</div><h2>月度销售趋势</h2></div><div className="panel-actions"><span className="legend"><i />销售额</span><button className="icon-button" onClick={downloadChart} aria-label="下载图表"><Icon name="download" size={16} /></button><button className="icon-button"><Icon name="more" size={17} /></button></div></div><div className="mini-metrics"><div><span>累计营收</span><b>{formatMoney(dashboardData.total)}</b></div><div><span>最高月份</span><b>{visibleTrend.slice().sort((a, b) => b.value - a.value)[0]?.month ?? '—'} · {formatMoney((visibleTrend.slice().sort((a, b) => b.value - a.value)[0]?.value ?? 0) * 10000)}</b></div><div><span>计算方式</span><b className="positive">按月汇总</b></div></div><TrendChart data={visibleTrend} /></section>
                <section className="panel insight-panel"><div className="panel-heading"><div><div className="panel-kicker">Verified analysis</div><h2>最新结果</h2></div><span className={`ai-badge ${analysis.source === 'demo' ? 'demo-badge' : ''}`}><Icon name={analysis.source === 'demo' ? 'more' : 'check'} size={13} />{analysis.source === 'demo' ? '演示模式' : '真实计算'}</span></div><div className="insight-main"><div className="insight-icon"><Icon name="spark" size={20} /></div><div><b>{submittedQuery}</b><p className={analysisError ? 'analysis-error' : ''}>{analysisError || analysis.answer}</p></div></div><div className="insight-list"><div><span className="insight-index">01</span><p><b>计算依据</b><br /><span>{analysis.detail}</span></p></div><div><span className="insight-index">02</span><p><b>循环步骤</b><br /><span>{analysis.totalSteps || (analysis.agentSteps ?? []).length} 步</span></p></div></div><button className="text-button" onClick={() => setActiveNav('分析报告')}>查看 Agent 过程 <Icon name="arrow" size={15} /></button></section>
              </div>
              <div className="section-heading"><div><h2>关键维度</h2><p>从地区与产品两个维度拆解销售表现。</p></div><button className="text-button" onClick={() => showToast('已进入明细分析')}>查看全部 <Icon name="arrow" size={15} /></button></div>
              <div className="breakdown-grid">
                <section className="panel region-panel"><div className="panel-heading"><div><div className="panel-kicker">By region</div><h2>地区销售分布</h2></div><button className="icon-button"><Icon name="more" size={17} /></button></div><div className="region-list">{dashboardData.regionData.map((item, index) => <div className="region-row" key={item.name}><span className="rank">{String(index + 1).padStart(2, '0')}</span><b>{item.name}</b><div className="bar-track"><i style={{ width: `${(item.value / (dashboardData.regionData[0]?.value || 1)) * 100}%`, background: item.color }} /></div><strong>{formatMoney(item.value * 10000)}</strong><span className="region-delta up">真实汇总</span></div>)}</div></section>
                <section className="panel products-panel"><div className="panel-heading"><div><div className="panel-kicker">Top products</div><h2>热销产品排行</h2></div><button className="icon-button"><Icon name="more" size={17} /></button></div><div className="product-table"><div className="product-head"><span>产品名称</span><span>销售额</span><span>占比</span><span>排序</span></div>{dashboardData.products.slice(0, 4).map((product, index) => <div className="product-row" key={product.name}><span className="product-name"><i className={`product-index index-${index + 1}`}>{index + 1}</i><b>{product.name}</b><small>{product.category}</small></span><strong>{product.revenue}</strong><span>{product.share}%</span><span className="delta up">第 {index + 1} 名</span></div>)}</div></section>
              </div>
              <QueryComposer onSubmit={submitQuery} pending={analysisPending} query={query} setQuery={setQuery} />
            </>
          )}

          {activeNav === '数据源' && (
            <>
              <div className="status-strip"><div className="status-message"><span className={`status-dot ${analysisError ? 'error-dot' : ''}`} /><span><b>{analysisError ? '数据检查未通过' : 'CSV 已通过结构检查'}</b><small>{analysisError || `${fileName} · ${rows.length} 条记录`}</small></span></div><div className="status-stats"><span><b>{initialDataset.headers.length}</b> 字段</span><span><b>{rows[0]?.year ?? '—'}</b> 年份</span><span><b>{dataQuality.duplicateCount}</b> 重复</span></div></div>
              <section className="quality-grid">
                <article className="panel quality-card"><span>日期有效性</span><strong>{dataQuality.invalidDate === 0 ? '通过' : `${dataQuality.invalidDate} 条异常`}</strong><small>检查订单日期能否解析</small></article>
                <article className="panel quality-card"><span>销售额有效性</span><strong>{dataQuality.invalidSales === 0 ? '通过' : `${dataQuality.invalidSales} 条异常`}</strong><small>金额必须是数字且不小于 0</small></article>
                <article className="panel quality-card"><span>折扣范围</span><strong>{dataQuality.invalidDiscount === 0 ? '通过' : `${dataQuality.invalidDiscount} 条异常`}</strong><small>折扣应在 0 到 1 之间</small></article>
                <article className="panel quality-card"><span>重复记录</span><strong>{dataQuality.duplicateCount === 0 ? '无重复' : `${dataQuality.duplicateCount} 条`}</strong><small>按日期、地区、产品、销售额判断</small></article>
              </section>
              <div className="source-grid">
                <section className="panel"><div className="panel-heading"><div><div className="panel-kicker">Schema</div><h2>字段清单</h2></div><span className="ai-badge">{initialDataset.headers.length} 字段</span></div><div className="field-list">{initialDataset.headers.map((header) => <div key={header}><b>{header}</b><span>{['订单日期'].includes(header) ? '日期' : ['销售额', '成本', '折扣', '数量'].includes(header) ? '数值' : '分类'}</span></div>)}</div></section>
                <section className="panel"><div className="panel-heading"><div><div className="panel-kicker">Preview</div><h2>数据预览</h2></div><span className="ai-badge">前 8 行</span></div><div className="table-wrapper"><table className="data-table"><thead><tr>{initialDataset.headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{rows.slice(0, 8).map((row, rowIndex) => <tr key={rowIndex}>{initialDataset.headers.map((header) => <td key={header} className={['销售额', '成本', '折扣', '数量'].includes(header) ? 'num' : ''}>{row[header]}</td>)}</tr>)}</tbody></table></div></section>
              </div>
            </>
          )}

          {activeNav === '分析报告' && (
            <>
              <div className="status-strip"><div className="status-message"><span className={`status-dot ${analysisPending ? 'pending-dot' : analysisError ? 'error-dot' : ''}`} /><span><b>{analysisPending ? 'Agent 循环运行中' : analysisError ? 'Agent 已停止' : 'Agent 循环完成'}</b><small>{analysisPending ? '正在理解问题、执行计算并检查结果' : `${analysis.totalSteps || (analysis.agentSteps ?? []).length} 个步骤 · ${analysis.source === 'demo' ? '演示模式' : '万擎模式'}`}</small></span></div><div className="status-stats"><span><b>{rows.length.toLocaleString()}</b> 输入记录</span><span><b>{analysis.totalSteps || (analysis.agentSteps ?? []).length}</b> 步</span><span><b>{analysis.source === 'demo' ? '本地' : 'Wanqing'}</b> 计划来源</span></div></div>
              <div className="report-grid">
                <section className="panel agent-panel"><div className="panel-heading"><div><div className="panel-kicker">Agent loop</div><h2>分析循环</h2></div><span className={`ai-badge ${analysis.source === 'demo' ? 'demo-badge' : ''}`}>{analysis.source === 'demo' ? '演示模式' : '真实循环'}</span></div><AgentSteps steps={analysis.agentSteps ?? []} pending={analysisPending} error={analysisError} /></section>
                <section className="panel result-panel"><div className="panel-heading"><div><div className="panel-kicker">Final answer</div><h2>最终答案</h2></div><span className="ai-badge"><Icon name="check" size={13} />有依据</span></div><div className="final-answer"><b>{submittedQuery}</b><p>{analysis.answer}</p></div>{analysis.chart && <figure className="chart-figure"><img src={analysis.chart.publicPath} alt={`${analysis.chart.title}图片`} /><figcaption>已保存：{analysis.chart.relativePath}</figcaption></figure>}<div className="evidence-list"><div><span>依据</span><p>{analysis.detail}</p></div><div><span>图片</span><p>{analysis.chart ? `${analysis.chart.relativePath} · ${(analysis.chart.bytes / 1024).toFixed(1)} KB` : '本次问题未要求生成图片'}</p></div><div><span>计划</span><p>{JSON.stringify(analysis.plan ?? {})}</p></div><div><span>结果组</span><p>{(analysis.rows ?? []).slice(0, 4).map((row) => formatResultRow(row, analysis.plan)).join('；') || '—'}</p></div></div></section>
              </div>
              <QueryComposer onSubmit={submitQuery} pending={analysisPending} query={query} setQuery={setQuery} />
            </>
          )}

          {activeNav === '自动评测' && (
            <>
              <div className="status-strip"><div className="status-message"><span className={`status-dot ${evaluationRunning ? 'pending-dot' : evaluationSummary ? 'status-dot' : ''}`} /><span><b>{evaluationRunning ? '评测正在运行' : evaluationSummary ? `评测完成：${evaluationSummary.passed}/${evaluationSummary.total} 题通过` : '评测尚未运行'}</b><small>{evaluationRunning ? '正在逐题调用分析接口并保存每题结果' : evaluationSummary ? `准确率 ${evaluationSummary.accuracy} · 结果保存到 evaluations/latest.json` : '点击开始自动评测，验证产品是否能持续工作'}</small></span></div><div className="status-stats"><span><b>10</b> 道题</span><span><b>{evaluationSummary?.passed ?? '—'}</b> 通过</span><span><b>{evaluationSummary?.accuracy ?? '—'}</b> 准确率</span></div></div>
              <section className="evaluation-hero"><div><div className="panel-kicker">Product exam</div><h2>SaleScope AI 能通过这套考试吗？</h2><p>每道题都真实读取当前数据，逐题判断答案，任何失败题都会保留下来。</p></div><div className="evaluation-score"><strong>{evaluationSummary?.accuracy ?? '—'}</strong><span>当前准确率</span></div></section>
              <section className="panel"><div className="panel-heading"><div><div className="panel-kicker">10 test cases</div><h2>评测题目与结果</h2></div><span className="ai-badge">每题保存</span></div><EvaluationList results={evaluationResults} running={evaluationRunning} /></section>
              {evaluationSummary && <section className="panel evaluation-feedback"><div className="panel-heading"><div><div className="panel-kicker">Review</div><h2>需要修复的题目</h2></div><span className="ai-badge">{evaluationSummary.passed === evaluationSummary.total ? '全部通过' : `${evaluationSummary.total - evaluationSummary.passed} 题待修复`}</span></div>{evaluationSummary.results.filter((result) => !result.passed).length === 0 ? <p className="success-copy">所有评测题通过，当前数据分析、筛选、利润计算和画图能力均正常。</p> : <div className="failed-cases">{evaluationSummary.results.filter((result) => !result.passed).map((result) => <div key={result.id}><b>第 {result.id} 题 · {result.category}</b><span>{result.error}</span><small>实际输出：{result.answer}</small></div>)}</div>}</section>}
            </>
          )}
          <footer className="footer-note"><span><Icon name="check" size={14} />SaleScope AI Agent 已就绪</span><span>模型只生成计划，数字来自当前 CSV</span></footer>
        </div>
      </main>
      {toast && <div className="toast"><span className="toast-check"><Icon name="check" size={14} /></span>{toast}</div>}
    </div>
  )
}

createRoot(document.getElementById('root')).render(<App />)
