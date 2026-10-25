import test from 'node:test'
import assert from 'node:assert/strict'
import { calculateDelivery, calculateLine, calculatePrice, calculateRefund, roundRatio } from '../shared/vat.js'
import { reportFilters, reportWhere } from '../server/vat-report.js'
import { allocateRefund } from '../server/refund-tax.js'
import { displayedPrice, displayedLinePrice, unitPriceFor, readVatPreference, saveVatPreference } from '../shared/storefront-pricing.js'

test('standard-rated exclusive and inclusive prices reconcile', () => {
  assert.deepEqual(calculatePrice(1000, 'exclusive', 'standard'), {
    netPence: 1000, vatPence: 200, grossPence: 1200, rate: 20,
  })
  assert.deepEqual(calculatePrice(1200, 'inclusive', 'standard'), {
    netPence: 1000, vatPence: 200, grossPence: 1200, rate: 20,
  })
})

test('zero-rated and exempt supplies remain distinct', () => {
  assert.deepEqual(calculatePrice(1000, 'exclusive', 'zero'), {
    netPence: 1000, vatPence: 0, grossPence: 1000, rate: 0,
  })
  assert.deepEqual(calculatePrice(1000, 'exclusive', 'exempt'), {
    netPence: 1000, vatPence: 0, grossPence: 1000, rate: null,
  })
})

test('mixed-rate lines use their own rate and line-level rounding', () => {
  const standardA = calculateLine(1000, 1, 'standard')
  const zero = calculateLine(500, 1, 'zero')
  const standardB = calculateLine(800, 1, 'standard')
  assert.equal(standardA.netPence + zero.netPence + standardB.netPence, 2300)
  assert.equal(standardA.vatPence + zero.vatPence + standardB.vatPence, 360)
  assert.equal(standardA.grossPence + zero.grossPence + standardB.grossPence, 2660)
})

test('discounted net pricing, delivery, and half-up rounding are consistent', () => {
  assert.deepEqual(calculateLine(799, 1, 'standard'), {
    netPence: 799, vatPence: 160, grossPence: 959, rate: 20,
  })
  assert.deepEqual(calculateDelivery(500, 'reduced'), {
    netPence: 500, vatPence: 25, grossPence: 525, rate: 5,
  })
  assert.equal(roundRatio(1, 2), 1)
  assert.equal(roundRatio(1, 3), 0)
})

test('invalid prices and unclassified treatments are rejected', () => {
  assert.throws(() => calculatePrice(100, 'exclusive', null), /VAT treatment/)
  assert.throws(() => calculateLine(-1, 1, 'standard'), /valid integer/)
  assert.throws(() => calculatePrice(100, 'inclusive', 'unknown'), /VAT treatment/)
})

test('partial refunds sum exactly to original net and VAT without current rates', () => {
  const snapshot = { quantity: 3, netPence: 9, vatPence: 2 }
  const parts = [0,1,2].map((already) => calculateRefund(snapshot, 1, already))
  assert.equal(parts.reduce((sum, p) => sum + p.netPence, 0), 9)
  assert.equal(parts.reduce((sum, p) => sum + p.vatPence, 0), 2)
  assert.equal(parts.reduce((sum, p) => sum + p.grossPence, 0), 11)
  assert.throws(() => calculateRefund(snapshot, 1, 3), /remaining/)
  assert.throws(() => allocateRefund([], [{ source: 'item:1', quantity: 1 }]), /original refund/)
})

test('report status filtering preserves dates and rejects reversed ranges', () => {
  const where = reportWhere({ from: '2026-10-01', to: '2026-10-15', status: 'delivered', treatment: 'exempt' }, 'o.created_at')
  assert.deepEqual(where.params, ['delivered', '2026-10-01 00:00:00', '2026-10-15', 'exempt'])
  assert.match(where.sql, /created_at >=/)
  assert.equal(reportFilters.safeParse({ from: '2026-10-15', to: '2026-10-01' }).success, false)
})

test('display preferences persist and default to inclusive when unavailable', () => {
  const values = new Map()
  const storage = { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value) }
  assert.equal(readVatPreference(storage), 'inclusive')
  saveVatPreference(storage, 'exclusive')
  assert.equal(readVatPreference(storage), 'exclusive')
  assert.equal(readVatPreference({ getItem() { throw new Error() } }), 'inclusive')
  assert.doesNotThrow(() => saveVatPreference({ setItem() { throw new Error() } }, 'inclusive'))
})

test('toggle presentation uses treatments and promotional tiers without mutating product or quantities', () => {
  const product = Object.freeze({ price_pence: 1000, sale_price_pence: 800,
    bulk_prices: Object.freeze([{ min_quantity: 10, unit_price_pence: 700 }, { min_quantity: 5, unit_price_pence: 750 }]) })
  for (const quantity of [1, 5, 10]) {
    const net = unitPriceFor(product, quantity)
    assert.equal(displayedPrice(net, 'standard', 'inclusive'), calculatePrice(net, 'exclusive', 'standard').grossPence)
    assert.equal(displayedPrice(net, 'standard', 'exclusive'), net)
    assert.equal(displayedLinePrice(net, quantity, 'standard', 'inclusive'), calculateLine(net, quantity, 'standard').grossPence)
    for (const treatment of ['zero', 'exempt']) assert.equal(displayedPrice(net, treatment, 'inclusive'), net)
  }
  assert.equal(unitPriceFor(product, 1), 800)
  assert.equal(unitPriceFor(product, 10), 700)
  assert.equal(product.price_pence, 1000)
})

test('reduced rates, low values and overflow are handled explicitly', () => {
  assert.deepEqual(calculatePrice(1050, 'inclusive', 'reduced'), { netPence: 1000, vatPence: 50, grossPence: 1050, rate: 5 })
  assert.equal(calculateLine(1, 3, 'standard').vatPence, 1)
  assert.throws(() => calculateLine(Number.MAX_SAFE_INTEGER, 2, 'standard'), RangeError)
  assert.equal(roundRatio(Number.MAX_SAFE_INTEGER, 2), 4503599627370496)
})
