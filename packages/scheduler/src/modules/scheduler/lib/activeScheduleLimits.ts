import type { EntityManager } from '@mikro-orm/core'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createFallbackTranslator, type TranslateWithFallbackFn } from '@open-mercato/shared/lib/i18n/translate'
import { ScheduledJob } from '../data/entities.js'

export const DEFAULT_MAX_ACTIVE_SCHEDULES_PER_TENANT = 100
const ACTIVE_SCHEDULE_LIMIT_ENV = 'OM_SCHEDULER_MAX_ACTIVE_SCHEDULES_PER_TENANT'
const ACTIVE_SCHEDULE_LOCK_SQL = 'select pg_advisory_xact_lock(hashtextextended(?, 0))'

export function activeScheduleLockKey(tenantId: string): string {
  return `scheduler:active-schedules:${tenantId}`
}

export function getMaxActiveSchedulesPerTenant(): number {
  const parsed = Number.parseInt(process.env[ACTIVE_SCHEDULE_LIMIT_ENV] ?? '', 10)
  if (Number.isFinite(parsed) && parsed > 0) return parsed
  return DEFAULT_MAX_ACTIVE_SCHEDULES_PER_TENANT
}

async function resolveActiveScheduleLimitTranslator(): Promise<TranslateWithFallbackFn> {
  try {
    const { translate } = await resolveTranslations()
    return translate
  } catch {
    return createFallbackTranslator({})
  }
}

export async function enforceTenantActiveScheduleLimit(
  em: EntityManager,
  tenantId: string | null | undefined,
): Promise<void> {
  if (!tenantId) return

  const maxActiveSchedules = getMaxActiveSchedulesPerTenant()
  const activeScheduleCount = await em.count(ScheduledJob, {
    tenantId,
    isEnabled: true,
    deletedAt: null,
  })

  if (activeScheduleCount >= maxActiveSchedules) {
    const translate = await resolveActiveScheduleLimitTranslator()
    throw new CrudHttpError(422, {
      error: translate(
        'scheduler.error.active_schedule_limit',
        'Active scheduled job limit reached for this tenant ({max}).',
        { max: maxActiveSchedules },
      ),
    })
  }
}

/**
 * Run a schedule write and flush it. When the write makes a tenant-scoped schedule
 * active, the cap check and the write share one transaction that holds a per-tenant
 * advisory lock, so concurrent activations are decided one at a time on committed
 * rows and cannot both take the last free slot. The transaction owns the lock, so
 * PostgreSQL releases it on commit or rollback.
 */
export async function withTenantActiveScheduleSlot<T>(
  em: EntityManager,
  tenantId: string | null | undefined,
  activates: boolean,
  write: () => T | Promise<T>,
): Promise<T> {
  if (!activates || !tenantId) {
    const result = await write()
    await em.flush()
    return result
  }

  const ownsTransaction = !em.isInTransaction()
  if (ownsTransaction) await em.begin()
  try {
    await em.getConnection().execute(
      ACTIVE_SCHEDULE_LOCK_SQL,
      [activeScheduleLockKey(tenantId)],
      'all',
      em.getTransactionContext(),
    )
    await enforceTenantActiveScheduleLimit(em, tenantId)
    const result = await write()
    await em.flush()
    if (ownsTransaction) await em.commit()
    return result
  } catch (error) {
    if (ownsTransaction) await em.rollback()
    throw error
  }
}
