export function normalizeDictionaryValue(value: string): string {
  return value.trim().toLowerCase()
}

export function sanitizeDictionaryColor(color: string | null | undefined): string | null {
  if (!color) return null
  const trimmed = color.trim()
  if (!trimmed) return null
  const match = /^#([0-9a-fA-F]{6})$/.exec(trimmed)
  if (!match) return null
  return `#${match[1].toLowerCase()}`
}

export function sanitizeDictionaryIcon(icon: string | null | undefined): string | null {
  if (!icon) return null
  const trimmed = icon.trim()
  if (!trimmed) return null
  return trimmed.slice(0, 64)
}
