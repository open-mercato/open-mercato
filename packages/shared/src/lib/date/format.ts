/**
 * Normalize a date value (Date object, ISO string, or other parseable string)
 * into a YYYY-MM-DD string suitable for HTML `<input type="date">`.
 *
 * Returns `null` when the input is falsy, empty, or unparseable.
 *
 * CrudForm's `<input type="date">` emits YYYY-MM-DD strings, but API responses
 * often return ISO-8601 timestamps or Date objects. This helper bridges the gap
 * so form schemas can safely declare `z.string()` instead of `z.date()`.
 */
export function toDateInputValue(value?: string | Date | null): string | null {
  if (!value) return null

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null
    return value.toISOString().slice(0, 10)
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10)
    const parsed = new Date(trimmed)
    if (Number.isNaN(parsed.getTime())) return null
    return parsed.toISOString().slice(0, 10)
  }

  return null
}
