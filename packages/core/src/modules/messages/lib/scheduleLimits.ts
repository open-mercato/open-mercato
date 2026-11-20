export const MESSAGES_SCHEDULE_MAX_DAYS_ENV = 'OM_MESSAGES_SCHEDULE_MAX_DAYS'
export const DEFAULT_MESSAGES_SCHEDULE_MAX_DAYS = 30

/** Read at call time so a deployment can change it without a rebuild; anything but a positive integer falls back to the default. */
export function getScheduleMaxDays(): number {
  const raw = typeof process !== 'undefined' ? process.env?.[MESSAGES_SCHEDULE_MAX_DAYS_ENV] : undefined
  const trimmed = raw?.trim() ?? ''
  if (!/^\d+$/.test(trimmed)) return DEFAULT_MESSAGES_SCHEDULE_MAX_DAYS
  const parsed = Number.parseInt(trimmed, 10)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : DEFAULT_MESSAGES_SCHEDULE_MAX_DAYS
}
