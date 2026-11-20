export type FakeSchedule = {
  id: string
  integrationId: string
  entityType: string
  direction: 'import' | 'export'
  scheduleType: 'cron' | 'interval'
  scheduleValue: string
  timezone: string
  fullSync: boolean
  isEnabled: boolean
  organizationId: string
  tenantId: string
  createdAt: Date
  updatedAt: Date
}

export type FakeScheduleScope = { organizationId: string; tenantId: string }

export type FakeScheduleService = {
  schedules: Map<string, FakeSchedule>
  saves: number
  failSaves: boolean
  getByKey(integrationId: string, entityType: string, direction: 'import' | 'export'): Promise<FakeSchedule | null>
  saveSchedule(input: Omit<FakeSchedule, 'id' | 'organizationId' | 'tenantId' | 'createdAt' | 'updatedAt'>, scope: FakeScheduleScope): Promise<FakeSchedule>
  deleteSchedule(id: string): Promise<boolean>
}

function key(integrationId: string, entityType: string, direction: string): string {
  return `${integrationId}|${entityType}|${direction}`
}

/** An in-memory schedule service keyed like data_sync's (integration, entity type, direction). */
export function createFakeScheduleService(): FakeScheduleService {
  let sequence = 0
  const service: FakeScheduleService = {
    schedules: new Map(),
    saves: 0,
    failSaves: false,
    async getByKey(integrationId, entityType, direction) {
      return service.schedules.get(key(integrationId, entityType, direction)) ?? null
    },
    async saveSchedule(input, scope) {
      if (service.failSaves) throw new Error('Scheduler module is not available')
      service.saves += 1
      sequence += 1
      const now = new Date()
      const schedule = { ...input, id: `schedule-${sequence}`, organizationId: scope.organizationId, tenantId: scope.tenantId, createdAt: now, updatedAt: now }
      service.schedules.set(key(input.integrationId, input.entityType, input.direction), schedule)
      return schedule
    },
    async deleteSchedule(id) {
      for (const [entryKey, schedule] of service.schedules) {
        if (schedule.id === id) {
          service.schedules.delete(entryKey)
          return true
        }
      }
      return false
    },
  }
  return service
}
