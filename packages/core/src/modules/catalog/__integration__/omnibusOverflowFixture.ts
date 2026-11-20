import { OMNIBUS_IN_WINDOW_LIMIT } from '../lib/omnibusHistoryQueries'

export function createOmnibusOverflowObservations(now: number) {
  return Array.from({ length: OMNIBUS_IN_WINDOW_LIMIT + 1 }, (_, index) => ({
    unitPriceNet: '56.9106',
    unitPriceGross: (69.99 - index / 1000).toFixed(4),
    recordedAt: new Date(now - 11 * 24 * 60 * 60 * 1000 + index * 1000),
    changeType: 'update' as const,
  }))
}
