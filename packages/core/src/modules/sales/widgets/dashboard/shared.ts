import type React from 'react'

export function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

export function toDateInputValue(value: string | null | undefined): string {
  if (!value) return ''
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return ''
  const year = String(parsed.getFullYear())
  const month = String(parsed.getMonth() + 1).padStart(2, '0')
  const day = String(parsed.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function openNativeDatePicker(event: React.SyntheticEvent<HTMLInputElement>) {
  const input = event.currentTarget
  if (typeof input.showPicker === 'function') {
    input.showPicker()
  }
}

export function formatAmount(value: string, currency: string | null, locale?: string): string {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return '--'
  try {
    if (currency && currency.trim().length > 0) {
      return new Intl.NumberFormat(locale ?? undefined, {
        style: 'currency',
        currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(numeric)
    }
    return new Intl.NumberFormat(locale ?? undefined, {
      style: 'decimal',
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(numeric)
  } catch {
    return String(numeric)
  }
}
