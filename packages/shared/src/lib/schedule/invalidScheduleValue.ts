export const INVALID_SCHEDULE_VALUE_CODE = 'INVALID_SCHEDULE_VALUE'

export type ScheduleValueKind = 'cron' | 'interval'

export type InvalidScheduleValueError = Error & {
  code: typeof INVALID_SCHEDULE_VALUE_CODE
  scheduleType: ScheduleValueKind
  scheduleValue: string
}

export function createInvalidScheduleValueError(
  scheduleType: ScheduleValueKind,
  scheduleValue: string,
  message: string,
): InvalidScheduleValueError {
  return Object.assign(new Error(message), {
    code: INVALID_SCHEDULE_VALUE_CODE,
    scheduleType,
    scheduleValue,
  } as const)
}

/**
 * Structural check rather than `instanceof`: the error crosses a package
 * boundary (and a production bundle), where a duplicated class identity would
 * make `instanceof` silently false.
 */
export function isInvalidScheduleValueError(error: unknown): error is InvalidScheduleValueError {
  if (typeof error !== 'object' || error === null) return false
  const candidate = error as { code?: unknown; scheduleType?: unknown }
  return candidate.code === INVALID_SCHEDULE_VALUE_CODE
    && (candidate.scheduleType === 'cron' || candidate.scheduleType === 'interval')
}
