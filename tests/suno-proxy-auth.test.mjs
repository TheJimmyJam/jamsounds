// The Suno read proxies spend the owner's key: signed-out callers get 401
// and Suno is never called.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
process.env.JAMSOUNDS_SESSION_SECRET = 'x'.repeat(40)
process.env.JAMSOUNDS_OWNER_KEY = 'owner-key-for-tests'

for (const name of ['get-credits', 'check-status', 'check-task']) {
  test(`${name} refuses a signed-out caller without calling Suno`, async () => {
    let called = false
    const orig = globalThis.fetch
    globalThis.fetch = async () => { called = true; throw new Error('no network') }
    try {
      const { handler } = require(`../netlify/functions/${name}.js`)
      const res = await handler({ httpMethod: 'GET', headers: {}, queryStringParameters: { taskId: 't1', kind: 'wav' } })
      assert.equal(res.statusCode, 401)
      assert.equal(called, false)
    } finally { globalThis.fetch = orig }
  })

  test(`${name} lets the owner key through`, async () => {
    const orig = globalThis.fetch
    globalThis.fetch = async () => ({ json: async () => ({ code: 500, msg: 'stub' }) })
    try {
      const { handler } = require(`../netlify/functions/${name}.js`)
      const res = await handler({ httpMethod: 'GET', headers: { 'x-jamsounds-owner-key': 'owner-key-for-tests' }, queryStringParameters: { taskId: 't1', kind: 'wav' } })
      assert.notEqual(res.statusCode, 401)
      assert.equal(JSON.parse(res.body).raw, undefined)
    } finally { globalThis.fetch = orig }
  })
}
