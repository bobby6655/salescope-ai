# SaleScope AI

面向销售和运营的通用表格分析工作台。模型选择分析方法，本地工具执行真实计算。

## 功能

- 基础数据分析：CSV上传、字段类型和业务口径确认、聚合分组、图表、报告与自动评测。
- 自主变化分析：比较时段、日均涨幅、增量贡献、下滑拖累；缺数和零基期明确提示。
- 政策监控：两张Excel/CSV关联、政策规则确认、双达成率、增量返货、获返客户ROI与导出。
- ReAct工具循环：数据检查、字段解析、查询、变化分析、绘图、结果校验和错误修正。
- V1源码快照：位于versions/v1，SNAPSHOT.json记录完整性哈希。

## 本地运行

需要Node.js 22或更新版本。政策Excel解析需要Python 3。

~~~bash
npm ci --registry=https://npm.corp.kuaishou.com/
cp .env.example .env
# 在本机.env中填写万擎模型配置
npm run dev -- --host 127.0.0.1 --port 5180
~~~

打开 http://127.0.0.1:5180/，政策页为 http://127.0.0.1:5180/#policy 。
当前锁文件使用企业npm源，需要可访问该源的网络环境；模型调用需要自行配置可用凭证和端点。

## 验证

~~~bash
npm test
npm run check
npm run build
npm run package:v1
~~~

部分真实Excel和浏览器测试需要本机文件、开发服务、Chrome及模型环境。
仓库data目录只包含模拟样例；政策测试需要先上传自己的base与消耗表。

## 数据与版本

金额和比例由本地执行器计算；ROI只统计政策返货大于零的客户，分子与分母采用同一批客户。
政策返货保留达成和封顶，框架/渠道按正增量现金计算。结果是当前配置下的试算。
密钥、登录缓存、客户输入、运行时报告、图表和依赖不随源码上传。
V1快照按原哈希保留；GitHub副本不包含本地项目历史记录中的客户复盘。

## 公网部署

独立Node生产服务、用户隔离、Docker、Caddy HTTPS、GitHub Actions及回退流程见 [公网部署说明](docs/PUBLIC_DEPLOYMENT.md)。生产启动命令为`npm start`，必须配置账号和模型环境。
