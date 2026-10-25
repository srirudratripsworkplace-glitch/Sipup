export type VatTreatment = 'standard' | 'reduced' | 'zero' | 'exempt'
export type PriceMode = 'exclusive' | 'inclusive'

export const VAT_RATES: Readonly<Record<VatTreatment, number | null>>
export function calculateRefund(snapshot: {netPence: number; vatPence: number; quantity: number}, quantity: number, alreadyRefunded?: number): {netPence: number; vatPence: number; grossPence: number}
export function roundRatio(numerator: number, denominator: number): number
export function calculatePrice(
  amountPence: number,
  priceMode: PriceMode,
  treatment: VatTreatment,
): { netPence: number; vatPence: number; grossPence: number; rate: number | null }
export function calculateLine(
  netPence: number,
  quantity: number,
  treatment: VatTreatment,
): { netPence: number; vatPence: number; grossPence: number; rate: number | null }
export function calculateDelivery(
  netPence: number,
  treatment: VatTreatment,
): { netPence: number; vatPence: number; grossPence: number; rate: number | null }
