export const VAT_RATES = Object.freeze({
  standard: 20,
  reduced: 5,
  zero: 0,
  exempt: null,
})

export function roundRatio(numerator, denominator) {
  if (!Number.isSafeInteger(numerator) || numerator < 0
      || !Number.isSafeInteger(denominator) || denominator <= 0) {
    throw new RangeError('VAT calculation requires non-negative safe integer amounts.')
  }
  return Number((BigInt(numerator) * 2n + BigInt(denominator)) / (BigInt(denominator) * 2n))
}

export function calculatePrice(amountPence, priceMode, treatment) {
  if (!Number.isSafeInteger(amountPence) || amountPence < 0) {
    throw new RangeError('Price must be a non-negative integer number of pence.')
  }
  if (!Object.hasOwn(VAT_RATES, treatment)) {
    throw new TypeError('A valid VAT treatment is required.')
  }
  if (priceMode !== 'exclusive' && priceMode !== 'inclusive') {
    throw new TypeError('Price mode must be exclusive or inclusive.')
  }

  const rate = VAT_RATES[treatment]
  if (rate === null || rate === 0) {
    return { netPence: amountPence, vatPence: 0, grossPence: amountPence, rate }
  }
  if (priceMode === 'exclusive') {
    const vatPence = roundRatio(amountPence * rate, 100)
    return { netPence: amountPence, vatPence, grossPence: amountPence + vatPence, rate }
  }

  const netPence = roundRatio(amountPence * 100, 100 + rate)
  return { netPence, vatPence: amountPence - netPence, grossPence: amountPence, rate }
}

export function calculateLine(netPence, quantity, treatment) {
  if (!Number.isSafeInteger(netPence) || netPence < 0
      || !Number.isSafeInteger(quantity) || quantity < 1) {
    throw new RangeError('Line amount and quantity must be valid integer values.')
  }
  if (!Object.hasOwn(VAT_RATES, treatment)) {
    throw new TypeError('A valid VAT treatment is required.')
  }
  const rate = VAT_RATES[treatment]
  const lineNetPence = netPence * quantity
  if (!Number.isSafeInteger(lineNetPence)) throw new RangeError('Line value exceeds the supported maximum.')
  const vatPence = rate === null || rate === 0 ? 0 : roundRatio(lineNetPence * rate, 100)
  return { netPence: lineNetPence, vatPence, grossPence: lineNetPence + vatPence, rate }
}

export function calculateDelivery(netPence, treatment) {
  if (!Number.isSafeInteger(netPence) || netPence < 0) {
    throw new RangeError('Delivery amount must be a non-negative integer number of pence.')
  }
  if (!Object.hasOwn(VAT_RATES, treatment)) {
    throw new TypeError('A valid delivery VAT treatment is required.')
  }
  const rate = VAT_RATES[treatment]
  const vatPence = rate === null || rate === 0 ? 0 : roundRatio(netPence * rate, 100)
  return { netPence, vatPence, grossPence: netPence + vatPence, rate }
}

// Allocate a quantity refund cumulatively from the original snapshot. The last
// refund absorbs rounding pennies, so several refunds equal one full reversal.
export function calculateRefund(snapshot, quantity, alreadyRefunded = 0) {
  const { netPence, vatPence, quantity: originalQuantity } = snapshot
  if (![netPence, vatPence, alreadyRefunded].every((n) => Number.isSafeInteger(n) && n >= 0)
      || !Number.isSafeInteger(quantity) || quantity < 1
      || !Number.isSafeInteger(originalQuantity) || originalQuantity < 1
      || alreadyRefunded + quantity > originalQuantity) {
    throw new RangeError('Refund quantity exceeds the remaining original order quantity.')
  }
  const portion = (amount) => roundRatio(amount * (alreadyRefunded + quantity), originalQuantity)
    - roundRatio(amount * alreadyRefunded, originalQuantity)
  const net = portion(netPence)
  const vat = portion(vatPence)
  return { netPence: net, vatPence: vat, grossPence: net + vat }
}
