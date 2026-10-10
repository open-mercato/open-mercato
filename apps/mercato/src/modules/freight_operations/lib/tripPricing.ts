import { amountToString, computeQuantityAmount, percentToFraction, roundToHalalas, toAmountNumber, toHalalas } from './money'

/**
 * Pure trip pricing. The trip stores every input as a snapshot (`unit_price_net`,
 * `minimum_charge_applied`, `tax_rate`) and recomputes its totals from those
 * snapshots on create/update/charges — never from the live rate line, so a later
 * contract rate change cannot rewrite history.
 */

export type TripChargePricingInput = {
  quantity?: string | number | null
  unitAmountNet: string | number
  isTaxable?: boolean
  billable?: boolean
}

export type TripPricingInput = {
  quantity: string | number
  unitPriceNet: string | number
  minimumCharge?: string | number | null
  vatRatePercent: string | number
  charges?: TripChargePricingInput[]
}

export type TripPricingTotals = {
  baseAmountNet: string
  minimumChargeApplied: string | null
  chargesTotalNet: string
  totalNetAmount: string
  taxRate: string
  taxAmount: string
  totalGrossAmount: string
}

export function computeBaseAmountNet(
  quantity: string | number,
  unitPriceNet: string | number,
  minimumCharge?: string | number | null,
): { baseAmountNet: string; minimumChargeApplied: string | null } {
  const computed = computeQuantityAmount(quantity, unitPriceNet)
  const minimum = minimumCharge === null || minimumCharge === undefined || minimumCharge === ''
    ? null
    : toAmountNumber(minimumCharge)
  if (minimum !== null && minimum > 0 && computed < minimum) {
    return { baseAmountNet: amountToString(minimum), minimumChargeApplied: amountToString(minimum) }
  }
  return { baseAmountNet: amountToString(computed), minimumChargeApplied: null }
}

export function computeChargeAmount(charge: TripChargePricingInput): number {
  const quantity = charge.quantity ?? '1'
  return computeQuantityAmount(quantity, charge.unitAmountNet)
}

export function computeTripPricing(input: TripPricingInput): TripPricingTotals {
  const { baseAmountNet, minimumChargeApplied } = computeBaseAmountNet(
    input.quantity,
    input.unitPriceNet,
    input.minimumCharge,
  )

  const billableCharges = (input.charges ?? []).filter((charge) => charge.billable !== false)
  let chargesHalalas = 0
  let taxableExtraHalalas = 0
  for (const charge of billableCharges) {
    const amountHalalas = toHalalas(computeChargeAmount(charge))
    chargesHalalas += amountHalalas
    if (charge.isTaxable !== false) taxableExtraHalalas += amountHalalas
  }

  const baseHalalas = toHalalas(Number(baseAmountNet))
  const totalNetHalalas = baseHalalas + chargesHalalas
  const taxableNetHalalas = baseHalalas + taxableExtraHalalas
  const rate = percentToFraction(input.vatRatePercent)
  const taxHalalas = toHalalas(roundToHalalas((taxableNetHalalas / 100) * rate))
  const grossHalalas = totalNetHalalas + taxHalalas

  return {
    baseAmountNet,
    minimumChargeApplied,
    chargesTotalNet: (chargesHalalas / 100).toFixed(2),
    totalNetAmount: (totalNetHalalas / 100).toFixed(2),
    taxRate: amountToString(toAmountNumber(input.vatRatePercent)),
    taxAmount: (taxHalalas / 100).toFixed(2),
    totalGrossAmount: (grossHalalas / 100).toFixed(2),
  }
}
