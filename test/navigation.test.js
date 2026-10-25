import test from 'node:test'
import assert from 'node:assert/strict'
import { safeStorefrontRedirect, readPendingBagItem } from '../shared/navigation.js'

test('sign-in returns only to valid internal shopping pages', () => {
  for (const path of ['/', '/shop?search=Fanta', '/cart', '/checkout', '/product/fanta-orange-355ml', '/category/global-drinks']) assert.equal(safeStorefrontRedirect(path), path)
  for (const path of [null, '//evil.example/shop', 'https://evil.example', '/\\evil.example', '/admin', '/account/login', '/product/%2f%2fevil.example', '/shop\n']) assert.equal(safeStorefrontRedirect(path), '/account')
})

test('pending additions retain quantity but expire and reject malformed storage', () => {
  const now = Date.now()
  const value = { slug: 'fanta-orange', quantity: 3, redirect: '/shop?search=fanta', createdAt: now }
  assert.deepEqual(readPendingBagItem(JSON.stringify(value), now), value)
  for (const change of [{ quantity: -1 }, { quantity: 1.5 }, { slug: undefined }, { slug: '../admin' }, { redirect: '//evil.example' }, { createdAt: now - 16 * 60_000 }, { createdAt: now + 1 }]) assert.equal(readPendingBagItem(JSON.stringify({ ...value, ...change }), now), null)
  assert.equal(readPendingBagItem('invalid', now), null)
})
