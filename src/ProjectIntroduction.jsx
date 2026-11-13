import React from 'react'
import AnalysisArchitecture from './AnalysisArchitecture.jsx'

const projects = {
  analysis: {
    number: '01', label: '数据分析', title: '数据分析 Agent', subtitle: '用业务语言提问，得到有依据的经营结论。',
    description: '面向销售与运营，把分散的表格分析步骤串成一条可核对的工作流：确认数据、选择分析方法、计算与绘图，再保存结论。',
    question: '哪些地区销售表现更好？这段时间谁贡献增长、谁拖后腿？',
    input: 'CSV / Excel · 日期、指标与分类字段', output: '经营结论 · 依据表 · 图表 · 分析历史',
    demo: '默认销售演示已准备好：12条模拟记录，销售额合计57,100。无需上传或登录。',
    layers: [
      { title: 'L1 产品规划层', caption: '导入数据 → 确认口径 → 初步分析 → 提问分析 → 查看结论', tone: 'intent', nodes: [
        { title: '任务开始：导入数据', text: '上传业务表或载入默认演示。先看原始预览、字段和质量提示，不在此阶段给出经营结论。', role: 'human' },
        { title: '确认口径与对应关系', text: '核对指标、单位、日期、记录粒度及表间关联。可预填默认口径，由用户确认。', role: 'human', gate: true },
        { title: '运行模板初步分析', text: '使用推荐模板，明确分析范围后启动，得到第一份结论与依据。', role: 'program' },
        { title: '用户选择提问分析', text: '看初步结果后自由提问；也可在口径确认后直接提问。问题不明确时补充条件。', role: 'human' },
        { title: '查看结论，决定是否追问', text: '核对答案、依据和图表；继续问客户、时间或指标，启动下一次分析。', role: 'human' },
        { title: '任务结束：完成本次分析', text: '用户不再追问时结束体验。登录用户的每次成功结果已分别留存。', role: 'human' },
      ], loops: [
        { label: '直接提问分支', from: '2 确认口径', to: '4 提问分析', text: '无需强制先跑模板。' },
        { label: '用户追问循环', from: '5 查看结论', to: '4 提问分析', text: '继续追问则循环；不追问则进入6结束。' },
      ] },
      { title: 'L2 Agent 编排层', caption: '接收模板或问题 → 理解与澄清 → 工具循环 → 校验后回答', tone: 'agent', nodes: [
        { title: '任务开始：接收分析请求', text: '模板问题、自由提问或追问进入Harness，同时带上当前数据、确认口径和最近对话。', role: 'program' },
        { title: '理解问题，判断条件', text: '模型判断要分析什么、沿用哪些条件。信息不足时向用户澄清，补充后重新理解。', role: 'ai' },
        { title: '选择工具与参数', text: '模型决定查询、变化分析或绘图动作；Harness校验参数并调用实际执行层。', role: 'ai' },
        { title: '接收执行反馈', text: '实际执行层返回Observation：真实结果、编号或错误，模型据此判断下一步。', role: 'program' },
        { title: '判断并校验是否完成', text: '还缺计算或图表就继续调用；完成时检查结果引用、图表对应和本次用户要求。', role: 'program', gate: true },
        { title: '任务结束：回答或请求补充', text: '校验通过交付答案与依据；澄清交给用户；超出轮次或时限则停止并明确失败。', role: 'program' },
      ], loops: [
        { label: '澄清循环', from: '2 条件不明确', to: '2 重新理解', text: '向用户提问 → 用户补充条件 → 重新判断。' },
        { label: 'Agent工具循环', from: '5 未满足要求', to: '3 选择工具', text: '继续查询、修正参数或绘图 → 4执行反馈 → 5再次判断。' },
      ] },
      { title: 'L3 实际执行层', caption: '接收工具请求 → 检查数据与参数 → 执行 → 返回反馈', tone: 'execution', nodes: [
        { title: '任务开始：接收工具请求', text: '接收编排层指定的动作、字段、筛选、分组或绘图参数，以及对应的数据版本。', role: 'program' },
        { title: '检查数据与参数', text: '读取当前明细，检查字段、类型、范围和口径。输入异常明确报错，不替用户猜指标。', role: 'program' },
        { title: '计算或生成图表', text: '按请求执行聚合、占比、变化与贡献计算；绘图请求使用已计算的结果。', role: 'program' },
        { title: '任务结束：返回执行反馈', text: '返回数值、依据、结果编号或图表；错误也明确返回。交给L2决定继续还是回答。', role: 'program' },
      ], loops: [
        { label: '跨层反馈', from: '4 执行反馈', to: 'L2 第4步', text: 'L2决定下一次工具调用；工具层不自行解释用户意图。' },
      ] },
      { title: 'L4 数据回流层', caption: '接收成功结果 → 保存当时依据 → 回看与导出 → 完成留存', tone: 'archive', nodes: [
        { title: '任务开始：接收成功分析', text: '登录用户的模板分析与每次成功回答进入历史。游客、澄清、失败和评测不进入业务历史。', role: 'program' },
        { title: '保存当时的结果与依据', text: '按账号保存问题、字段口径、结论、执行依据和图表；有确认版本时记录数据版本引用。', role: 'program' },
        { title: '用户回看或导出', text: '查找过去的记录并核对当时结果。历史回看不重新计算，也不覆盖原结论。', role: 'human' },
        { title: '任务结束：历史留存完成', text: '形成可持续回看的分析记录。即时追问使用最近对话，历史留存不是自动推理循环。', role: 'program' },
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
        { title: '任务开始：明确复盘问题', text: '用户提供既有政策与两表直接复盘；也可点击预设问题、自由提问或沿当前销售/客户继续追问。', role: 'human' },
        { title: '确认范围与政策规则', text: '明确客户名单、活动周期、截止日、分层门槛、返点、封顶及缺行处理；文本抽取后人工核对。', role: 'human', gate: true },
        { title: '任务结束：形成复盘要求', text: '交付已确认的两表与规则，以及要查看的销售、客户或指标范围，用于核算和问答。', role: 'human' },
      ] },
      { title: 'L2 Agent 编排层', caption: '接收复盘问题 → 交付有依据的解答', tone: 'agent', loop: '导入和重算由政策程序直接核算；政策问答才进入模型—工具循环。规则解析是单次抽取，并非完整Agent循环。', nodes: [
        { title: '任务开始：准备复盘上下文', text: '问答接收本次问题、政策、截止日、筛选范围及最近对话；范围不清先澄清，不擅自换客户。', role: 'ai' },
        { title: '选择工具与继续下钻', text: '模型选择群体汇总、客户详情、趋势或绘图；根据执行反馈继续查询、修正或澄清。', role: 'ai' },
        { title: '任务结束：引用核算结果回答', text: 'Harness校验结果后回答，用户可继续追问客户、消耗过程或ROI；每次追问重新执行，引用真实核算。', role: 'program', gate: true },
      ] },
      { title: 'L3 实际执行层', caption: '接收两表与确认规则 → 返回核算结果', tone: 'execution', nodes: [
        { title: '任务开始：关联并检查数据', text: '程序按客户关联base与每日消耗，检查重复、缺日、期外和编外记录，保留待核验提示。', role: 'program' },
        { title: '核算达成、返货与ROI', text: '比较同天数base与cost6，计算档位及缺口；按增量现金计返并封顶，ROI采用同批获返客户。', role: 'program' },
        { title: '任务结束：交付复盘结果', text: '返回客户名单、双达成率、返货、ROI、趋势和质量提示，供页面展示、问答及导出。', role: 'program' },
      ] },
      { title: 'L4 数据回流层', caption: '接收成功复盘 → 保留当时规则与结论', tone: 'archive', nodes: [
        { title: '任务开始：接收复盘或问答', text: '登录用户导入、重算后的复盘，以及成功政策问答，进入各自账号的历史保存。', role: 'program' },
        { title: '保存核算快照与分析记录', text: '直接复盘保存规则与汇总快照；每次成功问答保存问题、答案、依据及图表，区别于即时对话上下文。', role: 'program' },
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
    {project === 'policy' && <section className="question-journey" aria-label={`${data.label}用户提问流程`}>
      <h2>预设分析之外，也可以问自己的问题</h2>
      <p>{project === 'policy' ? '两表与规则确认后，直接核算生成复盘；预设问答和自由提问则共用下面的Agent流程。' : '预设问题帮助快速体验，自由提问和后续追问使用同一套Agent执行流程。'}</p>
      <div className="question-entry-pair"><div><span>入口一</span><strong>{project==='policy'?'点击预设复盘问题':'点击预设分析问题'}</strong><p>先体验一个已准备好的问题。</p></div><div><span>入口二</span><strong>用户自由输入问题</strong><p>{project==='policy'?'围绕当前客户、销售、达成和ROI提问。':'围绕当前数据，自行指定指标、范围和图表。'}</p></div></div>
      <div className="question-merge" aria-hidden="true">两个入口 → 同一问答执行流程</div>
      <ol className="question-flow"><li><strong>1. 理解本次问题</strong><p>结合当前数据{project==='policy'?'、政策与筛选范围':''}和最近对话，判断问题与口径。</p></li><li className="question-condition"><strong>2. 条件是否明确？</strong><p>明确 → 选择工具；不明确 → 向用户澄清。</p></li><li><strong>3. 执行与校验</strong><p>调用查询、计算或绘图工具；失败返回错误并继续修正。</p></li><li><strong>4. 回答与展示依据</strong><p>交付真实结果、证据和图表，用户决定是否追问。</p></li></ol>
      <div className="question-return"><p><strong>澄清回路：</strong>用户补充条件 → 回到第1步，理解补充后的问题。</p><p><strong>追问回路：</strong>用户继续提问 → 携带最近对话回到第1步，再查数据和计算。</p><p><strong>历史留存：</strong>登录用户每次成功回答分别保存；游客不长期保存。停止追问后，本次体验结束。</p></div>
    </section>}
    {project === 'analysis' ? <AnalysisArchitecture /> : <section className="project-map" aria-label={`${data.label}执行架构`}><div className="project-map-heading"><h2>这件事怎样完成</h2><p>每层都从任务开始写到任务结束；Agent编排负责调度，实际执行负责计算，数据回流负责历史留存。</p></div><div className="project-legend" aria-label="职责图例">{Object.entries(roles).map(([role,label])=><span className={`project-role role-${role}`} key={role}>{label}</span>)}<span>强调边框：确认或校验关口</span></div>
      {data.layers.map(layer=><section className={`project-layer layer-${layer.tone}`} key={layer.title}><header><h3>{layer.title}</h3><p>{layer.caption}</p></header><ol className={`project-node-flow ${project === 'analysis' ? 'task-layer-flow' : ''}`}>{layer.nodes.map((node,i)=><li className={`project-node ${node.gate?'project-gate':''} ${node.future?'project-future':''}`} key={node.title}><span className="project-node-number">{i+1}</span><h4>{node.title}</h4><p>{node.text}</p>{node.role?<span className={`project-role role-${node.role}`}>{roles[node.role]}</span>:<span className="project-planned">后续规划</span>}</li>)}</ol>{layer.loops && <div className="layer-return-paths" aria-label={`${layer.title}分支与循环`}>{layer.loops.map(path=><div className="layer-return-path" key={path.label}><strong>{path.label}</strong><span className="layer-return-route">{path.from} <span aria-hidden="true">{path.label.includes('循环') ? '↶' : '→'}</span> {path.to}</span><p>{path.text}</p></div>)}</div>}{layer.loop&&<p className="project-feedback"><span aria-hidden="true">↶</span> {layer.loop}</p>}</section>)}
    </section>}
    <footer className="project-intro-footer"><p>{data.demo}</p><p className="project-boundary">{data.boundary}</p><button className="button primary" onClick={onStart}>{data.button}</button></footer>
  </article>
}
