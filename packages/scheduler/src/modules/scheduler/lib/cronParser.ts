import parser from 'cron-parser'

const { parseExpression } = parser

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
  // Explicitly reject empty strings
  if (!cronExpression || cronExpression.trim() === '') {
    return {
      isValid: false,
      error: 'Cron expression cannot be empty',
    }
  }
  
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
 * Only supports standard 5-field cron format (minute hour day month weekday)
 */
export function validateCron(cronExpression: string): boolean {
  // Explicitly reject empty strings
  if (!cronExpression || cronExpression.trim() === '') {
    return false
  }
  
  // Check for exactly 5 fields (standard cron format)
  // Split by whitespace and filter out empty strings
  const fields = cronExpression.trim().split(/\s+/).filter(f => f.length > 0)
  if (fields.length !== 5) {
    return false
  }
  
  try {
    parseExpression(cronExpression)
    return true
  } catch {
    return false
  }
}
