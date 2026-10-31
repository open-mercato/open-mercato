export function isResponseEnricherNamespace(key: string): boolean {
  return key.startsWith('_')
    && key.length > 1
    && !key.startsWith('__')
    && key !== '_meta'
    && !key.includes('.')
}

export function extractResponseEnricherNamespaces(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => isResponseEnricherNamespace(key)))
}
