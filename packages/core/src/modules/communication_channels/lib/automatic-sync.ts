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
