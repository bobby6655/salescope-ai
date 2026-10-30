import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { policyMiddleware } from '../server/policyService.js'
import { callModel } from '../server/assistant-plugin.js'
import { NATIONAL_DAY_POLICY } from '../src/policyRules.js'

async function parse(call) {
  const request = Readable.from([JSON.stringify({ text: '测试政策正文' })])
  request.method = 'POST'; request.url = '/parse-rules'
  let status = 200, body
  const response = { setHeader() {}, set statusCode(value) { status = value }, end(value) { body = JSON.parse(value) } }
  await policyMiddleware(call)(request, response)
  return { status, body }
}

test('policy parser requests enough output for multi-tier rules and preserves validated values', async () => {
  const result = await parse(async (messages, signal, options) => {
    assert.equal(options.maxTokens, 6000)
    assert.equal(signal.aborted, false)
    return '```json\n' + JSON.stringify(NATIONAL_DAY_POLICY) + '\n```'
  })
  assert.equal(result.status, 200)
  assert.deepEqual(result.body.rules.tiers, NATIONAL_DAY_POLICY.tiers)
  assert.equal(result.body.rules.capCoefficient, 3)
})

test('incomplete model JSON produces actionable error rather than a JSON engine error', async () => {
  const result = await parse(async () => '{"name":"test","tiers":[{"type":"小游戏"}')
  assert.equal(result.status, 400)
  assert.match(result.body.error, /不是完整JSON/)
  assert.doesNotMatch(result.body.error, /Unexpected/)
})

test('missing cap cannot silently inherit default policy; clarification remains explicit', async () => {
  const { capCoefficient, ...incomplete } = NATIONAL_DAY_POLICY
  const result = await parse(async () => JSON.stringify(incomplete))
  assert.equal(result.status, 400)
  assert.match(result.body.error, /封顶系数/)
  const clarification = { kind: 'clarify', message: '请补充活动日期' }
  assert.deepEqual((await parse(async () => JSON.stringify(clarification))).body, clarification)
})

test('model transport rejects token truncation even when content is empty; default budget remains 1000', async t => {
  const nativeFetch = globalThis.fetch
  const oldKey = process.env.LLM_API_KEY, oldModel = process.env.LLM_MODEL
  t.after(() => {
    globalThis.fetch = nativeFetch
    if (oldKey === undefined) delete process.env.LLM_API_KEY; else process.env.LLM_API_KEY = oldKey
    if (oldModel === undefined) delete process.env.LLM_MODEL; else process.env.LLM_MODEL = oldModel
  })
  process.env.LLM_API_KEY = 'test-key'; process.env.LLM_MODEL = 'test-model'
  const budgets = []
  globalThis.fetch = async (url, options) => {
    budgets.push(JSON.parse(options.body).max_tokens)
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: '' } }] }))
  }
  await assert.rejects(callModel([], undefined, { maxTokens: 6000 }), /长度上限/)
  await assert.rejects(callModel([]), /长度上限/)
  assert.deepEqual(budgets, [6000, 1000])
})
