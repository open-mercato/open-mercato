export type DealWriteLock = {
  settledAfter: number | null
  awaitingDrawer: boolean
}

export type DealWriteLocks = ReadonlyMap<string, DealWriteLock>

export const EMPTY_DEAL_WRITE_LOCKS: DealWriteLocks = new Map()

export function lockDealWrite(locks: DealWriteLocks, dealId: string): DealWriteLocks {
  const next = new Map(locks)
  next.set(dealId, { settledAfter: null, awaitingDrawer: false })
  return next
}

export function settleDealWrite(
  locks: DealWriteLocks,
  dealId: string,
  dataUpdatedAt: number,
  awaitingDrawer: boolean,
): DealWriteLocks {
  const next = new Map(locks)
  next.set(dealId, { settledAfter: dataUpdatedAt, awaitingDrawer })
  return next
}

export function markDealDrawerRefreshed(locks: DealWriteLocks, dealId: string): DealWriteLocks {
  const lock = locks.get(dealId)
  if (!lock || !lock.awaitingDrawer) return locks
  const next = new Map(locks)
  next.set(dealId, { ...lock, awaitingDrawer: false })
  return next
}

export function releaseFreshDealWrites(locks: DealWriteLocks, dataUpdatedAt: number): DealWriteLocks {
  let changed = false
  const next = new Map(locks)
  for (const [dealId, lock] of locks) {
    if (lock.settledAfter === null || lock.awaitingDrawer) continue
    if (dataUpdatedAt > lock.settledAfter) {
      next.delete(dealId)
      changed = true
    }
  }
  return changed ? next : locks
}

export function isDealWriteLocked(locks: DealWriteLocks, dealId: string | null | undefined): boolean {
  return !!dealId && locks.has(dealId)
}

export function clearDrawerWaitsExcept(locks: DealWriteLocks, drawerDealId: string | null): DealWriteLocks {
  let changed = false
  const next = new Map(locks)
  for (const [dealId, lock] of locks) {
    if (lock.awaitingDrawer && dealId !== drawerDealId) {
      next.set(dealId, { ...lock, awaitingDrawer: false })
      changed = true
    }
  }
  return changed ? next : locks
}
