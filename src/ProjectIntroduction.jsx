import React from 'react'

const projects = {
  analysis: {
    number: '01', label: '数据分析', title: '数据分析 Agent', subtitle: '用业务语言提问，得到有依据的经营结论。',
    description: '面向销售与运营，把分散的表格分析步骤串成一条可核对的工作流：确认数据、选择分析方法、计算与绘图，再保存结论。',
    question: '哪些地区销售表现更好？这段时间谁贡献增长、谁拖后腿？',
    input: 'CSV / Excel · 日期、指标与分类字段', output: '经营结论 · 依据表 · 图表 · 分析历史',
    demo: '默认销售演示已准备好：12条模拟记录，销售额合计57,100。无需上传或登录。',
    layers: [
      { title: 'L1 任务与口径', caption: '先说清分析什么', tone: 'intent', nodes: [
        { title: '提出业务问题', text: '确定指标、时间范围和比较对象。', role: 'human' },
        { title: '理解数据结构', text: '识别字段、表头与质量；复杂表先预览转换。', role: 'ai' },
        { title: '确认字段与粒度', text: '有歧义就确认，缺数不静默当零。', role: 'human', gate: true },
      ] },
      { title: 'L2 Agent 编排', caption: '模型选择动作，Harness 管执行', tone: 'agent', loop: '工具返回结果或错误 → 模型继续查询、修正或绘图。默认最多8轮、180秒。', nodes: [
        { title: '选择分析工具', text: '根据问题选择汇总、分组、变化分析或绘图。', role: 'ai' },
        { title: '执行并反馈', text: '程序检查参数，返回真实结果与编号。', role: 'program' },
        { title: '检查完成条件', text: '结果与图表必须对应，不能空口宣布完成。', role: 'program', gate: true },
      ] },
      { title: 'L3 程序执行', caption: '真实数字来自受控工具', tone: 'execution', nodes: [
        { title: '查询与变化计算', text: '求和、分组、占比；区分涨幅、贡献与拖累。', role: 'program' },
        { title: '生成真实图表', text: '以已计算结果绘制SVG，保留单位与数据依据。', role: 'program' },
        { title: '展示结论与证据', text: '查看答案、明细和执行步骤，继续追问。', role: 'human' },
      ] },
      { title: 'L4 结果沉淀', caption: '让一次分析可以回看', tone: 'archive', nodes: [
        { title: '自动保存成功结论', text: '登录用户保存问题、答案、依据与独立图表副本。', role: 'program' },
        { title: '回看与继续分析', text: '历史可查找、导出；确认的数据版本可恢复使用。', role: 'human' },
        { title: '后续：任务恢复与监控', text: '长任务检查点、周期分析与团队协作。', future: true },
      ] },
    ],
    boundary: '支持结构确认与受控分析，不保证任意表格零确认理解，也不把描述性变化当成因果结论。',
    button: '开始数据分析演示',
  },
  policy: {
    number: '02', label: '政策复盘', title: '政策复盘 Agent', subtitle: '统一客户口径，算清达成、返货与增量回报。',
    description: '面向客户激励复盘，将base表、每日消耗和已确认的政策规则关联起来。程序算金额，AI帮助查结果，人工确认口径与结算边界。',
    question: '哪些客户达标、还差多少？返货是否封顶？增量ROI如何计算？',
    input: '客户base · 每日cost6 / cost4 · 激励规则', output: '达成名单 · 目标缺口 · 返货试算 · 增量ROI',
    demo: '默认两表与规则已准备好：20个模拟客户，13天活动周期，含封顶、零现金、下降与缺数场景。',
    layers: [
      { title: 'L1 数据与政策口径', caption: '名单、周期与分层规则先确认', tone: 'intent', nodes: [
        { title: '关联客户与消耗', text: '按客户对应base和每日记录，识别缺行与编外客户。', role: 'program' },
        { title: '提取政策规则', text: 'AI从正文提取各类型、base区间与两档门槛。', role: 'ai' },
        { title: '确认规则与截止日', text: '门槛、现金率、封顶和缺数处理由用户确认。', role: 'human', gate: true },
      ] },
      { title: 'L2 人机协同分析', caption: '确定计算直接执行，开放问题由AI选工具', tone: 'agent', loop: '追问销售、部门或单客户 → 查询结果与错误反馈 → 继续下钻或生成趋势图。', nodes: [
        { title: '提出复盘问题', text: '查询哪位销售、哪类客户、哪段消耗过程。', role: 'human' },
        { title: '选择政策工具', text: 'AI选择群体汇总、客户明细、趋势或绘图。', role: 'ai' },
        { title: '校验范围与引用', text: '同一批客户计算分子分母，图表绑定真实结果。', role: 'program', gate: true },
      ] },
      { title: 'L3 达成与金额计算', caption: '政策执行器负责规则计算', tone: 'execution', nodes: [
        { title: '核算客户达成', text: '比较同天数base与cost6；展示档位、缺口和进度。', role: 'program' },
        { title: '计算返货与ROI', text: '增量现金计返并封顶；ROI仅纳入政策获返客户。', role: 'program' },
        { title: '查看客户与质量', text: '同时查看客户数、base加权达成率与待核验记录。', role: 'human' },
      ] },
      { title: 'L4 复盘与历史', caption: '保存当时规则和结果', tone: 'archive', nodes: [
        { title: '导出复盘材料', text: '生成Markdown、客户CSV或完整JSON。', role: 'program' },
        { title: '保存复盘快照', text: '登录用户保存当时规则、截止日与计算结果。', role: 'program' },
        { title: '后续：设计与回流', text: '政策设计、执行监控与经验资产持续迭代。', future: true },
      ] },
    ],
    boundary: '当前为同类二档增量政策试算，正式结算仍需人工核验。政策设计、自动监控和经验回流未接入本次公开演示。',
    button: '开始政策复盘演示',
  },
}
const roles = { ai: 'AI理解', program: '程序计算', human: '人工确认' }

