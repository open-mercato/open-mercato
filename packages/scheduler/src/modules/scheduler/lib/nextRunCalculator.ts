import { parseCronExpression } from './cronParser.js'
import { calculateNextRunFromInterval } from './intervalParser.js'

/**
 * Calculate the next run time for a schedule
 */
export function calculateNextRun(
  scheduleType: 'cron' | 'interval',
  scheduleValue: string,
  timezone: string = 'UTC',
  fromDate?: Date
): Date | null {
  const baseDate = fromDate || new Date()
  
  if (scheduleType === 'cron') {
    const result = parseCronExpression(scheduleValue, timezone, baseDate)
    return result.nextRun || null
  }
  
  if (scheduleType === 'interval') {
    try {
      return calculateNextRunFromInterval(scheduleValue, baseDate)
    } catch {
      return null
    }
  }
  
  return null
}

/**
 * Recalculate next run for a schedule after execution
 */
export function recalculateNextRun(
  scheduleType: 'cron' | 'interval',
  scheduleValue: string,
  timezone: string = 'UTC'
): Date | null {
  // Always calculate from current time (not from last run)
  // This prevents drift and missed executions
  return calculateNextRun(scheduleType, scheduleValue, timezone, new Date())
}
