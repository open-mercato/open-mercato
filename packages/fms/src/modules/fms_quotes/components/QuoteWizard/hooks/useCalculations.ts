import { useCallback } from 'react'

export type QuoteLine = {
  id: string
  lineNumber: number
  productId?: string | null
  variantId?: string | null
  priceId?: string | null
  productName: string
  chargeCode?: string | null
  productType?: string | null
  providerName?: string | null
  containerSize?: string | null
  contractType?: string | null
  quantity: string
  currencyCode: string
  unitCost: string
  marginPercent: string
  unitSales: string
}

export type CalculationResult = {
  marginPercent: number
  unitSales: number
  totalCost: number
  totalSales: number
  profit: number
}

function round(value: number, decimals: number): number {
  return Math.round(value * Math.pow(10, decimals)) / Math.pow(10, decimals)
}

export function calculateFromMargin(unitCost: number, marginPercent: number): number {
  if (marginPercent >= 100) return unitCost * 10
  if (marginPercent <= 0) return unitCost
  return unitCost / (1 - marginPercent / 100)
}

export function calculateFromSales(unitCost: number, unitSales: number): number {
  if (unitSales <= 0) return 0
  if (unitSales <= unitCost) return 0
  return ((unitSales - unitCost) / unitSales) * 100
}

export function calculateLineTotals(
  quantity: number,
  unitCost: number,
  marginPercent: number
): CalculationResult {
  const unitSales = calculateFromMargin(unitCost, marginPercent)
  const totalCost = round(quantity * unitCost, 4)
  const totalSales = round(quantity * unitSales, 4)
  const profit = round(totalSales - totalCost, 4)

  return {
    marginPercent: round(marginPercent, 4),
    unitSales: round(unitSales, 4),
    totalCost,
    totalSales,
    profit,
  }
}

export function calculateQuoteTotals(lines: QuoteLine[]): {
  totalCost: number
  totalSales: number
  totalProfit: number
  lineCount: number
  averageMargin: number
} {
  const result = lines.reduce(
    (acc, line) => {
      const qty = parseFloat(line.quantity) || 0
      const cost = parseFloat(line.unitCost) || 0
      const sales = parseFloat(line.unitSales) || 0

      return {
        totalCost: acc.totalCost + qty * cost,
        totalSales: acc.totalSales + qty * sales,
        lineCount: acc.lineCount + 1,
      }
    },
    { totalCost: 0, totalSales: 0, lineCount: 0 }
  )

  const totalProfit = result.totalSales - result.totalCost
  const averageMargin =
    result.totalSales > 0 ? (totalProfit / result.totalSales) * 100 : 0

  return {
    ...result,
    totalProfit: round(totalProfit, 2),
    averageMargin: round(averageMargin, 2),
  }
}

export function useCalculations() {
  const recalculateFromMargin = useCallback(
    (line: QuoteLine, newMarginPercent: number): Partial<QuoteLine> => {
      const unitCost = parseFloat(line.unitCost) || 0
      const unitSales = calculateFromMargin(unitCost, newMarginPercent)

      return {
        marginPercent: newMarginPercent.toString(),
        unitSales: round(unitSales, 4).toString(),
      }
    },
    []
  )

  const recalculateFromSales = useCallback(
    (line: QuoteLine, newUnitSales: number): Partial<QuoteLine> => {
      const unitCost = parseFloat(line.unitCost) || 0
      const marginPercent = calculateFromSales(unitCost, newUnitSales)

      return {
        marginPercent: round(marginPercent, 4).toString(),
        unitSales: newUnitSales.toString(),
      }
    },
    []
  )

  const recalculateFromQuantity = useCallback(
    (line: QuoteLine, newQuantity: number): Partial<QuoteLine> => {
      return {
        quantity: newQuantity.toString(),
      }
    },
    []
  )

  return {
    recalculateFromMargin,
    recalculateFromSales,
    recalculateFromQuantity,
    calculateQuoteTotals,
    calculateLineTotals,
  }
}
