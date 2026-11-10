import { createHash } from 'node:crypto'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'

/**
 * `scheduled_jobs.id` is a uuid column, so a module-owned schedule's stable
 * registration key must be hashed into a uuid rather than used verbatim — this
 * keeps `schedulerService.register()` an idempotent upsert across re-runs of
 * seedDefaults instead of trying to insert a raw string into the uuid PK.
 */
export function stableScheduleUuid(stableKey: string): string {
  const hex = createHash('sha256').update(stableKey).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

export function pollTickScheduleId(organizationId: string): string {
  return stableScheduleUuid(`communication_channels:poll-tick:${organizationId}`)
}

/**
 * Single source of truth for "can the hub sync connected channels on its own?".
 *
 * Polling ticks and Gmail watch renewals only run through schedules registered
 * with `schedulerService`, which exists only when the `scheduler` module is
 * enabled. `seedDefaults` skips the registration when this returns `false`, and
 * the profile page reports the same answer so a scheduler-less app does not look
 * healthy while mail only arrives on a manual "Poll now" (#8804).
 */
export function isAutomaticSyncAvailable(container: unknown): boolean {
  const cradle = container as { hasRegistration?: (name: string) => boolean } | null | undefined
  return typeof cradle?.hasRegistration === 'function' && cradle.hasRegistration('schedulerService')
}

type ScheduleLookup = {
  isActive?: (scheduleId: string) => Promise<boolean>
  exists?: (scheduleId: string) => Promise<boolean>
}

/**
 * Whether the organization's poll tick will actually run, not merely whether the
 * scheduler module is enabled — an app that enables `scheduler` after its
 * organizations were created has no tick until `seed:defaults` re-runs, and an
 * operator can disable or delete the tick in the scheduler UI; neither may look
 * healthy (#8804). Poll ticks are per organization, so without an organization in
 * scope only module availability can be reported.
 */
export async function isAutomaticSyncEnabledForOrganization(
  container: unknown,
  organizationId: string | null,
): Promise<boolean> {
  const available = isAutomaticSyncAvailable(container)
  if (!available || !organizationId) return available
  try {
    const schedulerService = (container as { resolve: (name: string) => unknown }).resolve('schedulerService') as ScheduleLookup
    const scheduleId = pollTickScheduleId(organizationId)
    if (typeof schedulerService?.isActive === 'function') return await schedulerService.isActive(scheduleId)
    if (typeof schedulerService?.exists === 'function') return await schedulerService.exists(scheduleId)
    return true
  } catch (error) {
    getTelemetryRuntime()?.reportError(error, {
      module: 'communication_channels',
      code: 'communication_channels.automatic_sync_probe_failed',
    })
    return true
  }
}
