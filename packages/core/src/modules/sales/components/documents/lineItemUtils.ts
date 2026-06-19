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
  const normalizedCurrency = currency?.trim().toUpperCase()
  if (!normalizedCurrency) return value.toFixed(2)
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: normalizedCurrency,
    currencyDisplay: 'code',
  })
    .format(value)
    .replace(/[\u00a0\u202f]/g, ' ')
}
