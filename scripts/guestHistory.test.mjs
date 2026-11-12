import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomBytes, scryptSync } from 'node:crypto'
import { createProductionServer } from '../server/production.js'
import { registerApiRoutes } from '../server/assistant-plugin.js'
import { withUserStorage, storageDirectory } from '../server/storageContext.js'
import { parseCsv } from '../src/datasetEngine.js'

const password = 'test-password', salt = randomBytes(16).toString('hex')
const hash = `scrypt:${salt}:${scryptSync(password, salt, 32).toString('hex')}`
const auth = name => 'Basic ' + Buffer.from(`${name}:${password}`).toString('base64')
const stubModel = async messages => {
  const question = messages.find(m => m.role === 'user')?.content || ''
  if (question.includes('澄清')) return JSON.stringify({ action: 'clarify', message: '请确认日期' })
  const last = messages.at(-1).content
  if (last.includes('"chart_id":"chart-1"')) return JSON.stringify({ action: 'finish', result_id: 'result-1', chart_id: 'chart-1' })
  if (last.startsWith('Observation') && last.includes('"result_id":"result-1"')) return JSON.stringify(question.includes('图') ? { action: 'render_chart', result_id: 'result-1', type: 'bar', title: '记录数' } : { action: 'finish', result_id: 'result-1' })
  return JSON.stringify(messages[0].content.includes('policy_summary') ? { action: 'policy_summary', metric: 'roi', filters: [] } : { action: 'query_data', plan: { group_by: [], measures: [{ column: null, aggregate: 'count', alias: '记录数' }], filters: [], order: null, limit: null } })
}
async function setup(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'salescope-history-'))
  const routes = []; registerApiRoutes({ use: (prefix, handler) => routes.push({ prefix, handler }) }, { modelCall: stubModel })
  const options = { users: { alice: hash, bob: hash }, dataRoot: directory, routes }
  const servers = []
  const start = async () => { const server = createProductionServer(options); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); servers.push(server); return `http://127.0.0.1:${server.address().port}` }
  const origin = await start()
  t.after(async () => { for (const server of servers) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) } await rm(directory, { recursive: true, force: true }) })
  const request = (route, { user = 'alice', cookie, body, method } = {}) => fetch(origin + route, { method: method || (body ? 'POST' : 'GET'), headers: { ...(user ? { Authorization: auth(user) } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })
  return { origin, directory, request, restart: start }
}
const rows = [{ 日期: '2026-11-01', 客户: '私有客户甲', 收入: 10 }, { 日期: '2026-11-02', 客户: '私有客户乙', 收入: 20 }]
const analysis = (question = '记录数是多少？', requestId) => ({ question, rows, headers: Object.keys(rows[0]), datasetName: 'test.csv', requestId })

test('guest root is public; private uploads, histories and accounts remain protected', async t => {
  const app = await setup(t)
  const guest = await app.request('/api/demo/session', { user: null, body: {} }), cookie = guest.headers.get('set-cookie').split(';')[0]
  assert.equal(guest.status, 200); assert.match(guest.headers.get('set-cookie'), /HttpOnly/)
  const demo = await (await app.request('/api/demo/policy/current', { user: null, cookie })).json()
  assert.equal(demo.summary.count, 20); assert.ok(demo.customers.every(c => c.customer.startsWith('模拟')))
  for (const route of ['/api/history', '/api/policy/current', '/charts/private.svg']) assert.equal((await app.request(route, { user: null, cookie })).status, 401)
  for (const route of ['/api/demo/policy/import', '/api/demo/policy/recalculate', '/api/demo/history', '/api/demo/evaluation']) assert.equal((await app.request(route, { user: null, cookie, body: {} })).status, 403)
  const foreign = await fetch(app.origin + '/api/demo/session', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: '{}' })
  assert.equal(foreign.status, 403)
})

