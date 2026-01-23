import { parseExpression } from 'cron-parser'

export interface CronParseResult {
  isValid: boolean
  nextRun?: Date
  error?: string
}

/**
 * Parse and validate a cron expression
 */
export function parseCronExpression(
  cronExpression: string,
  timezone: string = 'UTC',
  currentDate?: Date
): CronParseResult {
  try {
    const interval = parseExpression(cronExpression, {
      currentDate: currentDate || new Date(),
      tz: timezone,
    })
    
    const nextRun = interval.next().toDate()
    
    return {
      isValid: true,
      nextRun,
    }
  } catch (error) {
    return {
      isValid: false,
      error: error instanceof Error ? error.message : 'Invalid cron expression',
    }
  }
}

/**
 * Get the next N occurrences of a cron expression
 */
export function getNextOccurrences(
  cronExpression: string,
  count: number,
  timezone: string = 'UTC',
  currentDate?: Date
): Date[] {
  try {
    const interval = parseExpression(cronExpression, {
      currentDate: currentDate || new Date(),
      tz: timezone,
    })
    
    const occurrences: Date[] = []
    for (let i = 0; i < count; i++) {
      occurrences.push(interval.next().toDate())
    }
    
    return occurrences
  } catch (error) {
    return []
  }
}

/**
 * Validate a cron expression
 */
export function validateCron(cronExpression: string): boolean {
  try {
    parseExpression(cronExpression)
    return true
  } catch {
    return false
  }
}
