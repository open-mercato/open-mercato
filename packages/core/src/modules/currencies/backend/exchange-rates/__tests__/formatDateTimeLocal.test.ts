import { describe, it, expect } from '@jest/globals'

/**
 * Formats a Date object to YYYY-MM-DDTHH:MM format in local timezone
 * for use with datetime-local input
 */
function formatDateTimeLocal(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${year}-${month}-${day}T${hours}:${minutes}`
}

describe('formatDateTimeLocal', () => {
  it('should format date in local timezone without shifting', () => {
    // Create a specific date in local time
    const date = new Date(2025, 0, 15, 10, 30, 45) // Jan 15, 2025, 10:30:45 AM local time
    const formatted = formatDateTimeLocal(date)
    
    expect(formatted).toBe('2025-01-15T10:30')
  })

  it('should preserve local timezone regardless of UTC offset', () => {
    // Create a date and verify it preserves local time
    const date = new Date(2025, 11, 31, 23, 59, 59) // Dec 31, 2025, 11:59:59 PM local time
    const formatted = formatDateTimeLocal(date)
    
    expect(formatted).toBe('2025-12-31T23:59')
  })

  it('should pad single-digit months, days, hours, and minutes with zeros', () => {
    const date = new Date(2025, 0, 5, 9, 5, 0) // Jan 5, 2025, 09:05:00 AM
    const formatted = formatDateTimeLocal(date)
    
    expect(formatted).toBe('2025-01-05T09:05')
  })

  it('should work correctly with dates parsed from ISO strings', () => {
    // Simulate receiving a date from the server (stored in UTC)
    const isoString = '2025-01-15T10:30:00.000Z' // UTC
    const date = new Date(isoString)
    const formatted = formatDateTimeLocal(date)
    
    // The formatted result will depend on local timezone
    // In UTC+0, this should be 10:30
    // In UTC+1, this should be 11:30
    // In UTC-5, this should be 05:30
    // So we just verify the format is correct
    expect(formatted).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
  })

  it('should truncate seconds and milliseconds', () => {
    const date = new Date(2025, 0, 15, 10, 30, 59, 999) // 10:30:59.999
    const formatted = formatDateTimeLocal(date)
    
    // Should only include up to minutes
    expect(formatted).toBe('2025-01-15T10:30')
  })

  it('should be compatible with datetime-local input value', () => {
    // datetime-local inputs accept YYYY-MM-DDTHH:MM format
    const date = new Date(2025, 0, 15, 14, 45, 0)
    const formatted = formatDateTimeLocal(date)
    
    // This format should be valid for <input type="datetime-local">
    expect(formatted).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
    
    // Round-trip test: parsing this back should give us the same local time (ignoring seconds)
    const parsed = new Date(formatted)
    expect(parsed.getFullYear()).toBe(2025)
    expect(parsed.getMonth()).toBe(0)
    expect(parsed.getDate()).toBe(15)
    expect(parsed.getHours()).toBe(14)
    expect(parsed.getMinutes()).toBe(45)
  })
})
