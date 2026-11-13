import React from 'react'

const projects = {
  analysis: {
    number: '01', label: '数据分析', title: '数据分析 Agent', subtitle: '用业务语言提问，得到有依据的经营结论。',
    description: '面向销售与运营，把分散的表格分析步骤串成一条可核对的工作流：确认数据、选择分析方法、计算与绘图，再保存结论。',
    question: '哪些地区销售表现更好？这段时间谁贡献增长、谁拖后腿？',
    input: 'CSV / Excel · 日期、指标与分类字段', output: '经营结论 · 依据表 · 图表 · 分析历史',
    demo: '默认销售演示已准备好：12条模拟记录，销售额合计57,100。无需上传或登录。',
    layers: [
      { title: 'L1 产品规划层', caption: '业务问题进入 → 确认分析任务', tone: 'intent', nodes: [
        { title: '任务开始：接收业务问题', text: '用户提出想了解的经营情况，例如地区销售表现或专项增长变化。', role: 'human' },
        { title: '明确范围与交付要求', text: '确认指标、时间、比较对象和数据粒度；约定需要结论、依据表或图表。', role: 'human', gate: true },
        { title: '任务结束：形成分析要求', text: '把确认的问题与字段口径交给Agent；信息不明确时先补充，不猜指标。', role: 'human' },
      ] },
      { title: 'L2 Agent 编排层', caption: '接收分析要求 → 交付通过校验的答案', tone: 'agent', loop: '每次工具执行结果或错误回传给模型，再选择下一步；缺条件则追问，超出预算则停止并提示失败。', nodes: [
        { title: '任务开始：准备执行上下文', text: 'Harness装入问题、字段概况、最近对话与允许的工具，模型据此选择第一步。', role: 'ai' },
        { title: '选择动作并循环推进', text: '模型提出查询、变化分析或绘图动作；Harness校验、调用工具，将结果反馈，必要时修正。', role: 'ai' },
        { title: '任务结束：校验后完成', text: 'Harness检查结果编号、图表对应关系及用户要求，通过后交付答案；未满足则继续。', role: 'program', gate: true },
      ] },
      { title: 'L3 实际执行层', caption: '接收具体工具请求 → 返回结果或错误', tone: 'execution', nodes: [
        { title: '任务开始：取得数据与参数', text: '工具接收字段、筛选、分组或绘图参数，读取当前数据或账号确认的数据版本。', role: 'program' },
        { title: '执行计算与生成图表', text: '程序计算合计、占比、日均变化、贡献与拖累；绘图工具使用已有结果生成SVG。', role: 'program' },
        { title: '任务结束：返回可信执行结果', text: '成功返回数值、依据和图表；非法字段、缺数或执行异常明确返回，供Agent决定下一步。', role: 'program' },
      ] },
      { title: 'L4 数据回流层', caption: '接收成功结论 → 形成可回看的历史记录', tone: 'archive', nodes: [
        { title: '任务开始：接收成功分析', text: '登录用户的成功结论进入历史保存；游客、失败请求、澄清和自动评测不进入业务历史。', role: 'program' },
        { title: '保存当时的结论与依据', text: '按账号保存问题、答案、证据、执行步骤和独立图表；有确认数据版本时记录版本引用。', role: 'program' },
        { title: '任务结束：历史可查可导出', text: '用户可查找、回看或导出当时结果；有版本引用可继续分析，不覆盖原记录。', role: 'human' },
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
      { title: 'L1 产品规划层', caption: '复盘需求进入 → 确认本次核算口径', tone: 'intent', nodes: [
        { title: '任务开始：明确复盘问题', text: '用户需要了解客户达成、目标缺口、返货或增量ROI，提供base、消耗与既有政策。', role: 'human' },
        { title: '确认范围与政策规则', text: '明确客户名单、活动周期、截止日、分层门槛、返点、封顶及缺行处理；文本抽取后人工核对。', role: 'human', gate: true },
        { title: '任务结束：形成复盘要求', text: '交付已确认的两表与规则，以及要查看的销售、客户或指标范围，用于核算和问答。', role: 'human' },
      ] },
      { title: 'L2 Agent 编排层', caption: '接收复盘问题 → 交付有依据的解答', tone: 'agent', loop: '导入和重算由政策程序直接核算；政策问答才进入模型—工具循环。规则解析是单次抽取，并非完整Agent循环。', nodes: [
        { title: '任务开始：准备复盘上下文', text: '问答接收确认的政策、截止日、客户范围和当前计算概况；Harness提供政策工具。', role: 'ai' },
        { title: '选择工具与继续下钻', text: '模型选择群体汇总、客户详情、趋势或绘图；根据执行反馈继续查询、修正或澄清。', role: 'ai' },
        { title: '任务结束：引用核算结果回答', text: 'Harness检查结果与图表引用，返回有依据的复盘解答，不能用平均客户ROI替代群体ROI。', role: 'program', gate: true },
      ] },
      { title: 'L3 实际执行层', caption: '接收两表与确认规则 → 返回核算结果', tone: 'execution', nodes: [
        { title: '任务开始：关联并检查数据', text: '程序按客户关联base与每日消耗，检查重复、缺日、期外和编外记录，保留待核验提示。', role: 'program' },
        { title: '核算达成、返货与ROI', text: '比较同天数base与cost6，计算档位及缺口；按增量现金计返并封顶，ROI采用同批获返客户。', role: 'program' },
        { title: '任务结束：交付复盘结果', text: '返回客户名单、双达成率、返货、ROI、趋势和质量提示，供页面展示、问答及导出。', role: 'program' },
      ] },
      { title: 'L4 数据回流层', caption: '接收成功复盘 → 保留当时规则与结论', tone: 'archive', nodes: [
        { title: '任务开始：接收复盘或问答', text: '登录用户导入、重算后的复盘，以及成功政策问答，进入各自账号的历史保存。', role: 'program' },
        { title: '保存核算快照与分析记录', text: '复盘保留当时规则、截止日、汇总和达成结果；问答保留问题、证据与历史图表副本。', role: 'program' },
        { title: '任务结束：历史可核对可导出', text: '用户查看和导出过去的复盘与结论；历史不会因后续重算被覆盖，也不会自动修改政策。', role: 'human' },
      ] },
    ],
    boundary: '当前只用于既有政策复盘与同类二档增量规则试算，正式结算需人工核验；数据回流指账号历史留存。',
    button: '开始政策复盘演示',
  },
}
const roles = { ai: 'AI理解', program: '程序计算', human: '人工确认' }

export default function ProjectIntroduction({ project = 'analysis', onStart }) {
  const data = projects[project]
  return <article className="project-introduction" aria-label={`${data.label}项目介绍`}>
    <header className="project-intro-header"><div className="project-intro-kicker">项目 {data.number} · {data.label}</div><h1>{data.title}</h1><p className="project-intro-subtitle">{data.subtitle}</p><p className="project-intro-description">{data.description}</p><div className="project-intro-launch"><button className="button primary" onClick={onStart}>{data.button}</button><span>默认模拟数据 · 无需配置</span></div></header>
    <section className="project-task"><div><span className="project-section-label">从一个实际问题开始</span><p>{data.question}</p></div><dl><div><dt>输入</dt><dd>{data.input}</dd></div><div><dt>交付</dt><dd>{data.output}</dd></div></dl></section>
    <section className="project-map" aria-label={`${data.label}执行架构`}><div className="project-map-heading"><h2>这件事怎样完成</h2><p>每层都从任务开始写到任务结束；Agent编排负责调度，实际执行负责计算，数据回流负责历史留存。</p></div><div className="project-legend" aria-label="职责图例">{Object.entries(roles).map(([role,label])=><span className={`project-role role-${role}`} key={role}>{label}</span>)}<span>强调边框：确认或校验关口</span></div>
      {data.layers.map(layer=><section className={`project-layer layer-${layer.tone}`} key={layer.title}><header><h3>{layer.title}</h3><p>{layer.caption}</p></header><ol className="project-node-flow">{layer.nodes.map((node,i)=><li className={`project-node ${node.gate?'project-gate':''} ${node.future?'project-future':''}`} key={node.title}><span className="project-node-number">{i+1}</span><h4>{node.title}</h4><p>{node.text}</p>{node.role?<span className={`project-role role-${node.role}`}>{roles[node.role]}</span>:<span className="project-planned">后续规划</span>}</li>)}</ol>{layer.loop&&<p className="project-feedback"><span aria-hidden="true">↶</span> {layer.loop}</p>}</section>)}
    </section>
    <footer className="project-intro-footer"><p>{data.demo}</p><p className="project-boundary">{data.boundary}</p><button className="button primary" onClick={onStart}>{data.button}</button></footer>
  </article>
}
