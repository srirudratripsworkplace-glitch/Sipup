import type { VatTreatment, PriceMode } from './vat.js'
export function displayedPrice(netPence: number, treatment: VatTreatment | null, mode: PriceMode): number
export function displayedLinePrice(netPence: number, quantity: number, treatment: VatTreatment | null, mode: PriceMode): number
export function unitPriceFor(product: {price_pence: number; sale_price_pence: number | null; bulk_prices?: Array<{min_quantity: number; unit_price_pence: number}>}, quantity: number): number
export function readVatPreference(storage: Pick<Storage, 'getItem'>): PriceMode
export function saveVatPreference(storage: Pick<Storage, 'setItem'>, mode: PriceMode): void
