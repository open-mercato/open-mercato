export type CustomerNewCustomersSettings = {
  pageSize: number
  kind: 'all' | 'person' | 'company'
}

export const DEFAULT_SETTINGS: CustomerNewCustomersSettings = {
  pageSize: 5,
  kind: 'all',
}

export function hydrateNewCustomersSettings(raw: unknown): CustomerNewCustomersSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS }
  const input = raw as Partial<CustomerNewCustomersSettings>
  const parsedPageSize = Number((input as any).pageSize)
  const pageSize =
    Number.isFinite(parsedPageSize) && parsedPageSize >= 1 && parsedPageSize <= 20
      ? Math.floor(parsedPageSize)
      : DEFAULT_SETTINGS.pageSize
  const kind =
    input.kind === 'person' || input.kind === 'company' || input.kind === 'all'
      ? input.kind
      : DEFAULT_SETTINGS.kind
  return {
    pageSize,
    kind,
  }
}
