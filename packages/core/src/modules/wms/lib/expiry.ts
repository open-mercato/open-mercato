export const EXPIRING_SOON_DAYS = 30

export type ExpiryWindow = 'expiringSoon' | 'pastDue'

export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

export function addUtcDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setUTCDate(next.getUTCDate() + days)
  return next
}

export function buildExpiryWindowDateFilter(
  expiryWindow: ExpiryWindow,
  now: Date = new Date(),
): Record<string, unknown> {
  const today = startOfUtcDay(now)
  if (expiryWindow === 'pastDue') {
    return { expires_at: { $ne: null, $lt: today } }
  }
  return {
    expires_at: {
      $ne: null,
      $gte: today,
      $lte: addUtcDays(today, EXPIRING_SOON_DAYS),
    },
  }
}
