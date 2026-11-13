import React, { useId, useState } from 'react'
import './analysisArchitecture.css'

const roles = { human: '人工确认', ai: 'AI理解与决策', program: '程序执行' }
const nodes = [
  { id: 'import', layer: 1, x: 90, y: 150, w: 190, title: '导入数据', lines: ['上传表格／载入演示', '先看原始预览与质量'], role: 'human' },
  { id: 'confirm', layer: 1, x: 330, y: 150, w: 240, title: '确认口径与对应关系', lines: ['指标、单位、日期、粒度', '默认值可预填，用户确认'], role: 'human', gate: true },
  { id: 'template', layer: 1, x: 625, y: 150, w: 200, title: '模板初步分析', lines: ['启动推荐分析任务', '获得第一份结果'], role: 'program' },
  { id: 'question', layer: 1, x: 875, y: 150, w: 200, title: '用户提问', lines: ['自由提问／继续追问', '必要时补充条件'], role: 'human' },
  { id: 'view', layer: 1, x: 1120, y: 150, w: 220, title: '查看分析结论', lines: ['答案＋依据＋图表', '决定是否继续分析'], role: 'human' },
  { id: 'end', layer: 1, x: 1120, y: 320, w: 220, h: 76, title: '结束本次体验', lines: ['不再追问时结束'], role: 'human' },
  { id: 'request', layer: 2, x: 90, y: 550, w: 220, title: '接收分析请求', lines: ['任务＋确认口径＋版本', '携带最近对话'], role: 'program' },
  { id: 'understand', layer: 2, x: 365, y: 535, w: 210, h: 140, title: '条件是否足够？', lines: ['理解需求与歧义'], role: 'ai', diamond: true },
  { id: 'choose', layer: 2, x: 650, y: 550, w: 210, title: '选择工具与参数', lines: ['决定下一项行动', '查询／变化分析／绘图'], role: 'ai' },
  { id: 'feedback', layer: 2, x: 920, y: 550, w: 210, title: '读取执行反馈', lines: ['检查结果或错误', '判断是否还缺证据'], role: 'ai' },
  { id: 'finish', layer: 2, x: 1170, y: 550, w: 220, title: '申请完成并校验', lines: ['核对结果与图表引用', '满足本轮用户要求'], role: 'program', gate: true },
  { id: 'stop', layer: 2, x: 90, y: 810, w: 280, h: 100, title: '停止并说明原因', lines: ['轮次／时限耗尽则停止', '不把未完成分析当成功答案'], role: 'program' },
  { id: 'validate', layer: 3, x: 90, y: 1110, w: 240, title: '接收并校验请求', lines: ['字段、类型、参数、范围', '读取本次数据版本'], role: 'program' },
  { id: 'tools', layer: 3, x: 420, y: 1090, w: 490, h: 160, title: '按需执行选定工具', lines: ['检查数据／识别字段　·　聚合查询', '变化、涨幅与贡献分析　·　生成图表', '工具可重复调用，不要求逐项走完'], role: 'program' },
  { id: 'return', layer: 3, x: 1020, y: 1110, w: 300, title: '返回真实结果或错误', lines: ['数值、依据、result_id／chart_id', '交给Agent判断下一步'], role: 'program' },
  { id: 'history', layer: 4, x: 90, y: 1470, w: 260, title: '接收成功分析', lines: ['登录用户每次成功结果', '游客／澄清／失败不入历史'], role: 'program' },
  { id: 'save', layer: 4, x: 430, y: 1470, w: 340, title: '保存当时结论与依据', lines: ['问题、答案、证据、独立图表', '记录可用的数据版本引用'], role: 'program' },
  { id: 'review', layer: 4, x: 900, y: 1470, w: 390, title: '历史回看／导出', lines: ['回看不重新计算，也不覆盖原结论', '有可恢复版本时，可继续分析'], role: 'human' },
]

