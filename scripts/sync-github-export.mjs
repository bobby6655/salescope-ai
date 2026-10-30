import { readdir, copyFile, readFile, writeFile, mkdir } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const target = path.join(root, 'releases/salescope-ai-github')
const origin = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: target, encoding: 'utf8' }).trim()
if (!['https://github.com/bobby6655/salescope-ai.git', 'git@github.com:bobby6655/salescope-ai.git'].includes(origin)) throw new Error('Git副本远端不匹配，停止同步')
const files = ['package.json', 'package-lock.json', 'vite.config.js', 'index.html', '.env.example', 'Dockerfile', '.dockerignore', 'vercel.json', '.vercelignore']
async function collect(directory) {
  for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
    const relative = path.join(directory, entry.name)
    if (entry.isDirectory()) await collect(relative)
    else if (entry.isFile() && (!entry.name.startsWith('.') || relative === 'deploy/.env.production.example')) files.push(relative)
    else if (!entry.isFile()) throw new Error(`拒绝符号链接：${relative}`)
  }
}
for (const directory of ['src', 'server', 'scripts', 'data', 'deploy', '.github', 'docs']) await collect(directory)
const allowedData = new Set(['sales-data.csv', 'orders-en.csv', 'ads-data.csv', 'ambiguous-data.csv', 'specialty-data.csv', 'policy-demo.json'])
const selected = files.filter(file => !file.startsWith('data/') || allowedData.has(path.basename(file)))
const env = await readFile(path.join(root, '.env'), 'utf8').catch(() => '')
const secrets = env.split(/\r?\n/).filter(line => /^[A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)=/.test(line)).map(line => line.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')).filter(value => value.length > 8)
for (const filename of selected) {
  const source = path.join(root, filename)
  const content = await readFile(source, 'utf8')
  if (secrets.some(secret => content.includes(secret))) throw new Error(`文件包含本机密钥：${filename}`)
  if (/(?:ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/.test(content)) throw new Error(`文件包含凭证特征：${filename}`)
  const destination = path.join(target, filename)
  await mkdir(path.dirname(destination), { recursive: true })
  await copyFile(source, destination)
}
const ignore = await readFile(path.join(target, '.gitignore'), 'utf8')
if (!ignore.includes('runtime-data/')) await writeFile(path.join(target, '.gitignore'), `${ignore}\nruntime-data/\nauth-users*.json\n!deploy/.env.production.example\n`)
if (!ignore.includes('.vercel/')) await writeFile(path.join(target,'.gitignore'),`${await readFile(path.join(target,'.gitignore'),'utf8')}\n.vercel/\n`)
const readme = await readFile(path.join(target, 'README.md'), 'utf8')
if (!readme.includes('docs/PUBLIC_DEPLOYMENT.md')) await writeFile(path.join(target, 'README.md'), `${readme}\n## 公网部署\n\n独立Node生产服务、用户隔离、Docker、Caddy HTTPS、GitHub Actions及回退流程见 [公网部署说明](docs/PUBLIC_DEPLOYMENT.md)。生产启动命令为\`npm start\`，必须配置账号和模型环境。\n`)
console.log(JSON.stringify({ target, synced: selected.length, credentialScan: 'passed', v1: '未修改', excluded: '真实数据、运行时文件、密钥及客户复盘文档' }))
