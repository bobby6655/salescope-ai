import { spawn, execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile, open, rm } from 'node:fs/promises'
import { randomBytes, scryptSync } from 'node:crypto'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const command = process.argv[2] || 'status'
const home = path.resolve(process.argv[3] || path.join(root, 'runtime-data/local-host'))
const repository = path.resolve(process.argv[4] || (existsSync(path.join(root, '.git')) ? root : path.join(root, 'releases/salescope-ai-github')))
const stateFile = path.join(home, 'state.json')
const envFile = path.join(home, 'server.env')
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/KEY|TOKEN|SECRET|PASSWORD|^WQ_|^LLM_/.test(key)))
const git = (...args) => execFileSync('git', args, { cwd: repository, env: { ...cleanEnv, GIT_TERMINAL_PROMPT: '0' }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const state = async () => JSON.parse(await readFile(stateFile, 'utf8').catch(() => '{}'))
const save = value => writeFile(stateFile, JSON.stringify(value, null, 2), { mode: 0o600 })
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
function alive(pid) { if (!pid) return false; try { process.kill(pid, 0); return true } catch { return false } }
async function stopOwned(pid) {
  if (!alive(pid)) return
  const cmd = execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' })
  if (!cmd.includes(home)) throw new Error('PID不属于当前本机部署，拒绝停止')
  process.kill(pid, 'SIGTERM')
  const started = Date.now()
  while (alive(pid) && Date.now() - started < 195000) await delay(200)
  if (alive(pid)) throw new Error('旧服务仍在执行任务，未强制终止')
}
async function detached(executable, args, cwd, logfile, extraEnv = {}) {
  const output = await open(logfile, 'a', 0o600)
  const child = spawn(executable, args, { cwd, detached: true, env: { ...cleanEnv, ...extraEnv }, stdio: ['ignore', output.fd, output.fd] })
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject) })
  child.unref(); await output.close()
  return child.pid
}
async function config() {
  try { return JSON.parse(await readFile(path.join(home, 'config.json'), 'utf8')) } catch (error) { if (error.code !== 'ENOENT') throw error }
  try { process.loadEnvFile(path.join(root, '.env')) } catch {}
  const model = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(WQ_|LLM_)/.test(key)))
  if (!(model.LLM_API_KEY || model.WQ_API_KEY) || !(model.LLM_MODEL || model.WQ_MODEL_ID)) throw new Error('本机缺少模型配置，不能发布空模型服务')
  const password = randomBytes(24).toString('base64url')
  const salt = randomBytes(16).toString('hex')
  const users = { owner: `scrypt:${salt}:${scryptSync(password, salt, 32).toString('hex')}` }
  await writeFile(path.join(home, 'users.json'), JSON.stringify(users), { mode: 0o600 })
  await writeFile(path.join(home, 'credentials.txt'), `账号：owner\n密码：${password}\n仅保存在本机，不上传GitHub。\n`, { mode: 0o600 })
  const settings = { ...model, HOST: '127.0.0.1', PORT: '5310', DATA_ROOT: path.join(home, 'data'), WQ_DEMO_FALLBACK: 'false' }
  await writeFile(path.join(home, 'config.json'), JSON.stringify(settings), { mode: 0o600 })
  return settings
}
async function writeEnv(url) {
  const settings = { ...await config(), AUTH_USERS_JSON: await readFile(path.join(home, 'users.json'), 'utf8'), ...(url ? { PUBLIC_ORIGIN: url } : {}) }
  if (Object.values(settings).some(value => /[\r\n]/.test(String(value)))) throw new Error('环境变量不能包含换行')
  await writeFile(envFile, Object.entries(settings).map(([key, value]) => `${key}=${value}`).join('\n'), { mode: 0o600 })
}
async function release() {
  const origin = git('remote', 'get-url', 'origin')
  if (origin !== 'https://github.com/bobby6655/salescope-ai.git') throw new Error('只部署已授权的GitHub仓库')
  if (git('status', '--porcelain')) throw new Error('Git副本有未提交修改，请先处理；不覆盖本地开发')
  git('fetch', 'origin', 'main')
  const sha = git('rev-parse', 'origin/main')
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('Git提交ID无效')
  const directory = path.join(home, 'releases', sha)
  const current = await state()
  if (current.sha === sha && alive(current.appPid)) return { sha, directory, unchanged: true }
  await mkdir(directory, { recursive: true })
  const tar = execFileSync('git', ['archive', '--format=tar', sha], { cwd: repository, maxBuffer: 32 * 1024 * 1024 })
  execFileSync('tar', ['-xf', '-', '-C', directory], { input: tar })
  console.log(`验证Git版本 ${sha.slice(0, 7)}`)
  for (const args of [['ci', '--registry=https://npm.corp.kuaishou.com/'], ['test'], ['run', 'check'], ['run', 'build']]) execFileSync('npm', args, { cwd: directory, env: cleanEnv, stdio: 'inherit' })
  return { sha, directory }
}
async function startApp(directory) {
  let occupied = false
  try { await fetch('http://127.0.0.1:5310/api/health', { signal: AbortSignal.timeout(800) }); occupied = true } catch {}
  if (occupied) throw new Error('5310端口已由其他进程占用，不覆盖已有服务')
  const pid = await detached(process.execPath, [`--env-file=${envFile}`, path.join(directory, 'server/production.js')], directory, path.join(home, 'server.log'))
  for (let i = 0; i < 60; i++) {
    if (!alive(pid)) throw new Error('服务启动失败，请检查server.log')
    try { if ((await fetch('http://127.0.0.1:5310/api/health', { signal: AbortSignal.timeout(1000) })).ok) return pid } catch {}
    await delay(250)
  }
  await stopOwned(pid)
  throw new Error('服务未通过健康检查')
}
async function applyRelease(target, url) {
  const previous = await state()
  await writeEnv(url)
  await stopOwned(previous.appPid)
  let appPid
  try { appPid = await startApp(target.directory) } catch (error) {
    if (previous.directory) { previous.appPid = await startApp(previous.directory); await save(previous) }
    throw error
  }
  await save({ ...previous, ...target, appPid, url, previous: previous.directory ? { sha: previous.sha, directory: previous.directory } : null })
  if (process.platform === 'darwin') await detached('/usr/bin/caffeinate', ['-s', '-w', String(appPid)], home, path.join(home, 'awake.log'))
}
await mkdir(home, { recursive: true })
if (command === 'status') {
  const current = await state()
  console.log(JSON.stringify({ url: current.url, sha: current.sha, running: alive(current.appPid), tunnelRunning: alive(current.tunnelPid), autoUpdateRunning: alive(current.watchPid) }))
} else if (command === 'stop') {
  const current = await state()
  for (const pid of [current.watchPid, current.appPid, current.tunnelPid]) await stopOwned(pid)
  await save({ ...current, appPid: null, tunnelPid: null, watchPid: null })
  console.log('本机公网服务和自动更新已停止，数据保留。')
} else if (command === 'watch') {
  while (true) {
    try {
      const current = await state()
      if (!alive(current.appPid) || !alive(current.tunnelPid)) break
      git('fetch', 'origin', 'main')
      if (git('rev-parse', 'origin/main') !== current.sha) {
        const result = spawn(process.execPath, [fileURLToPath(import.meta.url), 'update', home, repository], { env: cleanEnv, stdio: 'inherit' })
        await new Promise(resolve => result.once('exit', resolve))
      }
    } catch (error) { console.error(error.message) }
    await delay(60000)
  }
} else if (['start', 'update', 'restart'].includes(command)) {
  const lock = path.join(home, 'deploy.lock')
  const handle = await open(lock, 'wx', 0o600).catch(() => { throw new Error('部署正在执行，请勿重复启动') })
  try {
    const current = await state()
    const target = command === 'restart' ? { sha: current.sha, directory: current.directory } : await release()
    if (command === 'restart') {
      if (!current.directory || !current.url) throw new Error('请先start创建本机服务')
      await applyRelease(target, current.url)
      console.log('已重启本机服务，账号/模型配置已重新加载，公网地址保持。')
    } else if (command === 'update') {
      if (!current.url) throw new Error('请先start创建公网入口')
      if (!target.unchanged) await applyRelease(target, current.url)
      console.log('本机服务已与main同步。')
    } else {
      if (alive(current.appPid) && alive(current.tunnelPid)) { console.log(current.url); process.exitCode = 0 }
      else {
        await config()
        const logfile = path.join(home, `tunnel-${Date.now()}.log`)
        const tunnelPid = await detached('cloudflared', ['tunnel', '--url', 'http://127.0.0.1:5310', '--protocol', 'http2', '--no-autoupdate', '--logfile', logfile], home, path.join(home, 'tunnel-launcher.log'))
        let url
        for (let i = 0; i < 120; i++) {
          if (!alive(tunnelPid)) break
          const log = await readFile(logfile, 'utf8').catch(() => '')
          url = log.match(/https:\/\/[a-z0-9]+(?:-[a-z0-9]+){2,}\.trycloudflare\.com/)?.[0]
          if (url) break
          await delay(250)
        }
        if (!url) { await stopOwned(tunnelPid); throw new Error('未创建公网隧道，请检查tunnel日志') }
        await save({ ...current, tunnelPid })
        await applyRelease(target, url)
        const now = await state()
        const watchPid = await detached(process.execPath, [fileURLToPath(import.meta.url), 'watch', home, repository], home, path.join(home, 'updates.log'))
        await save({ ...now, watchPid })
        console.log(JSON.stringify({ url, version: target.sha, username: 'owner', credentialsFile: path.join(home, 'credentials.txt'), autoUpdate: '每60秒检查main；验证通过后切换，数据独立保留' }))
      }
    }
  } finally { await handle.close(); await rm(lock, { force: true }) }
} else throw new Error('命令支持start/update/restart/status/stop')
