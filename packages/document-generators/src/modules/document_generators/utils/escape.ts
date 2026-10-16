export function escapeInline(value: unknown): string {
  return String(value ?? '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/([\\`*_[\]|~])/g, '\\$1')
    .replace(/^(\s*)([#+=-])/, '$1\\$2')
    .replace(/^(\s*\d+)([.)])/, '$1\\$2')
}

export function escapeTableCell(value: unknown): string {
  return escapeInline(value)
}