// Explicit routes keep feedback and human return paths connected across lanes.
// Edges are independent of node order: the tool box is not a sequential pipeline.
const edges = [
  ['import-confirm', 'import', 'confirm', 'main', 'M280 205H330'],
  ['confirm-template', 'confirm', 'template', 'main', 'M570 205H625'],
  ['direct-question', 'confirm', 'question', 'main', 'M450 260V300H975V260', '确认后也可直接提问', 725, 300],
  ['follow-up', 'view', 'question', 'human', 'M1230 150V118H975V150', '用户追问循环', 1100, 118],
  ['revise', 'view', 'confirm', 'human', 'M1120 235H1108V365H450V260', '口径有误：调整后重新分析', 755, 365],
  ['end', 'view', 'end', 'main', 'M1280 260V320', '结束', 1280, 288],
  ['template-request', 'template', 'request', 'main', 'M725 260V280H600V435H75V585H90', '模板分析请求', 370, 435],
  ['question-request', 'question', 'request', 'main', 'M875 230H850V455H45V635H90', '提问／补充后的请求', 615, 455],
  ['understand', 'request', 'understand', 'main', 'M310 605H365'],
  ['enough', 'understand', 'choose', 'main', 'M575 605H650', '是', 610, 605],
  ['clarify', 'understand', 'question', 'human', 'M470 535V485H1095V205H1075', '澄清循环：条件不足，请用户补充', 920, 485],
  ['tool-call', 'choose', 'validate', 'main', 'M755 660V990H75V1165H90', '调用选定工具', 460, 990],
  ['tool-feedback', 'return', 'feedback', 'feedback', 'M1170 1110V970H1025V660', '真实执行反馈：结果／错误', 1165, 970],
  ['tool-loop', 'feedback', 'choose', 'feedback', 'M985 660V715H810V660', 'Agent工具循环：继续查询／绘图／纠错', 895, 715],
  ['enough-evidence', 'feedback', 'finish', 'main', 'M1130 605H1170'],
  ['finish-retry', 'finish', 'choose', 'feedback', 'M1280 660V765H680V660', '校验未通过：返回修正', 1000, 765],
  ['budget-stop', 'choose', 'stop', 'main', 'M650 630H610V860H370', '轮次／时限耗尽', 500, 860],
  ['deliver', 'finish', 'view', 'main', 'M1390 605H1445V205H1340', '通过后交付答案', 1445, 400],
  ['execute', 'validate', 'tools', 'main', 'M330 1165H420', '通过', 375, 1165],
  ['result', 'tools', 'return', 'main', 'M910 1165H1020', '执行结果', 965, 1165],
  ['invalid', 'validate', 'return', 'feedback', 'M210 1220V1280H1170V1220', '校验失败：直接返回错误', 655, 1280],
  ['archive', 'finish', 'history', 'feedback', 'M1340 660V940H1415V1360H75V1525H90', '每轮成功即留存，无需等用户结束', 945, 1360],
  ['save', 'history', 'save', 'main', 'M350 1525H430'],
  ['review', 'save', 'review', 'main', 'M770 1525H900'],
  ['restore', 'review', 'confirm', 'human', 'M1095 1580V1620H28V96H405V150', '恢复可用版本 → 重新确认口径 → 再分析（原记录保留）', 700, 1620],
]

function Node({ node }) {
  const { x, y, w, h = 110, title, lines, role, diamond, gate, id } = node
  return <g className={`architecture-node arch-${role}`} data-node={id} data-layer={node.layer}>
    {diamond ? <polygon points={`${x+w/2},${y} ${x+w},${y+h/2} ${x+w/2},${y+h} ${x},${y+h/2}`} /> : <rect x={x} y={y} width={w} height={h} rx="6" strokeWidth={gate ? 2.5 : 1.2} />}
    <text className="arch-node-title" x={diamond ? x+w/2 : x+16} y={diamond ? y+56 : y+27} textAnchor={diamond ? 'middle' : 'start'}>{title}</text>
    {lines.map((line, i) => <text className="arch-node-body" x={diamond ? x+w/2 : x+16} y={(diamond ? y+80 : y+51)+i*22} textAnchor={diamond ? 'middle' : 'start'} key={line}>{line}</text>)}
    {h > 80 && <text className="arch-node-role" x={diamond ? x+w/2 : x+16} y={diamond ? y+103 : y+h-13} textAnchor={diamond ? 'middle' : 'start'}>{roles[role]}</text>}
  </g>
}