test('guest analysis ignores forged rows, isolates charts and never stores permanent history', async t => {
  const app = await setup(t)
  const makeGuest = async () => (await app.request('/api/demo/session', { user: null, body: {} })).headers.get('set-cookie').split(';')[0]
  const cookie = await makeGuest(), other = await makeGuest()
  const result = await (await app.request('/api/demo/assistant', { user: null, cookie, body: { ...analysis('画记录数柱状图'), sample: 'orders' } })).json()
  const demo = parseCsv(await readFile(new URL('../data/sales-data.csv', import.meta.url), 'utf8'))
  assert.equal(result.rows[0].value, demo.rows.length)
  assert.equal(result.historyId, undefined)
  assert.equal(result.chart.filePath, undefined)
  assert.ok(result.chart.publicPath.startsWith('/api/demo/charts/'))
  assert.equal((await app.request(result.chart.publicPath, { user: null, cookie })).status, 200)
  assert.equal((await app.request(result.chart.publicPath, { user: null, cookie: other })).status, 404)
  for (let i = 0; i < 9; i++) assert.equal((await app.request('/api/demo/assistant', { user: null, cookie, body: analysis() })).status, 200)
  assert.equal((await app.request('/api/demo/assistant', { user: null, cookie, body: analysis() })).status, 429)
})

test('history autosaves once, excludes clarification and evaluations, and isolates accounts', async t => {
  const app = await setup(t)
  const response = await app.request('/api/assistant', { body: analysis('记录数是多少？', 'dedupe-test-1234') })
  assert.equal(response.status, 200); const result = await response.json(); assert.ok(result.historyId)
  await app.request('/api/assistant', { body: analysis('记录数是多少？', 'dedupe-test-1234') })
  await app.request('/api/assistant', { body: analysis('澄清日期') })
  const failedRequest = await app.request('/api/assistant', { body: { ...analysis(), rows: [] } })
  assert.equal(failedRequest.status, 400)
  const failure = await failedRequest.json()
  assert.equal(failure.historyId, undefined)
  await app.request('/api/assistant', { body: { ...analysis(), purpose: 'evaluation' } })
  const list = await (await app.request('/api/history')).json(); assert.equal(list.total, 1)
  assert.equal((await (await app.request('/api/history?from=1900-01-01&to=1900-01-02')).json()).total, 0)
  assert.equal((await app.request('/api/history?from=invalid')).status, 400)
  assert.equal((await (await app.request('/api/history', { user: 'bob' })).json()).total, 0)
  assert.equal((await app.request('/api/history/' + result.historyId, { user: 'bob' })).status, 404)
  assert.equal((await app.request('/api/history/' + result.historyId + '/delete', { user: 'bob', body: {} })).status, 404)
  const record = await (await app.request('/api/history/' + result.historyId)).json()
  assert.equal(record.result.rows[0].value, 2); assert.equal(record.dataset.rowCount, 2)
  assert.ok(!JSON.stringify(record).includes('私有客户甲'))
  const nextOrigin = await app.restart()
  assert.equal((await fetch(nextOrigin + '/api/history/' + result.historyId, { headers: { Authorization: auth('alice') } })).status, 200)
  const deletion = await app.request('/api/history/' + result.historyId + '/delete', { body: {} }); assert.equal(deletion.status, 200)
  assert.equal((await app.request('/api/history/' + result.historyId)).status, 404)
})

test('historical charts are independent copies; snapshots preserve old rules and totals', async t => {
  const app = await setup(t)
  const result = await (await app.request('/api/assistant', { body: { ...analysis('画记录数柱状图'), sample: 'orders' } })).json()
  assert.ok(result.historyId)
  await withUserStorage('alice', app.directory, () => rm(path.join(storageDirectory('charts'), result.chart.fileName)))
  assert.equal((await app.request(`/api/history/${result.historyId}/chart`)).status, 200)
  assert.equal((await app.request(`/api/history/${result.historyId}/export?format=md`)).status, 200)
  const snapshot = await (await app.request('/api/policy/recalculate', { body: { rules: { annualRate: .1 }, asOf: '2026-10-07', requestId: 'snapshot-1234' } })).json()
  assert.ok(snapshot.historyId)
  await app.request('/api/policy/recalculate', { body: { rules: { annualRate: .2 }, asOf: '2026-10-06' } })
  const record = await (await app.request(`/api/history/${snapshot.historyId}`)).json()
  assert.equal(record.result.rules.annualRate, .1); assert.equal(record.result.asOf, '2026-10-07')
  assert.equal(record.result.customers[0].daily, undefined)
  assert.equal((await app.request('/api/history?module=policy')).status, 200)
  assert.equal((await (await app.request('/api/history?q=not-found')).json()).total, 0)
  await app.request(`/api/history/${result.historyId}/delete`, { body: {} })
  assert.equal((await app.request(`/api/history/${result.historyId}/chart`)).status, 404)
})
