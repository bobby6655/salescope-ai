import { test } from 'node:test'
import assert from 'node:assert/strict'
import { callModel } from '../server/assistant-plugin.js'

test('DeepSeek uses OpenAI endpoint, explicit non-thinking JSON output and per-call token budget', async t => {
  const keys = ['LLM_BASE_URL', 'LLM_API_PATH', 'LLM_API_KEY', 'LLM_MODEL', 'LLM_THINKING_MODE', 'LLM_JSON_OUTPUT']
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]])), nativeFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = nativeFetch; for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key] } })
  Object.assign(process.env, { LLM_BASE_URL: 'https://api.deepseek.com/v1', LLM_API_PATH: '/chat/completions', LLM_API_KEY: 'test-only-secret', LLM_MODEL: 'deepseek-flash', LLM_THINKING_MODE: 'disabled', LLM_JSON_OUTPUT: 'true' })
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://api.deepseek.com/v1/chat/completions')
    assert.equal(options.redirect, 'manual')
    const body = JSON.parse(options.body)
    assert.equal(body.model, 'deepseek-flash')
    assert.deepEqual(body.thinking, { type: 'disabled' })
    assert.deepEqual(body.response_format, { type: 'json_object' })
    assert.equal(body.max_tokens, 6000)
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{"ok":true}' } }] }))
  }
  assert.equal(await callModel([{ role: 'user', content: '输出JSON' }], undefined, { maxTokens: 6000 }), '{"ok":true}')
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: 'Invalid test-only-secret' } }), { status: 401 })
  await assert.rejects(callModel([]), error => error.message.includes('DeepSeek调用失败：HTTP 401') && error.message.includes('[REDACTED]') && !error.message.includes('test-only-secret'))
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: 'rate limited' } }), { status: 429, headers: { 'retry-after': '3' } })
  await assert.rejects(callModel([]), error => error.retryAfterMs === 3000)
  process.env.LLM_BASE_URL = 'https://other.example/v1'; process.env.LLM_JSON_OUTPUT = 'false'
  globalThis.fetch = async (url, options) => {
    assert.equal(JSON.parse(options.body).thinking, undefined)
    assert.equal(JSON.parse(options.body).response_format, undefined)
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{}' } }] }))
  }
  assert.equal(await callModel([]), '{}')
})
