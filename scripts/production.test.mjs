import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomBytes, scryptSync } from 'node:crypto'
import { createProductionServer } from '../server/production.js'
import { savePolicyInput, readPolicyInput } from '../server/policyIO.js'
import { saveChart } from '../server/chartService.js'
import { withUserStorage } from '../server/storageContext.js'

const password = 'test-only-password-12345'
const hash = () => { const salt = randomBytes(16).toString('hex'); return `scrypt:${salt}:${scryptSync(password, salt, 32).toString('hex')}` }
const auth = (name) => `Basic ${Buffer.from(`${name}:${password}`).toString('base64')}`
async function setup(t, options = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'salescope-prod-'))
  await writeFile(path.join(directory, 'index.html'), '<h1>SaleScope production</h1>')
  const server = createProductionServer({ users: { alice: hash(), bob: hash() }, dataRoot: path.join(directory, 'users'), distRoot: directory, ...options })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }) })
  const origin = `http://127.0.0.1:${server.address().port}`
  return { directory, origin, request: (route, user = 'alice', options = {}) => fetch(`${origin}${route}`, { ...options, headers: { authorization: auth(user), ...options.headers } }) }
}

test('production requires accounts and protects static files, APIs and charts', async t => {
  assert.throws(() => createProductionServer({ users: {} }), /AUTH_USERS/)
  const app = await setup(t)
  assert.equal((await fetch(app.origin + '/api/health')).status, 200)
  assert.equal((await fetch(app.origin + '/')).status, 401)
  assert.equal((await fetch(app.origin + '/api/policy/current')).status, 401)
  assert.equal((await app.request('/', 'constructor')).status, 401)
  assert.equal((await app.request('/')).status, 200)
  assert.equal((await app.request('/.env')).status, 403)
  assert.notEqual((await app.request('/charts/%2e%2e/policy-data/latest.json')).status, 200)
})

test('browser cross-origin writes, non-JSON forms and oversize uploads are rejected', async t => {
  const app = await setup(t)
  assert.equal((await app.request('/api/policy/import', 'alice', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' })).status, 415)
  assert.equal((await app.request('/api/policy/import', 'alice', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://other.example' }, body: '{}' })).status, 403)
  assert.equal((await app.request('/api/policy/import', 'alice', { method: 'POST', headers: { 'content-type': 'application/json' }, body: ' '.repeat(12 * 1024 * 1024 + 1) })).status, 413)
})

test('independent users retain isolated policy inputs and chart downloads', async t => {
  const app = await setup(t)
  const input = (name) => ({ baseRows: [{ 客户: name, 属性: '小游戏', 行业分组: '部门', 负责销售: name, 'base(万/日)': 1 }], consumptionRows: [] })
  const chart = await withUserStorage('alice', path.join(app.directory, 'users'), async () => {
    await savePolicyInput(input('alice-only'))
    return saveChart({ type: 'bar', title: 'Alice only', rows: [{ label: 'A', value: 10 }], metric: '消耗', strict: true })
  })
  await withUserStorage('bob', path.join(app.directory, 'users'), () => savePolicyInput(input('bob-only')))
  const alice = await (await app.request('/api/policy/current')).json()
  const bob = await (await app.request('/api/policy/current', 'bob')).json()
  assert.equal(alice.customers[0].customer, 'alice-only')
  assert.equal(bob.customers[0].customer, 'bob-only')
  assert.equal((await app.request(chart.publicPath)).status, 200)
  assert.equal((await app.request(chart.publicPath, 'bob')).status, 404)
  assert.equal(await withUserStorage('alice', path.join(app.directory, 'users'), async () => (await readPolicyInput()).baseRows[0].客户), 'alice-only')
})

test('same-user work is serialized while other users can progress', async t => {
  let release
  const pending = new Promise(resolve => { release = resolve })
  let started
  const ready = new Promise(resolve => { started = resolve })
  const app = await setup(t, { routes: [{ prefix: '/api/slow', handler: async (request, response) => { started(); await pending; response.end('{}') } }] })
  const options = { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }
  const first = app.request('/api/slow', 'alice', options)
  await ready
  assert.equal((await app.request('/api/slow', 'alice', options)).status, 429)
  const other = app.request('/api/slow', 'bob', options)
  release()
  assert.equal((await first).status, 200)
  assert.equal((await other).status, 200)
})

test('policy uploads stay isolated through real HTTP middleware and read-only XLSX parser', async t => {
  const app = await setup(t)
  const upload = name => ({ base: { name: 'base.csv', data: Buffer.from(`客户,属性,行业分组,负责销售,base(万/日)\n${name},小游戏,部门,销售,1`).toString('base64') }, consumption: { name: 'cost.csv', data: Buffer.from(`日期,客户,cost_6消耗(万),cost_4现金(万)\n2026-09-25,${name},2,1.5`).toString('base64') } })
  for (const user of ['alice', 'bob']) {
    const response = await app.request('/api/policy/import', user, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(upload(user)) })
    assert.equal(response.status, 200, await response.text())
  }
  const alice = await (await app.request('/api/policy/export?format=csv')).text()
  const bob = await (await app.request('/api/policy/export?format=csv', 'bob')).text()
  assert.ok(alice.includes('alice') && !alice.includes('bob'))
  assert.ok(bob.includes('bob') && !bob.includes('alice'))
})
