import React, { useEffect, useState } from 'react'
import { renderChartSvg } from './chartGenerator.js'
import { formatValue } from './datasetEngine.js'

const modules = { basic: '基础分析', policy: '政策监控' }
const time = value => new Date(value).toLocaleString('zh-CN', { hour12: false })
const number = value => value == null ? '—' : value.toLocaleString('zh-CN', { maximumFractionDigits: 4 })

export default function HistoryPanel({ guest }) {
  const [module, setModule] = useState(''), [query, setQuery] = useState(''), [from, setFrom] = useState(''), [to, setTo] = useState('')
  const [page, setPage] = useState(1), [list, setList] = useState({ items: [], total: 0 }), [record, setRecord] = useState(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [refresh, setRefresh] = useState(0), [deleting, setDeleting] = useState('')
  useEffect(() => {
    if (guest) return
    let active = true
    setBusy(true); setError('')
    const params = new URLSearchParams({ module, q: query, from, to, page: String(page) })
    fetch(`/api/history?${params}`).then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error); if (active) setList(data) }).catch(failure => { if (active) setError(failure.message) }).finally(() => { if (active) setBusy(false) })
    return () => { active = false }
  }, [guest, module, query, from, to, page, refresh])
  const open = async id => {
    setBusy(true); setError(''); setDeleting('')
    try { const response = await fetch(`/api/history/${id}`), data = await response.json(); if (!response.ok) throw new Error(data.error); setRecord(data) } catch (failure) { setError(failure.message) } finally { setBusy(false) }
  }
  const remove = async id => {
    setBusy(true); setError('')
    try {
      const response = await fetch(`/api/history/${id}/delete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const data = await response.json(); if (!response.ok) throw new Error(data.error)
      if (record?.id === id) setRecord(null)
      setDeleting(''); setPage(1); setRefresh(value => value + 1)
    } catch (failure) { setError(failure.message) } finally { setBusy(false) }
  }
  if (guest) return <section className="panel"><h2>登录后保存历史分析</h2><p>游客结论不会长期保存。登录后可回看自己的分析、图表与政策复盘。</p><a className="button primary" href="/login">登录使用完整功能</a></section>
  const result = record?.result
  let trend = ''
  if (result?.trend?.length) try { trend = renderChartSvg({ type: 'line', title: '历史政策每日cost6', metric: 'cost6(万)', rows: result.trend.map(day => ({ label: day.date, value: day.cost6 })) }) } catch {}
  return <section className="history-panel">
    <div className="page-heading"><div><div className="eyebrow">账号私有记录</div><h1>历史分析</h1><p>查看已保存的结论与当时依据，不会替换当前数据或重新计算。</p></div></div>
    <section className="panel history-filters">
      <label>业务模块<select aria-label="历史模块" value={module} onChange={event => { setModule(event.target.value); setPage(1) }}><option value="">全部</option><option value="basic">基础分析</option><option value="policy">政策监控</option></select></label>
      <label>查找记录<input aria-label="历史搜索" placeholder="问题、结论或数据源名称" value={query} onChange={event => { setQuery(event.target.value); setPage(1) }} /></label>
      <label>开始日期<input aria-label="历史开始日期" type="date" value={from} onChange={event => { setFrom(event.target.value); setPage(1) }} /></label>
      <label>结束日期<input aria-label="历史结束日期" type="date" value={to} onChange={event => { setTo(event.target.value); setPage(1) }} /></label>
    </section>
    {error && <p className="v2-alert" role="alert">{error}</p>}
    {busy && <p role="status">正在读取或更新历史…</p>}
    <section className="panel"><div className="panel-heading"><h2>已保存记录（{list.total}）</h2><button className="button secondary" disabled={busy} onClick={() => setRefresh(value => value + 1)}>刷新列表</button></div>
      {!list.items.length && !busy ? <div className="empty-state">暂无历史记录。完成一次分析或政策导入、重算后，会自动保存。</div> : <div className="v2-table-scroll"><table className="v2-table" aria-label="历史记录列表"><thead><tr><th>问题 / 复盘</th><th>模块</th><th>保存时间</th><th>操作</th></tr></thead><tbody>{list.items.map(item => <tr key={item.id}><td><button className="history-title" disabled={busy} onClick={() => open(item.id)}>{item.title}</button><p className="history-preview">{item.preview}</p></td><td>{modules[item.module]}{item.kind === 'snapshot' ? ' · 复盘' : ''}</td><td>{time(item.createdAt)}</td><td><button className="button secondary" disabled={busy} onClick={() => open(item.id)}>查看</button> <button className="button secondary" disabled={busy} onClick={() => setDeleting(item.id)}>删除</button></td></tr>)}</tbody></table></div>}
      {deleting && <div className="history-confirm" role="alert"><p>确认删除这条历史及其历史图表？删除后无法恢复，当前上传数据保持。</p><button className="button primary" disabled={busy} onClick={() => remove(deleting)}>确认删除</button> <button className="button secondary" disabled={busy} onClick={() => setDeleting('')}>取消</button></div>}
      {list.total > 20 && <div className="heading-actions history-pages"><button className="button secondary" disabled={busy || page <= 1} onClick={() => setPage(page - 1)}>上一页</button><span>第{page}页</span><button className="button secondary" disabled={busy || page * 20 >= list.total} onClick={() => setPage(page + 1)}>下一页</button></div>}
    </section>
    {record && <section className="panel history-detail" aria-label="历史记录详情"><div className="panel-heading"><h2>{record.title}</h2><button className="button secondary" onClick={() => setRecord(null)}>收起详情</button></div><p>{modules[record.module]} · {time(record.createdAt)} · 数据源：{record.dataset.name || '上传数据'}{record.dataset.asOf ? ` · 截至${record.dataset.asOf}` : ''}</p>
      <div className="heading-actions"><a className="button secondary" href={`/api/history/${record.id}/export?format=md`}>下载历史报告</a><a className="button secondary" href={`/api/history/${record.id}/export?format=json`}>下载完整JSON</a>{result.chart && <a className="button secondary" href={result.chart.publicPath} target="_blank" rel="noreferrer">打开历史图表</a>}</div>
      {record.kind === 'snapshot' ? <><div className="kpi-grid"><article className="kpi-card"><div>客户达成率</div><strong>{number(result.summary.countRate * 100)}%</strong></article><article className="kpi-card"><div>base加权达成率</div><strong>{number(result.summary.baseWeightedRate * 100)}%</strong></article><article className="kpi-card"><div>cost6增量（万）</div><strong>{number(result.summary.increment)}</strong></article><article className="kpi-card"><div>获返客户增量ROI</div><strong>{number(result.summary.roi)}</strong></article></div><p>政策：{result.rules.name}；周期{result.rules.startDate}—{result.rules.endDate}；截至{result.asOf}。框架{number(result.rules.annualRate * 100)}%，渠道{number(result.rules.channelRate * 100)}%。</p>{trend && <figure className="chart-figure"><img alt="历史政策日度消耗" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(trend)}`} /></figure>}<details><summary>当时政策规则与质量提示</summary><pre>{JSON.stringify(result.rules, null, 2)}</pre>{result.warnings.map((warning, index) => <p key={index}>{warning}</p>)}</details></> : <><div className="final-answer change-answer">{String(result.answer).split(/\n\n+/).map((text, index) => <p key={index}>{text}</p>)}</div><p>{result.detail}</p>{result.chart && <figure className="chart-figure"><img alt={result.chart.title} src={result.chart.publicPath} /></figure>}{result.table?.length > 0 && <div className="v2-table-scroll"><table className="v2-table"><thead><tr><th>分组</th>{(result.measures || []).map(m => <th key={m.alias}>{m.alias}</th>)}</tr></thead><tbody>{result.table.slice(0, 50).map((row, index) => <tr key={index}><td>{row.dimensions.join(' × ') || '全部'}</td>{(result.measures || []).map(m => <td key={m.alias}>{formatValue(row.values[m.alias], m.unit)}</td>)}</tr>)}</tbody></table></div>}<details><summary>当时工具执行过程</summary><ol className="agent-steps">{result.agentSteps?.map((step, index) => <li className="agent-step" key={index}><div className="agent-step-index">{index + 1}</div><div><b>{step.title}</b><p>{step.method}</p><small>{step.result}</small></div></li>)}</ol></details></>}
    </section>}
  </section>
}
