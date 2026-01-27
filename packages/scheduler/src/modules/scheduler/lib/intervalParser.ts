/**
 * Parse simple interval strings like '15m', '2h', '1d' into milliseconds
 */
export function parseInterval(interval: string): number {
  const regex = /^(\d+)(s|m|h|d)$/
  const match = interval.match(regex)
  
  if (!match) {
    throw new Error(`Invalid interval format: ${interval}. Expected format: <number><unit> (e.g., 15m, 2h, 1d)`)
  }
  
  const value = parseInt(match[1], 10)
  const unit = match[2]
  
  const multipliers: Record<string, number> = {
    s: 1000,           // seconds
    m: 60 * 1000,      // minutes
    h: 60 * 60 * 1000, // hours
    d: 24 * 60 * 60 * 1000, // days
  }
  
  return value * multipliers[unit]
}

/**
 * Calculate next run time based on interval
 */
export function calculateNextRunFromInterval(
  interval: string,
  fromDate: Date = new Date()
): Date {
  const ms = parseInterval(interval)
  return new Date(fromDate.getTime() + ms)
}

/**
 * Validate an interval string
 */
export function validateInterval(interval: string): boolean {
  try {
    parseInterval(interval)
    return true
  } catch {
    return false
  }
}

/**
 * Convert interval to human-readable string
 * Preserves the original unit unless it can be cleanly converted to a larger unit
 * Special case: Zero always displays as "0 seconds"
 */
export function intervalToHuman(interval: string): string {
  try {
    const regex = /^(\d+)(s|m|h|d)$/
    const match = interval.match(regex)
    
    if (!match) {
      return interval
    }
    
    const value = parseInt(match[1], 10)
    const unit = match[2]
    
    const ms = parseInterval(interval)
    const seconds = ms / 1000
    
    // Special case: zero always displays as "0 seconds"
    if (seconds === 0) {
      return '0 seconds'
    }
    
    const minutes = seconds / 60
    const hours = minutes / 60
    const days = hours / 24
    
    // Only convert to larger units based on the input unit
    // This preserves the original unit choice (e.g., 60s stays as "60 seconds")
    switch (unit) {
      case 's':
        // Seconds never convert up (preserve user's choice)
        return `${seconds} second${seconds !== 1 ? 's' : ''}`
      
      case 'm':
        // Minutes can convert to hours or days
        if (days >= 1 && days === Math.floor(days)) {
          return `${days} day${days !== 1 ? 's' : ''}`
        }
        if (hours >= 1 && hours === Math.floor(hours)) {
          return `${hours} hour${hours !== 1 ? 's' : ''}`
        }
        return `${minutes} minute${minutes !== 1 ? 's' : ''}`
      
      case 'h':
        // Hours can convert to days
        if (days >= 1 && days === Math.floor(days)) {
          return `${days} day${days !== 1 ? 's' : ''}`
        }
        return `${hours} hour${hours !== 1 ? 's' : ''}`
      
      case 'd':
        // Days stay as days
        return `${days} day${days !== 1 ? 's' : ''}`
      
      default:
        return interval
    }
  } catch {
    return interval
  }
}
