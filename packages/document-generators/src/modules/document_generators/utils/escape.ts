export function escapeInline(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/([\\`*_{}[\]()#+.!|~-])/g, '\\$1')
    .replace(/[\r\n]+/g, ' ')
}

export function escapeTableCell(value: unknown): string {
  return escapeInline(value)
}
