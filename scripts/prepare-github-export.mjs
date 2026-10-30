import { readFile, writeFile, readdir, mkdir, copyFile, lstat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const target = path.join(root, 'releases/salescope-ai-github')
const files = ['package.json', 'package-lock.json', 'vite.config.js', 'index.html', '.env.example']
async function sourceFiles(directory) {
  for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
    const relative = path.join(directory, entry.name)
    if (entry.isDirectory()) await sourceFiles(relative)
    else if (entry.isFile()) files.push(relative)
    else throw new Error(`不导出符号链接或特殊文件：${relative}`)
  }
}
for (const directory of ['src', 'server', 'scripts']) await sourceFiles(directory)
for (const name of ['sales-data.csv', 'orders-en.csv', 'ads-data.csv', 'ambiguous-data.csv', 'specialty-data.csv']) files.push(`data/${name}`)
const manifest = JSON.parse(await readFile(path.join(root, 'versions/v1/SNAPSHOT.json'), 'utf8'))
for (const entry of manifest.files) {
  const filename = `versions/v1/${entry.file}`
  if (!/^(?:src\/|server\/|scripts\/|data\/|charts\/|(?:AGENTS|PROJECT_CONTEXT|README)\.md$|package(?:-lock)?\.json$|vite\.config\.js$|index\.html$|\.env\.example$|\.gitignore$)/.test(entry.file)) throw new Error(`快照白名单之外的文件：${entry.file}`)
  const bytes = await readFile(path.join(root, filename))
  if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw new Error(`v1哈希不一致：${entry.file}`)
  files.push(filename)
}
files.push('versions/v1/SNAPSHOT.json')
try { await lstat(target); throw new Error('源码副本目录已存在，请先检查后再同步，避免覆盖已有Git仓库') } catch (error) { if (error.code !== 'ENOENT') throw error }
await mkdir(target, { recursive: true })
for (const filename of files) {
  const destination = path.join(target, filename)
  await mkdir(path.dirname(destination), { recursive: true })
  await copyFile(path.join(root, filename), destination)
}
const readme = `# SaleScope AI

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
`
await writeFile(path.join(target, 'README.md'), readme)
await writeFile(path.join(target, '.gitignore'), `node_modules/\ndist/\n.env\n.env.*\n!.env.example\n.ks_sso/\n.DS_Store\n*.log\npolicy-data/\npolicy-reports/\nevaluations/\ncharts/\nreleases/\n!versions/v1/charts/\n!versions/v1/charts/*.svg\n`)
const environment = await readFile(path.join(root, '.env'), 'utf8').catch(() => '')
const secrets = environment.split(/\r?\n/).filter(line => /^[A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)=/.test(line)).map(line => line.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')).filter(value => value.length > 8)
for (const filename of [...files, 'README.md', '.gitignore']) {
  const content = await readFile(path.join(target, filename), 'utf8')
  if (secrets.some(secret => content.includes(secret))) throw new Error(`源码副本含当前密钥，停止上传：${filename}`)
  if (/(?:ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/.test(content)) throw new Error(`源码副本含凭证特征，停止上传：${filename}`)
}
console.log(JSON.stringify({ target, files: files.length + 2, verifiedV1: manifest.files.length, credentialScan: 'passed', excluded: ['.env', '.ks_sso', 'node_modules', 'dist', 'policy-data', 'policy-reports', 'evaluations', '运行时charts', '本地AGENTS与PROJECT_CONTEXT客户复盘'] }, null, 2))
