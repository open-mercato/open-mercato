import { createHash } from 'node:crypto'
import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('marketing_automation')

/** A run parked by a wait is normally resumed by its own delayed job; this is the safety net. */
const DUE_RUN_SCAN_INTERVAL = '1m'
/** Scheduled campaigns ask a periodic question, so hourly is plenty and far cheaper. */
const SWEEP_INTERVAL = '1h'

type SchedulerServiceLike = {
  register(input: Record<string, unknown>): Promise<unknown>
}

/**
 * `scheduled_jobs.id` is a uuid column, so a readable key has to be hashed into uuid shape
 * rather than inserted as a string. Deterministic, which makes registration an idempotent
 * upsert instead of creating a duplicate schedule on every tenant setup run.
 */
function stableScheduleUuid(stableKey: string): string {
  const hex = createHash('sha256').update(stableKey).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

/**
 * Registers the two periodic ticks this module needs.
 *
 * Best-effort in both directions: `@open-mercato/scheduler` is an OPTIONAL peer, so a missing
 * registration is a silent no-op, and a failure must never abort tenant setup. Without the
 * scan, a parked run still resumes from its own delayed queue job — the schedule only covers
 * the case where that job was lost.
 *
 * Per organization rather than one system-wide tick: discovering organizations would need an
 * unscoped read, and every query in this module carries both scope columns.
 */
async function ensureSchedules(ctx: {
  container: { resolve: (name: string) => unknown; hasRegistration?: (name: string) => boolean }
  tenantId: string
  organizationId: string
}): Promise<void> {
  const cradle = ctx.container as { hasRegistration?: (name: string) => boolean }
  if (typeof cradle.hasRegistration !== 'function' || !cradle.hasRegistration('schedulerService')) return

  const scope = { tenantId: ctx.tenantId, organizationId: ctx.organizationId }
  const schedules = [
    {
      key: `marketing_automation:due-run-scan:${ctx.organizationId}`,
      name: 'Marketing automation due-run scan',
      description: 'Resumes campaign runs whose wait elapsed but whose delayed job was lost.',
      scheduleValue: DUE_RUN_SCAN_INTERVAL,
      targetQueue: 'marketing-automation-resume',
    },
    {
      key: `marketing_automation:sweep:${ctx.organizationId}`,
      name: 'Marketing automation scheduled campaigns',
      description: 'Runs campaigns that start on a schedule: re-engagement and offer-expiry reminders.',
      scheduleValue: SWEEP_INTERVAL,
      targetQueue: 'marketing-automation-sweep',
    },
  ]

  try {
    const schedulerService = ctx.container.resolve('schedulerService') as SchedulerServiceLike
    for (const schedule of schedules) {
      await schedulerService.register({
        id: stableScheduleUuid(schedule.key),
        name: schedule.name,
        description: schedule.description,
        scopeType: 'organization',
        organizationId: ctx.organizationId,
        tenantId: ctx.tenantId,
        scheduleType: 'interval',
        scheduleValue: schedule.scheduleValue,
        timezone: 'UTC',
        targetType: 'queue',
        targetQueue: schedule.targetQueue,
        targetPayload: { scope },
        sourceType: 'module',
        sourceModule: 'marketing_automation',
        isEnabled: true,
      })
    }
  } catch (error) {
    logger.warn('[internal] marketing_automation: failed to register schedules', { err: error })
  }
}

export const setup: ModuleSetupConfig = {
  seedDefaults: async (ctx) => {
    await ensureSchedules(ctx)
  },
  defaultRoleFeatures: {
    admin: ['marketing_automation.*'],
    // Read-only by default: authoring a campaign that emails customers is not a power every
    // employee should have simply by being an employee.
    employee: ['marketing_automation.campaigns.view', 'marketing_automation.runs.view'],
  },
}

export default setup
