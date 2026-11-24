const GLOBAL_KEY = '__openMercatoSchedulerDeferredSync__'

function deferredSchedules(): WeakSet<object> {
  const globals = globalThis as Record<string, unknown>
  const existing = globals[GLOBAL_KEY]
  if (existing instanceof WeakSet) return existing as WeakSet<object>
  const created = new WeakSet<object>()
  globals[GLOBAL_KEY] = created
  return created
}

/**
 * Marks a schedule written inside a caller-owned transaction. The flush subscriber
 * skips it because a flush inside an outer transaction is not proof of commit; the
 * caller syncs BullMQ itself once the transaction commits.
 */
export function markScheduleSyncDeferred(schedule: object): void {
  deferredSchedules().add(schedule)
}

export function clearScheduleSyncDeferred(schedule: object): void {
  deferredSchedules().delete(schedule)
}

export function isScheduleSyncDeferred(schedule: object): boolean {
  return deferredSchedules().has(schedule)
}
