export type PurchaseLineCalculationInput = {
  quantityOrdered: number | string
  unitPriceNet: number | string
  taxRatePercent?: number | string
}

export type PurchaseLineCalculationResult = {
  subtotalNet: string
  totalTax: string
  totalGross: string
}

export type PurchaseTotalsCalculationResult = {
  subtotalNet: string
  totalTax: string
  totalGross: string
  lineCount: number
}

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) {
    return Number(value)
  }
  return fallback
}

function roundTo4(value: number): number {
  return Math.round((value + Number.EPSILON) * 1e4) / 1e4
}

export class PurchaseCalculationService {
  calculateLine(input: PurchaseLineCalculationInput): PurchaseLineCalculationResult {
    const qty = toNumber(input.quantityOrdered, 0)
    const price = toNumber(input.unitPriceNet, 0)
    const taxRate = toNumber(input.taxRatePercent, 23)

    const subtotal = roundTo4(qty * price)
    const tax = roundTo4(subtotal * (taxRate / 100))
    const gross = roundTo4(subtotal + tax)

    return {
      subtotalNet: subtotal.toFixed(4),
      totalTax: tax.toFixed(4),
      totalGross: gross.toFixed(4),
    }
  }

  calculateTotals(lines: PurchaseLineCalculationInput[]): PurchaseTotalsCalculationResult {
    let subtotalAcc = 0
    let taxAcc = 0
    let grossAcc = 0

    for (const line of lines) {
      const lineRes = this.calculateLine(line)
      subtotalAcc += Number(lineRes.subtotalNet)
      taxAcc += Number(lineRes.totalTax)
      grossAcc += Number(lineRes.totalGross)
    }

    return {
      subtotalNet: roundTo4(subtotalAcc).toFixed(4),
      totalTax: roundTo4(taxAcc).toFixed(4),
      totalGross: roundTo4(grossAcc).toFixed(4),
      lineCount: lines.length,
    }
  }
}
