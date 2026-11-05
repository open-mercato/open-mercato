export type CustomerNextInteractionsSettings = {
  pageSize: number
  includePast: boolean
}

export const DEFAULT_SETTINGS: CustomerNextInteractionsSettings = {
  pageSize: 5,
  includePast: false,
}

export function hydrateNextInteractionsSettings(raw: unknown): CustomerNextInteractionsSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS }
  const input = raw as Partial<CustomerNextInteractionsSettings>
  const parsedPageSize = Number((input as any).pageSize)
  const pageSize =
    Number.isFinite(parsedPageSize) && parsedPageSize >= 1 && parsedPageSize <= 20
      ? Math.floor(parsedPageSize)
      : DEFAULT_SETTINGS.pageSize
  return {
    pageSize,
    includePast: typeof input.includePast === 'boolean' ? input.includePast : DEFAULT_SETTINGS.includePast,
  }
}
