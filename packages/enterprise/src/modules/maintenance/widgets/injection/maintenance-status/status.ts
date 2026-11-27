export type MaintenanceStatus = {
  active: boolean
  until: string | null
  retryAfter: number | null
  message: string | null
}

export type MaintenanceWidgetMode = 'hidden' | 'bypass-banner' | 'overlay'

/**
 * A page that loads while maintenance is already active can only be a bypass session;
 * a window that starts while the page is open blocks it with the overlay.
 */
export function resolveWidgetMode(previous: MaintenanceWidgetMode | null, status: MaintenanceStatus | null): MaintenanceWidgetMode {
  if (!status || !status.active) return 'hidden'
  if (previous === null) return 'bypass-banner'
  if (previous === 'hidden') return 'overlay'
  return previous
}

export function isMaintenanceStatus(value: unknown): value is MaintenanceStatus {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return typeof record.active === 'boolean'
}
