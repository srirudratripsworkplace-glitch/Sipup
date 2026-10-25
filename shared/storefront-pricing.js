import { calculatePrice, calculateLine } from './vat.js'

export function displayedPrice(netPence, treatment, mode) {
  return mode === 'inclusive' && treatment
    ? calculatePrice(netPence, 'exclusive', treatment).grossPence : netPence
}
export function displayedLinePrice(netPence, quantity, treatment, mode) {
  return mode === 'inclusive' && treatment
    ? calculateLine(netPence, quantity, treatment).grossPence : netPence * quantity
}
export function unitPriceFor(product, quantity) {
  return product.bulk_prices?.filter((tier) => quantity >= tier.min_quantity)
    .sort((a, b) => b.min_quantity - a.min_quantity)[0]?.unit_price_pence
    ?? product.sale_price_pence ?? product.price_pence
}
export function readVatPreference(storage) {
  try { return storage.getItem('sipup-vat-display') === 'exclusive' ? 'exclusive' : 'inclusive' }
  catch { return 'inclusive' }
}
export function saveVatPreference(storage, mode) {
  try { storage.setItem('sipup-vat-display', mode) } catch { /* Storage can be disabled. */ }
}
