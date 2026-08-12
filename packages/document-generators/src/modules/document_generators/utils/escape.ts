export function escapeInline(value: string): string {
  return value.replace(/([\\`*_{}\[\]()#+!|>])/g, '\\$1')
}

export function escapeTableCell(value: string): string {
  return escapeInline(value).replace(/\r?\n/g, '<br>')
}
