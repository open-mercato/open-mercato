export function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

export function readNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

export function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

export function minorToMajor(value: string | number | null | undefined): number {
  const numeric = typeof value === 'number' ? value : Number(value ?? 0)
  return Number.isFinite(numeric) ? numeric / 100 : 0
}

export function formatMajorAmount(value: number, currency: string | null, locale?: string): string {
  try {
    if (currency && currency.trim().length > 0) {
      return new Intl.NumberFormat(locale ?? undefined, {
        style: 'currency',
        currency,
        maximumFractionDigits: 2,
      }).format(value)
    }
    return new Intl.NumberFormat(locale ?? undefined, {
      maximumFractionDigits: 2,
    }).format(value)
  } catch {
    return String(value)
  }
}

export function formatMinorAmount(value: string | number | null | undefined, currency: string | null, locale?: string): string {
  return formatMajorAmount(minorToMajor(value), currency, locale)
}