export default function ProjectIntroduction({ project = 'analysis', onStart }) {
  const data = projects[project]
  return <article className="project-introduction" aria-label={`${data.label}项目介绍`}>
    <header className="project-intro-header"><div className="project-intro-kicker">项目 {data.number} · {data.label}</div><h1>{data.title}</h1><p className="project-intro-subtitle">{data.subtitle}</p><p className="project-intro-description">{data.description}</p><div className="project-intro-launch"><button className="button primary" onClick={onStart}>{data.button}</button><span>默认模拟数据 · 无需配置</span></div></header>
    <section className="project-task"><div><span className="project-section-label">从一个实际问题开始</span><p>{data.question}</p></div><dl><div><dt>输入</dt><dd>{data.input}</dd></div><div><dt>交付</dt><dd>{data.output}</dd></div></dl></section>
    <section className="project-map" aria-label={`${data.label}执行架构`}><div className="project-map-heading"><h2>这件事怎样完成</h2><p>沿着四层了解任务如何进入、执行和沉淀。</p></div><div className="project-legend" aria-label="职责图例">{Object.entries(roles).map(([role,label])=><span className={`project-role role-${role}`} key={role}>{label}</span>)}<span className="project-future-legend">虚线：后续规划</span><span>强调边框：确认或校验关口</span></div>
      {data.layers.map(layer=><section className={`project-layer layer-${layer.tone}`} key={layer.title}><header><h3>{layer.title}</h3><p>{layer.caption}</p></header><ol className="project-node-flow">{layer.nodes.map((node,i)=><li className={`project-node ${node.gate?'project-gate':''} ${node.future?'project-future':''}`} key={node.title}><span className="project-node-number">{i+1}</span><h4>{node.title}</h4><p>{node.text}</p>{node.role?<span className={`project-role role-${node.role}`}>{roles[node.role]}</span>:<span className="project-planned">后续规划</span>}</li>)}</ol>{layer.loop&&<p className="project-feedback"><span aria-hidden="true">↶</span> {layer.loop}</p>}</section>)}
    </section>
    <footer className="project-intro-footer"><p>{data.demo}</p><p className="project-boundary">{data.boundary}</p><button className="button primary" onClick={onStart}>{data.button}</button></footer>
  </article>
}
