export type CustomerTodoWidgetSettings = {
  pageSize: number
}

export const DEFAULT_SETTINGS: CustomerTodoWidgetSettings = {
  pageSize: 5,
}

export function hydrateCustomerTodoSettings(raw: unknown): CustomerTodoWidgetSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS }
  const input = raw as Partial<CustomerTodoWidgetSettings>
  const parsedPageSize = Number((input as any).pageSize)
  const pageSize =
    Number.isFinite(parsedPageSize) && parsedPageSize >= 1 && parsedPageSize <= 20
      ? Math.floor(parsedPageSize)
      : DEFAULT_SETTINGS.pageSize
  return {
    pageSize,
  }
}