export default function AnalysisArchitecture() {
  const id = useId().replace(/:/g, '')
  const [zoom, setZoom] = useState(1)
  return <section className="analysis-architecture" aria-label="数据分析四层关系图">
    <header className="architecture-heading"><div><h2>从口径确认，到可核对的结论</h2><p>用户可以追问，Agent根据真实反馈继续行动。沿箭头看清四层如何协作。</p></div><span className="architecture-status">产品路径规划</span></header>
    <div className="architecture-legend" aria-label="节点与连线图例">
      <span className="project-role role-ai">蓝色 · AI理解</span><span className="project-role role-program">绿色 · 程序执行</span><span className="project-role role-human">橙色 · 人工确认</span>
      <span><i className="arch-line main" />主路径／调用</span><span><i className="arch-line feedback" />执行反馈／留存</span><span><i className="arch-line human" />人工确认／回流</span>
    </div>
    <div className="architecture-controls"><span id={`${id}-help`}>图内可横向滚动；每条回路线都接回对应节点。</span><div>
      <button className="button" onClick={() => setZoom(value => Math.max(0.75, value-0.25))} disabled={zoom === 0.75} aria-label="缩小关系图">缩小</button>
      <button className="button" onClick={() => setZoom(1)} aria-label="关系图默认比例">默认比例</button>
      <button className="button" onClick={() => setZoom(value => Math.min(2, value+0.25))} disabled={zoom === 2} aria-label="放大关系图">放大</button>
    </div></div>
    <div className="architecture-scroll" tabIndex={0} role="region" aria-label="可滚动四层架构图" aria-describedby={`${id}-help`}>
      <svg className="architecture-svg" viewBox="0 0 1480 1670" style={{ width: `${zoom*100}%`, minWidth: `${960*zoom}px` }} role="img" aria-labelledby={`${id}-title ${id}-desc`}>
        <title id={`${id}-title`}>数据分析：产品规划、Agent编排、实际执行、数据回流四层关系图</title>
        <desc id={`${id}-desc`}>导入并确认口径后可启动模板或直接提问。条件不足向用户澄清；Agent调用工具，读取真实反馈后继续查询或校验交付。用户查看后可追问或修改口径。每轮成功结果按账号保存，有可恢复数据版本时可重新分析。</desc>
        <defs>{['main', 'feedback', 'human'].map(kind => <marker key={kind} id={`${id}-${kind}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path className={`arch-arrow-${kind}`} d="M0 0L10 5L0 10Z" /></marker>)}</defs>
        {[
          [1, 20, 395, '产品规划层', '导入 → 确认 → 模板初步分析 → 可选提问 → 查看结论；用户决定是否继续'],
          [2, 475, 460, 'Agent 编排层', '接收任务 → 理解与澄清 → 按反馈选择行动 → 校验后交付本轮答案'],
          [3, 1030, 285, '实际执行层', '接收工具调用 → 校验并执行 → 返回结果或错误；每次调用独立完成'],
          [4, 1400, 240, '数据回流层', '接收成功结果 → 保存当时证据 → 历史回看与导出；以留存为主'],
        ].map(([layer, y, h, title, subtitle]) => <g className="architecture-lane" data-layer={layer} key={layer}><rect x="60" y={y} width="1340" height={h} rx="8" /><text className="arch-lane-title" x="85" y={y+29}>L{layer} {title}</text><text className="arch-lane-caption" x="85" y={y+53}>{subtitle}</text></g>)}
        <g className="architecture-edges">{edges.map(([key, from, to, kind, d]) => <path key={key} data-edge={key} data-from={from} data-to={to} className={`arch-edge arch-edge-${kind}`} d={d} markerEnd={`url(#${id}-${kind})`} />)}</g>
        {nodes.map(node => <Node key={node.id} node={node} />)}
        <g className="architecture-labels">{edges.filter(edge => edge[5]).map(([key, , , kind, , label, x, y]) => <g key={key} className={`arch-edge-label arch-label-${kind}`} transform={key === 'deliver' ? `rotate(-90 ${x} ${y})` : undefined}><rect x={x-label.length*7-8} y={y-12} width={label.length*14+16} height="24" rx="4" /><text x={x} y={y+5} textAnchor="middle">{label}</text></g>)}</g>
      </svg>
    </div>
    <p className="architecture-footnote">读图提示：一次工具返回、一轮问答完成、用户结束体验，是三个不同的结束点。历史保存从每轮成功结果分支，不等待体验结束。</p>
    <p className="architecture-footnote">本图表达已确认的产品路径；实际体验仍在逐步对齐“先确认、后分析”。历史复用需要可恢复的数据版本。</p>
  </section>
}
