"use client"

export function normalizeNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim().length) {
    const parsed = Number(value)
    if (!Number.isNaN(parsed)) return parsed
  }
  return fallback
}

export function formatMoney(value: number, currency: string | null | undefined): string {
  if (!currency) return value.toFixed(2)
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value)
}

export type LineDiscountDisplay = {
  amount: number | null
  percent: number | null
}

export function resolveLineDiscountDisplay(line: {
  discountAmount?: unknown
  discountPercent?: unknown
}): LineDiscountDisplay | null {
  const amount = normalizeNumber(line.discountAmount, 0)
  const percent = normalizeNumber(line.discountPercent, 0)
  if (amount > 0) return { amount, percent: percent > 0 ? percent : null }
  if (percent > 0) return { amount: null, percent }
  return null
}
