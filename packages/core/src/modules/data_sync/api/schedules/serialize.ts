export function serializeSchedule(item: {
  id: string
  integrationId: string
  entityType: string
  direction: 'import' | 'export'
  scheduleType: 'cron' | 'interval'
  scheduleValue: string
  timezone: string
  fullSync: boolean
  isEnabled: boolean
  scheduledJobId?: string | null
  lastRunAt?: Date | null
  createdAt: Date
  updatedAt: Date
}) {
  return {
    id: item.id,
    integrationId: item.integrationId,
    entityType: item.entityType,
    direction: item.direction,
    scheduleType: item.scheduleType,
    scheduleValue: item.scheduleValue,
    timezone: item.timezone,
    fullSync: item.fullSync,
    isEnabled: item.isEnabled,
    scheduledJobId: item.scheduledJobId ?? null,
    lastRunAt: item.lastRunAt?.toISOString() ?? null,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  }
}
