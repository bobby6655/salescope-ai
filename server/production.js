import http from 'node:http'
import { readFile, stat, readdir, rm } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { scryptSync, timingSafeEqual, createHash, randomBytes } from 'node:crypto'
import { registerApiRoutes } from './assistant-plugin.js'
import { withUserStorage, withGuestStorage } from './storageContext.js'
import { loginPage, loginScript } from './loginPage.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' }
const json = (response, status, payload) => { response.statusCode = status; response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(payload)) }

export function createProductionServer({ users = JSON.parse(process.env.AUTH_USERS_JSON || '{}'), dataRoot = process.env.DATA_ROOT || path.join(root, 'runtime-data'), distRoot = path.join(root, 'dist'), publicOrigin = process.env.PUBLIC_ORIGIN || '', publicOriginAliases = JSON.parse(process.env.PUBLIC_ORIGIN_ALIASES || '[]'), maxConcurrent = Number(process.env.MAX_CONCURRENT_ANALYSES || 4), routes: suppliedRoutes } = {}) {
  if (!Object.keys(users).length) throw new Error('生产服务必须配置AUTH_USERS_JSON，不能匿名开放分析接口')
  if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 32) throw new Error('MAX_CONCURRENT_ANALYSES必须为1到32的整数')
  if (!Array.isArray(publicOriginAliases) || publicOriginAliases.some(value => { try { const url=new URL(value); return typeof value!=='string' || url.protocol!=='https:' || url.origin!==value || url.hostname.includes('*') } catch { return true } })) throw new Error('PUBLIC_ORIGIN_ALIASES需要明确的HTTPS来源数组，不能使用通配符')
  for (const [name, hash] of Object.entries(users)) if (!/^[A-Za-z0-9_.-]{1,64}$/.test(name) || !/^scrypt:[a-f0-9]{32}:[a-f0-9]{64}$/.test(hash)) throw new Error('账号名称或scrypt密码哈希格式无效')
  const routes = suppliedRoutes ?? []
  if (!suppliedRoutes) registerApiRoutes({ use: (prefix, handler) => routes.push({ prefix, handler }) })
  const authenticated = new Map()
  const sessions = new Map()
  const guests = new Map(), guestRates = new Map()
  let guestConcurrent = 0
  const guestCookie = 'salescope_guest', guestAge = 2 * 60 * 60 * 1000
  const cookieName = 'salescope_session'
  const sessionAge = 12 * 60 * 60
  const busyUsers = new Set()
  const failed = new Map()
  let concurrent = 0
  const verifyPassword = (name, password) => {
    if (typeof name !== 'string' || typeof password !== 'string' || !/^[A-Za-z0-9_.-]{1,64}$/.test(name) || password.length > 256) return false
    const hash = Object.hasOwn(users, name) ? users[name] : null
    if (!hash) return false
    const [, salt, digest] = hash.split(':')
    return timingSafeEqual(scryptSync(password, salt, 32), Buffer.from(digest, 'hex'))
  }
  const cookieToken = (request, name) => String(request.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`))?.slice(name.length + 1)
  const sessionToken = request => cookieToken(request, cookieName)
  const authenticate = (request) => {
    const token = sessionToken(request)
    const session = sessions.get(token)
    if (session?.expires > Date.now() && Object.hasOwn(users, session.user)) return session.user
    if (session) sessions.delete(token)
    const header = request.headers.authorization || ''
    if (!header.startsWith('Basic ') || header.length > 2048) return null
    const cacheKey = createHash('sha256').update(header).digest('hex')
    const cached = authenticated.get(cacheKey)
    if (cached && cached.expires > Date.now()) return cached.user
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8')
    const colon = decoded.indexOf(':')
    const name = decoded.slice(0, colon), password = decoded.slice(colon + 1)
    if (colon < 1 || !verifyPassword(name, password)) return null
    if (authenticated.size > 500) authenticated.clear()
    authenticated.set(cacheKey, { user: name, expires: Date.now() + 15 * 60 * 1000 })
    return name
  }
  const server = http.createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('Referrer-Policy', 'no-referrer')
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'")
    let pathname
    try { pathname = new URL(request.url, 'http://localhost').pathname } catch { return json(response, 400, { error: 'URL格式无效' }) }
    if (pathname === '/api/health' && request.method === 'GET') return json(response, 200, { status: 'ok', version: '2.0.0' })
    const expectedOrigin = publicOrigin || `http://${request.headers.host}`
    const acceptsOrigin = value => !value || value === expectedOrigin || publicOriginAliases.includes(value)
    const cookieFlags = `Path=/; HttpOnly; SameSite=Strict${expectedOrigin.startsWith('https://') ? '; Secure' : ''}`
    if (pathname === '/login' && request.method === 'GET') { response.setHeader('Content-Type', 'text/html; charset=utf-8'); return response.end(loginPage) }
    if (pathname === '/auth/login.js' && request.method === 'GET') { response.setHeader('Content-Type', 'text/javascript; charset=utf-8'); return response.end(loginScript) }
    if (pathname === '/api/auth/login' && request.method === 'POST') {
      if (!String(request.headers['content-type']).startsWith('application/json')) return json(response, 415, { error: '登录请求必须为JSON' })
      if (!acceptsOrigin(request.headers.origin)) return json(response, 403, { error: '不允许跨站登录' })
      let body = ''
      try {
        for await (const chunk of request) { body += chunk; if (Buffer.byteLength(body) > 4096) throw new Error('too large') }
        const { username, password } = JSON.parse(body)
        const key = `login:${request.socket.remoteAddress}:${String(username).slice(0, 64)}`
        const prior = failed.get(key)
        if (prior?.count >= 10 && prior.until > Date.now()) return json(response, 429, { error: '登录尝试过多，请稍后重试' })
        if (!verifyPassword(username, password)) {
          if (failed.size > 1000) failed.clear()
          failed.set(key, { count: (prior?.until > Date.now() ? prior.count : 0) + 1, until: Date.now() + 60000 })
          return json(response, 401, { error: '账号或密码不正确' })
        }
        failed.delete(key)
        for (const [token, session] of sessions) if (session.expires <= Date.now()) sessions.delete(token)
        if (sessions.size >= 1000) return json(response, 503, { error: '当前登录人数已达上限，请稍后重试' })
        const token = randomBytes(32).toString('base64url')
        sessions.set(token, { user: username, expires: Date.now() + sessionAge * 1000 })
        response.setHeader('Set-Cookie', `${cookieName}=${token}; Max-Age=${sessionAge}; ${cookieFlags}`)
        return json(response, 200, { ok: true, user: username })
      } catch { return json(response, 400, { error: '登录请求格式无效' }) }
    }
    const demoRoute = pathname.startsWith('/api/demo/'), address = request.socket.remoteAddress || 'unknown'
    let guest, effectivePath = pathname
    if (demoRoute) {
      const allowed = request.method === 'POST' && ['/api/demo/session', '/api/demo/assistant', '/api/demo/policy/question'].includes(pathname) || request.method === 'GET' && ['/api/demo/session', '/api/demo/policy/current', '/api/demo/policy/export'].includes(pathname) || request.method === 'GET' && /^\/api\/demo\/charts\/[A-Za-z0-9_.-]+\.svg$/.test(pathname)
      if (!allowed) return json(response, 403, { error: '游客只能查看和分析模拟数据；上传、规则修改与历史需要登录' })
      if (request.method === 'POST' && (!String(request.headers['content-type']).startsWith('application/json') || !acceptsOrigin(request.headers.origin))) return json(response, 403, { error: '不允许跨站游客请求' })
      if (Number(request.headers['content-length']) > 64000) return json(response, 413, { error: '游客请求过大' })
      const now = Date.now(), token = cookieToken(request, guestCookie)
      guest = guests.get(token)
      if (guest?.expires <= now) { guests.delete(token); guest = null }
      if (pathname === '/api/demo/session') {
        if (!guest) {
          if (request.method !== 'POST') return json(response, 401, { error: '游客会话已过期，请刷新页面' })
          for (const [key, value] of guests) if (value.expires <= now) guests.delete(key)
          let rate = guestRates.get(address)
          if (!rate || rate.expires <= now) { rate = { creates: 0, queries: 0, expires: now + 3600000 }; guestRates.set(address, rate) }
          if (rate.creates >= 30 || guests.size >= 1000) return json(response, 429, { error: '游客体验请求较多，请稍后重试或登录' })
          rate.creates += 1
          const id = randomBytes(32).toString('hex')
          guest = { id, expires: now + guestAge, queries: 0 }; guests.set(id, guest)
          response.setHeader('Set-Cookie', `${guestCookie}=${id}; Max-Age=7200; ${cookieFlags}`)
        }
        return json(response, 200, { kind: 'guest', expiresAt: new Date(guest.expires).toISOString() })
      }
      if (!guest) return json(response, 401, { error: '游客会话已过期，请刷新页面' })
      effectivePath = pathname.replace('/api/demo/charts', '/charts').replace('/api/demo/', '/api/')
      if (request.method === 'POST') {
        let rate = guestRates.get(address)
        if (!rate || rate.expires <= now) { rate = { creates: 0, queries: 0, expires: now + 3600000 }; guestRates.set(address, rate) }
        if (guest.queries >= 10 || rate.queries >= 30 || guestConcurrent >= 2) return json(response, 429, { error: '游客分析额度或并发已达上限，请稍后重试或登录' })
        // 每会话最多10次，按连接来源再限制每小时30次；配额只在任务被接受时扣除。
      }
    }
    const attempts = failed.get(address)
    const user = authenticate(request)
    const publicPage = ['GET', 'HEAD'].includes(request.method) && !pathname.startsWith('/api/') && !pathname.startsWith('/charts/')
    if (!user && (request.headers.authorization || !guest && !publicPage)) {
      if (request.headers.authorization) {
        if (attempts && attempts.count >= 10 && attempts.until > Date.now()) return json(response, 429, { error: '登录尝试过多，请稍后重试' })
        if (failed.size > 1000) failed.clear()
        const previous = attempts && attempts.until > Date.now() ? attempts.count : 0
        failed.set(address, { count: previous + 1, until: Date.now() + 60000 })
      }
      if (request.headers.authorization?.startsWith('Basic ')) response.setHeader('WWW-Authenticate', 'Basic realm="SaleScope", charset="UTF-8"')
      return json(response, 401, { error: '需要有效账号才能访问' })
    }
    failed.delete(address)
    if (pathname === '/api/auth/session' && request.method === 'GET') return json(response, 200, { user })
    if (pathname === '/api/auth/logout' && request.method === 'POST') {
      if (!String(request.headers['content-type']).startsWith('application/json') || !acceptsOrigin(request.headers.origin)) return json(response, 403, { error: '不允许跨站退出' })
      sessions.delete(sessionToken(request))
      response.setHeader('Set-Cookie', `${cookieName}=; Max-Age=0; ${cookieFlags}`)
      return json(response, 200, { ok: true })
    }
    if (!['GET', 'HEAD', 'POST'].includes(request.method)) return json(response, 405, { error: '不支持的请求方法' })
    if (request.method === 'POST') {
      if (Number(request.headers['content-length']) > 12 * 1024 * 1024) return json(response, 413, { error: '上传请求超过12MB' })
      if (!String(request.headers['content-type']).startsWith('application/json')) return json(response, 415, { error: '写入接口仅接受application/json' })
      if (!acceptsOrigin(request.headers.origin)) return json(response, 403, { error: '不允许跨站请求' })
      const principal = guest ? `guest:${guest.id}` : user
      if (busyUsers.has(principal) || concurrent >= maxConcurrent) return json(response, 429, { error: '当前有分析或上传正在执行，请稍后重试' })
      busyUsers.add(principal); concurrent += 1
      if (guest) { guest.queries += 1; guestRates.get(address).queries += 1; guestConcurrent += 1 }
      let released = false
      const release = () => { if (!released) { released = true; busyUsers.delete(principal); concurrent -= 1; if (guest) guestConcurrent -= 1 } }
      // 在处理函数结束前保留锁；客户端中断不会解除仍在执行的模型/写入操作。
      response.taskRelease = release
    }
    try {
      const scope = callback => guest ? withGuestStorage(guest.id, dataRoot, callback) : withUserStorage(user || '__public_static__', dataRoot, callback)
      await scope(async () => {
        const route = routes.find(route => effectivePath === route.prefix || effectivePath.startsWith(`${route.prefix}/`))
        if (route) {
          const original = request.url
          request.url = effectivePath.slice(route.prefix.length) + (new URL(original, 'http://localhost').search || '') || '/'
          let next = false
          try { await route.handler(request, response, () => { next = true }) } finally { request.url = original }
          if (next && !response.writableEnded) json(response, 404, { error: '资源不存在' })
          return
        }
        if (pathname.startsWith('/api/') || pathname.startsWith('/charts/')) return json(response, 404, { error: '接口不存在' })
        if (request.method === 'POST') return json(response, 404, { error: '接口不存在' })
        let relative
        try { relative = decodeURIComponent(pathname).replace(/^\/+/, '') } catch { return json(response, 400, { error: 'URL编码无效' }) }
        const filename = path.resolve(distRoot, relative || 'index.html')
        if (!filename.startsWith(`${path.resolve(distRoot)}${path.sep}`) || relative.split('/').some(part => part.startsWith('.'))) return json(response, 403, { error: '访问被拒绝' })
        let asset = filename
        try { if (!(await stat(asset)).isFile()) throw new Error('not a file') } catch { if (path.extname(relative)) return json(response, 404, { error: '文件不存在' }); asset = path.join(distRoot, 'index.html') }
        response.setHeader('Content-Type', mime[path.extname(asset)] || 'application/octet-stream')
        if (request.method === 'HEAD') return response.end()
        const stream = createReadStream(asset)
        stream.on('error', () => { if (!response.headersSent) json(response, 404, { error: '文件不存在' }); else response.destroy() })
        stream.pipe(response)
      })
    } catch { if (!response.writableEnded) json(response, 500, { error: '服务处理失败，请检查服务端日志' }) }
    finally { response.taskRelease?.() }
  })
  server.requestTimeout = 200000
  const cleanup = setInterval(async () => {
    const now = Date.now()
    for (const [key, value] of guestRates) if (value.expires < now) guestRates.delete(key)
    for (const [key, value] of guests) if (value.expires < now && !busyUsers.has(`guest:${key}`)) guests.delete(key)
    try {
      const directory = path.join(dataRoot, 'guests')
      for (const entry of await readdir(directory, { withFileTypes: true })) if (entry.isDirectory() && /^[a-f0-9]{64}$/.test(entry.name) && !busyUsers.has(`guest:${entry.name}`)) {
        const location = path.join(directory, entry.name)
        if (!guests.has(entry.name) && now - (await stat(location)).mtimeMs > guestAge) await rm(location, { recursive: true, force: true })
      }
    } catch {}
  }, 60000)
  cleanup.unref(); server.on('close', () => clearInterval(cleanup))
  server.headersTimeout = 15000
  return server
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = createProductionServer()
  const port = Number(process.env.PORT || 3000)
  server.listen(port, process.env.HOST || '0.0.0.0', () => console.log(`SaleScope production listening on ${port}`))
  const shutdown = () => { server.close(); setTimeout(() => process.exit(0), 190000).unref() }
  process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown)
}
