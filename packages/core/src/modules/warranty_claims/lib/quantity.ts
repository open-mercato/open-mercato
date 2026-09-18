export function parseQuantity(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const parsed = typeof value === 'number' ? value : value.trim().length ? Number(value) : Number.NaN
  return Number.isFinite(parsed) ? parsed : null
}

export function formatQuantity(value: string | number | null | undefined, fallback: string): string {
  const parsed = parseQuantity(value)
  return parsed === null ? fallback : parsed.toLocaleString(undefined, { maximumFractionDigits: 4 })
}

export function quantityInputValue(value: string | number | null | undefined): string {
  const parsed = parseQuantity(value)
  return parsed === null ? '' : String(parsed)
}
