import type { ScheduleValueKind } from '@open-mercato/shared/lib/schedule/invalidScheduleValue'

export const SCHEDULE_VALUE_FIELD = 'scheduleValue'

export const SCHEDULE_VALUE_FORMAT_MESSAGES: Record<ScheduleValueKind, string> = {
  interval: 'Interval must be a whole number followed by s, m, h or d (for example 15m, 1h or 24h) and cover at least one minute.',
  cron: 'Cron expression could not be parsed. Use the five-field format, for example "0 * * * *".',
}

export type ScheduleValueErrorBody = {
  error: string
  details: {
    formErrors: string[]
    fieldErrors: Record<string, string[]>
  }
}

/**
 * Mirrors zod's `flatten()` shape so a scheduler-reported format failure and a
 * schema-reported one reach the client as the same structured field error
 * instead of an internal scheduler message.
 */
export function buildScheduleValueErrorBody(scheduleType: ScheduleValueKind): ScheduleValueErrorBody {
  return {
    error: 'Invalid payload',
    details: {
      formErrors: [],
      fieldErrors: { [SCHEDULE_VALUE_FIELD]: [SCHEDULE_VALUE_FORMAT_MESSAGES[scheduleType]] },
    },
  }
}

/**
 * Lets a form render its own translated hint next to the field instead of
 * flashing the API's English message as a toast.
 */
export function hasScheduleValueFieldError(payload: unknown): boolean {
  if (typeof payload !== 'object' || payload === null) return false
  const details = (payload as { details?: unknown }).details
  if (typeof details !== 'object' || details === null) return false
  const fieldErrors = (details as { fieldErrors?: unknown }).fieldErrors
  if (typeof fieldErrors !== 'object' || fieldErrors === null) return false
  const messages = (fieldErrors as Record<string, unknown>)[SCHEDULE_VALUE_FIELD]
  return Array.isArray(messages) && messages.length > 0
}
