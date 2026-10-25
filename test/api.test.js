import test from 'node:test'
import assert from 'node:assert/strict'
import { tsImport } from 'tsx/esm/api'

const { api, ApiError } = await tsImport('../src/api.ts', import.meta.url)
const json = (body, status = 200) => new Response(JSON.stringify(body), { status })

test('reads recover after a connection failure without dropping credentials or headers', async (t) => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, '/api/admin/products')
    assert.equal(options.credentials, 'include')
    assert.equal(options.headers.get('X-Test'), 'kept')
    if (++calls === 1) throw new TypeError('Failed to fetch')
    return json({ products: [{ id: 1 }] })
  })
  assert.deepEqual(await api('/admin/products', { headers: new Headers({ 'X-Test': 'kept' }) }), { products: [{ id: 1 }] })
  assert.equal(calls, 2)
})

test('reads recover from a temporary proxy failure or invalid HTML response', async (t) => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => {
    calls++
    if (calls === 1) return new Response('API restarting', { status: 503 })
    if (calls === 2) return new Response('<html>Proxy error</html>')
    return json({ customers: [] })
  })
  assert.deepEqual(await api('/admin/customers'), { customers: [] })
  assert.equal(calls, 3)
})

test('expired sessions and validation failures are not retried', async (t) => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => { calls++; return json({ error: 'Please sign in.' }, 401) })
  await assert.rejects(api('/auth/me'), error => error instanceof ApiError && error.status === 401 && error.message === 'Please sign in.')
  assert.equal(calls, 1)
})

test('writes are never automatically repeated, even on server or connection failures', async (t) => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => {
    calls++
    if (calls % 2) throw new TypeError('Failed to fetch')
    return json({ error: 'Temporary failure' }, 503)
  })
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    await assert.rejects(api('/admin/products', { method, body: '{}' }), ApiError)
  }
  assert.equal(calls, 4)
})

test('persistent connection failures stop after three attempts with a useful error', async (t) => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => { calls++; throw new TypeError('Failed to fetch') })
  await assert.rejects(api('/admin/customers'), error => error instanceof ApiError && error.status === 0 && /Cannot reach the server/.test(error.message))
  assert.equal(calls, 3)
})

test('navigation cancellation during retry delay prevents further requests', async (t) => {
  const controller = new AbortController()
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => {
    calls++
    setTimeout(() => controller.abort(), 10)
    throw new TypeError('Failed to fetch')
  })
  await assert.rejects(api('/products', { signal: controller.signal }), { name: 'AbortError' })
  assert.equal(calls, 1)
})

test('a cancelled request never starts fetching', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => json({}))
  await assert.rejects(api('/products', { signal: AbortSignal.abort() }), { name: 'AbortError' })
  assert.equal(fetch.mock.callCount(), 0)
})

test('a timeout is reported clearly and a write is not retried', async (t) => {
  t.mock.method(AbortSignal, 'timeout', () => AbortSignal.abort(new DOMException('Timed out', 'TimeoutError')))
  const fetch = t.mock.method(globalThis, 'fetch', async (_url, options) => { options.signal.throwIfAborted() })
  await assert.rejects(api('/orders', { method: 'POST', body: '{}' }), error => error instanceof ApiError && /too long/.test(error.message))
  assert.equal(fetch.mock.callCount(), 1)
})
