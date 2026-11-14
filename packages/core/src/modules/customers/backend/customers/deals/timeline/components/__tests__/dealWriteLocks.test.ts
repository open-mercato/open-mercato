import {
  EMPTY_DEAL_WRITE_LOCKS,
  clearDrawerWaitsExcept,
  isDealWriteLocked,
  lockDealWrite,
  markDealDrawerRefreshed,
  releaseFreshDealWrites,
  settleDealWrite,
} from '../dealWriteLocks'

const DEAL = 'deal-1'

describe('deal write locks', () => {
  it('stays locked while the write is in flight, whatever data arrives', () => {
    const locks = lockDealWrite(EMPTY_DEAL_WRITE_LOCKS, DEAL)
    expect(isDealWriteLocked(locks, DEAL)).toBe(true)
    expect(isDealWriteLocked(releaseFreshDealWrites(locks, 9_999), DEAL)).toBe(true)
  })

  it('releases only on timeline data newer than the settle point', () => {
    const settled = settleDealWrite(lockDealWrite(EMPTY_DEAL_WRITE_LOCKS, DEAL), DEAL, 100, false)
    expect(isDealWriteLocked(releaseFreshDealWrites(settled, 100), DEAL)).toBe(true)
    expect(isDealWriteLocked(releaseFreshDealWrites(settled, 101), DEAL)).toBe(false)
  })

  it('keeps the deal locked after a failed refetch (no newer data)', () => {
    const settled = settleDealWrite(lockDealWrite(EMPTY_DEAL_WRITE_LOCKS, DEAL), DEAL, 100, false)
    const afterFailedRefetch = releaseFreshDealWrites(settled, 100)
    expect(isDealWriteLocked(afterFailedRefetch, DEAL)).toBe(true)
    expect(isDealWriteLocked(releaseFreshDealWrites(afterFailedRefetch, 250), DEAL)).toBe(false)
  })

  it('waits for the drawer showing the deal to re-read before releasing', () => {
    const settled = settleDealWrite(lockDealWrite(EMPTY_DEAL_WRITE_LOCKS, DEAL), DEAL, 100, true)
    const freshTimeline = releaseFreshDealWrites(settled, 200)
    expect(isDealWriteLocked(freshTimeline, DEAL)).toBe(true)
    const refreshed = releaseFreshDealWrites(markDealDrawerRefreshed(freshTimeline, DEAL), 200)
    expect(isDealWriteLocked(refreshed, DEAL)).toBe(false)
  })

  it('drops the drawer wait once the drawer no longer shows the deal', () => {
    const settled = settleDealWrite(lockDealWrite(EMPTY_DEAL_WRITE_LOCKS, DEAL), DEAL, 100, true)
    expect(clearDrawerWaitsExcept(settled, DEAL)).toBe(settled)
    const closed = clearDrawerWaitsExcept(settled, null)
    expect(isDealWriteLocked(releaseFreshDealWrites(closed, 200), DEAL)).toBe(false)
  })

  it('returns the same map when nothing changes', () => {
    const settled = settleDealWrite(lockDealWrite(EMPTY_DEAL_WRITE_LOCKS, DEAL), DEAL, 100, false)
    expect(releaseFreshDealWrites(settled, 50)).toBe(settled)
    expect(markDealDrawerRefreshed(settled, DEAL)).toBe(settled)
  })
})
