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

export function normalizeCurrencyCode(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length ? value.trim().toUpperCase() : null
}

export function buildServiceLookupSubtitle(
  title: string | null | undefined,
  scope: string | null | undefined,
  description: string | null | undefined,
): string | undefined {
  const normalizedTitle = typeof title === 'string' ? title.trim() : ''
  const normalizedTitleLower = normalizedTitle.toLowerCase()
  for (const candidate of [scope, description]) {
    const text = typeof candidate === 'string' ? candidate.trim() : ''
    if (!text) continue
    if (!normalizedTitleLower) return text
    const lower = text.toLowerCase()
    if (lower === normalizedTitleLower) continue
    if (lower.startsWith(normalizedTitleLower)) {
      const remainder = text.slice(normalizedTitle.length).replace(/^[\s:–—-]+/, '').trim()
      if (remainder) return remainder
      continue
    }
    return text
  }
  return undefined
}
