import type { BookingStatus } from '../data/entities'
import { HOLDING_BOOKING_STATUSES } from './usageGuards'
import { compareWallClock, localNow, normalizeWallClock } from './wallClock'

export function bookingHasEnded(endsAt: string, now: string = localNow()): boolean {
  return compareWallClock(normalizeWallClock(endsAt), now) <= 0
}

export function isCancellableByManager(booking: { status: BookingStatus; endsAt: string }, now: string = localNow()): boolean {
  return HOLDING_BOOKING_STATUSES.includes(booking.status) && !bookingHasEnded(booking.endsAt, now)
}
