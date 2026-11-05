export type CustomerNewDealsSettings = {
  pageSize: number
}

export const DEFAULT_SETTINGS: CustomerNewDealsSettings = {
  pageSize: 5,
}

export function hydrateNewDealsSettings(raw: unknown): CustomerNewDealsSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS }
  const input = raw as Partial<CustomerNewDealsSettings>
  const parsedPageSize = Number((input as any).pageSize)
  const pageSize = Number.isFinite(parsedPageSize) && parsedPageSize >= 1 && parsedPageSize <= 20
    ? Math.floor(parsedPageSize)
    : DEFAULT_SETTINGS.pageSize
  return {
    pageSize,
  }
}
