import { createHash } from 'node:crypto'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { INBOX_OPS_ATTACHMENT_MAINTENANCE_QUEUE } from './inboundAttachmentMaintenance'
import { reportInboundAttachmentError } from './inboundAttachments'

const logger = createLogger('inbox_ops').child({ component: 'attachment-schedule' })

export const INBOX_OPS_ATTACHMENT_MAINTENANCE_CRON = '*/15 * * * *'

/** A deterministic id with RFC 4122 version (5) and variant bits, so `z.uuid()` validators accept it. */
export function stableInboxOpsScheduleUuid(stableKey: string): string {
  const bytes = createHash('sha256').update(stableKey).digest().subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Buffer.from(bytes).toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

export const INBOX_OPS_ATTACHMENT_MAINTENANCE_SCHEDULE_ID = stableInboxOpsScheduleUuid('inbox_ops:attachment-maintenance')

type SchedulerServiceLike = {
  exists: (scheduleId: string) => Promise<boolean>
  register: (registration: {
    id: string
    name: string
    description?: string
    scopeType: 'system'
    scheduleType: 'cron'
    scheduleValue: string
    timezone?: string
    targetType: 'queue'
    targetQueue: string
    targetPayload?: Record<string, unknown>
    sourceType: 'module'
    sourceModule: string
    isEnabled?: boolean
  }) => Promise<void>
}

export type SchedulerContainerLike = {
  resolve: (name: string) => unknown
  hasRegistration?: (name: string) => boolean
}

function resolveSchedulerService(container: SchedulerContainerLike): SchedulerServiceLike | null {
  if (typeof container.hasRegistration === 'function' && !container.hasRegistration('schedulerService')) return null
  try {
    const service = container.resolve('schedulerService') as Partial<SchedulerServiceLike> | null | undefined
    if (!service || typeof service.exists !== 'function' || typeof service.register !== 'function') return null
    return service as SchedulerServiceLike
  } catch {
    return null
  }
}

export type InboundAttachmentScheduleOutcome = 'registered' | 'exists' | 'scheduler_unavailable'

/**
 * Registers the system schedule of the maintenance sweep through the optional scheduler module,
 * only when it is missing: `register()` resets `nextRunAt`, and an operator may have disabled it.
 */
export async function ensureInboundAttachmentMaintenanceSchedule(
  container: SchedulerContainerLike,
): Promise<InboundAttachmentScheduleOutcome> {
  const scheduler = resolveSchedulerService(container)
  if (!scheduler) return 'scheduler_unavailable'
  if (await scheduler.exists(INBOX_OPS_ATTACHMENT_MAINTENANCE_SCHEDULE_ID)) return 'exists'
  await scheduler.register({
    id: INBOX_OPS_ATTACHMENT_MAINTENANCE_SCHEDULE_ID,
    name: 'Inbox attachments maintenance',
    description: 'Re-enqueues stranded inbound attachment ingests and retries attachment releases of deleted inbox emails every 15 minutes.',
    scopeType: 'system',
    scheduleType: 'cron',
    scheduleValue: INBOX_OPS_ATTACHMENT_MAINTENANCE_CRON,
    timezone: 'UTC',
    targetType: 'queue',
    targetQueue: INBOX_OPS_ATTACHMENT_MAINTENANCE_QUEUE,
    targetPayload: {},
    sourceType: 'module',
    sourceModule: 'inbox_ops',
    isEnabled: true,
  })
  return 'registered'
}

/** `seedDefaults` entry point: never fails tenant setup. */
export async function ensureInboundAttachmentMaintenanceScheduleSafely(
  container: SchedulerContainerLike,
): Promise<InboundAttachmentScheduleOutcome | 'failed'> {
  try {
    return await ensureInboundAttachmentMaintenanceSchedule(container)
  } catch (error) {
    logger.warn('Failed to register the inbox attachments maintenance schedule', { err: error })
    reportInboundAttachmentError(error, 'inbox_ops.attachment_schedule_failed')
    return 'failed'
  }
}

let lazyRegistration: Promise<InboundAttachmentScheduleOutcome | 'failed'> | null = null

/**
 * Called by the webhook the first time a process sets an email to `pending`. The outcome is cached
 * per process; a failed attempt is forgotten so a later email retries it.
 */
export function ensureInboundAttachmentMaintenanceScheduleLazily(
  container: SchedulerContainerLike,
): Promise<InboundAttachmentScheduleOutcome | 'failed'> {
  if (!lazyRegistration) {
    lazyRegistration = ensureInboundAttachmentMaintenanceScheduleSafely(container).then((outcome) => {
      if (outcome === 'failed') lazyRegistration = null
      return outcome
    })
  }
  return lazyRegistration
}

/** Test helper: forgets the per-process registration. */
export function resetInboundAttachmentScheduleRegistrationForTests(): void {
  lazyRegistration = null
}
