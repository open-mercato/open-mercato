import { createHash } from 'node:crypto'
import type { AwilixContainer } from 'awilix'
import { crudFormSectionOutboxSweepQueue, type CrudFormSectionOutboxScope } from '@open-mercato/shared/lib/crud/form-sections/outbox'

export function stableIntegrationScheduleId(key: string): string {
  const bytes = createHash('sha256').update(key).digest().subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

export type IntegrationScheduler = {
  unregister?(id: string): Promise<void>
  exists(id: string): Promise<boolean>
  register(registration: {
    id: string
    name: string
    description?: string
    scopeType: 'organization'
    organizationId: string
    tenantId: string
    scheduleType: 'interval'
    scheduleValue: string
    timezone?: string
    targetType: 'queue'
    targetQueue: string
    targetPayload: Record<string, unknown>
    sourceType: 'module'
    sourceModule: string
    isEnabled?: boolean
  }): Promise<void>
}

export async function ensureCrudFormSectionOutboxSweep(
  container: AwilixContainer, { organizationId, tenantId }: CrudFormSectionOutboxScope,
): Promise<void> {
  if (!container.hasRegistration('schedulerService')) return

  const scheduler = container.resolve<IntegrationScheduler>('schedulerService')
  const id = stableIntegrationScheduleId(`integrations:crud-form-outbox:${tenantId}:${organizationId}`)
  if (await scheduler.exists(id)) return

  try {
    await scheduler.register({
      id,
      name: 'CrudForm extension delivery sweep',
      scopeType: 'organization',
      organizationId,
      tenantId,
      scheduleType: 'interval',
      scheduleValue: '1m',
      targetType: 'queue',
      targetQueue: crudFormSectionOutboxSweepQueue,
      targetPayload: { organizationId, tenantId },
      sourceType: 'module',
      sourceModule: 'integrations',
      isEnabled: true,
    })
  } catch (error) {
    if (!await scheduler.exists(id)) throw error
  }
}
