const CODE_SEPARATOR = /^[\s–—:-]+/

export function formatCurrencyOptionLabel(code: string, label: string | null | undefined): string {
  const normalizedCode = code.trim().toUpperCase()
  const trimmedLabel = typeof label === 'string' ? label.trim() : ''
  if (!trimmedLabel.length) return normalizedCode
  if (trimmedLabel.toUpperCase() === normalizedCode) return normalizedCode
  if (trimmedLabel.slice(0, normalizedCode.length).toUpperCase() === normalizedCode) {
    const rest = trimmedLabel.slice(normalizedCode.length)
    if (CODE_SEPARATOR.test(rest)) {
      const name = rest.replace(CODE_SEPARATOR, '').trim()
      return name.length ? `${normalizedCode} – ${name}` : normalizedCode
    }
  }
  return `${normalizedCode} – ${trimmedLabel}`
}
