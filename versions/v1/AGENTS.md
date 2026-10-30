# AGENTS.md

## 项目概述
SaleScope AI 是一个面向销售与业务人员的销售数据分析工作台 MVP。当前版本使用模拟销售数据，在浏览器内展示 KPI、趋势、地区分布、热销产品和 AI 洞察交互。
- `PROJECT_CONTEXT.md` 是压缩后的项目上下文与迭代历史；继续开发前优先阅读，更新重要能力后同步补充。

## 技术栈
- 框架：React + Vite
- 样式：原生 CSS，企业亮色设计令牌
- 图表：React 内联 SVG 趋势图
- 数据：`data/sales-data.csv` 模拟数据，页面默认加载预设聚合结果
- AI：万擎模型生成 JSON 查询计划，本地分析服务执行真实计算
- npm 源：`https://npm.corp.kuaishou.com/`

## 设计记录
- Mode：C（从零生成）
- Scene：数据看板 — `references/website-design/scenes/dashboard.md`
- Scene Rules Applied：状态栏、告警/数据质量提示、核心 KPI 横条、趋势图、维度拆解、明细排行；使用紧凑卡片、状态色和数字等宽对齐。
- Theme：A 企业亮色 — `references/website-design/themes/A-enterprise-light.md`
- Theme Tokens Applied：主色 `#3B6CF4` → `--blue`；页面底色 `#F7F8FA` → `--page`；边框 `#DFE0E8` → `--line`；成功/告警/危险分别映射 `--green`、`--orange`、`--red`；图表序列采用蓝、青绿、琥珀、紫、朱红。
- Purpose：帮助不会写公式的销售和业务人员快速看懂经营表现。
- Tone：克制、可信、清晰，有轻微 AI 辅助感。
- Differentiation：左侧工作台导航 + 状态型数据看板 + 可直接提问的数据输入框。
- Assistant Flow：用户问题 / 列名 → 万擎 JSON plan → 本地校验与执行 → 固定格式「答案、依据、步骤」。
- Conversation Flow：前端保存最近 10 条 user/assistant 消息；模型可返回 `plan` 或 `clarify`，缺少时间/指标/维度时先追问，不直接猜数字。
- Self-Checks Required：按钮 focus/active/loading/error 思路；移动端 768/480 断点；数据表格横向滚动；图表与 KPI 数字可读性；状态色只用于状态表达。

## 注意事项
- 项目包含独立的总览、数据源和分析报告页面。数据源页展示字段、预览、日期/金额/折扣/重复检查；分析报告页展示 Agent 循环、错误修正、最终答案和依据。
- 画图能力由 `src/chartGenerator.js` 生成 SVG，由 `server/chartService.js` 保存到 `charts/` 并通过 `/charts/*` 提供访问；最终答案必须包含图片保存路径。
- 自动评测由 `src/evaluationCases.js` 定义题目，页面逐题调用 `/api/assistant`，服务端把完整结果保存到 `evaluations/latest.json`；评测通过标准必须检查真实答案或图片结果，不只检查接口状态。
- `server/assistant-plugin.js` 是 Vite 本地分析插件，读取 `.env` 中的 `WQ_API_KEY` 和 `WQ_MODEL_ID`；不要把密钥写进源代码或前端产物。
- 服务端会把当前日期注入 Wanqing 上下文；“去年”按当前年份减一推断，并用查询计划校验确保对应年份筛选存在。
- `npm run check` 会实际解析模拟 CSV 并验证字段、数据质量、聚合结果和关键交互保护；`npm run build` 用于验证生产构建。

## 2026-10-29 ReAct 迭代
- `server/agentLoop.js` 执行模型驱动的 JSON 工具循环：`inspect_data`、`query_data`、`render_chart`、`finish`、`clarify`。每次工具执行结果或错误作为 Observation 追加到同一次模型对话，最多 8 轮、总计 180 秒。
- 模型完成答案必须引用已计算的 result_id，图表必须引用对应结果的 chart_id；真实数字由本地生成，模型不执行任意代码。
- 二维分组支持两个不同的维度，例如月份 × 地区、地区 × 产品，支持求和、平均与组内占比。图表新增 stacked-bar；堆积图不能悄悄降级为其他图表。
- `npm test` 是行为回归测试，覆盖真实金额、占比、跨年、工具错误修复、图表一致性和循环上限；`npm run check` 仍包含结构检查，不能替代行为验证。
- 本轮设计：Mode C-in-Existing；主场景 dashboard、主题 A 企业亮色。新增范围为生成图表、结果系列文本和快捷问题；既有页面布局保持。Chart Tokens Applied：系列 #3B6CF4/#00B09B/#F5A623/#9B59B6/#E84848，网格 #F0F1F5、图例 #696B80；图例换行，月份使用年月避免跨年混淆，窄屏图表横向滚动。
- Self-Checks Required：SVG 分段总额与原始数据一致、金额/百分比单位正确、图例与标题不重叠、移动端完整图片可滚动、结果系列不导致白屏、真实调用必须检查 source=wanqing。
- 万擎 HTTP 429 时按 Retry-After 或错误中的等待秒数重试，最多 2 次限流重试，每次最多等待 60 秒，并计入总分析时限；限流提示保留在步骤中。
- Loaded Files：pde-agent 的 website-design-integration.md、website-design/website-design.md、website-design/scenes/dashboard.md、website-design/themes/A-enterprise-light.md。检查记录：图表标题/图例不重叠（实际 Chrome 渲染 pass）；图表主题色序与金额/百分比单位（实际 SVG 与行为测试 pass）；页面初始布局（实际 Chrome 渲染 pass）；分析报告交互全量验证尚未完成，原生浏览器自动化超时，不能以构建成功替代。
