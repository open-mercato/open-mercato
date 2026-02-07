import { describe, it, expect } from '@jest/globals'
import { parseCronExpression, getNextOccurrences, validateCron } from '../cronParser'

describe('cronParser', () => {
  describe('parseCronExpression', () => {
    it('should parse valid cron expression', () => {
      const result = parseCronExpression('0 0 * * *')
      
      expect(result.isValid).toBe(true)
      expect(result.nextRun).toBeInstanceOf(Date)
      expect(result.error).toBeUndefined()
    })

    it('should parse cron with custom timezone', () => {
      const result = parseCronExpression('0 12 * * *', 'America/New_York')
      
      expect(result.isValid).toBe(true)
      expect(result.nextRun).toBeInstanceOf(Date)
    })

    it('should use current date as base', () => {
      const baseDate = new Date('2025-01-27T00:00:00Z')
      const result = parseCronExpression('0 1 * * *', 'UTC', baseDate)
      
      expect(result.isValid).toBe(true)
      expect(result.nextRun).toBeInstanceOf(Date)
      
      // Should be at 1:00 AM on the same day or next day
      const nextRun = result.nextRun!
      expect(nextRun.getUTCHours()).toBe(1)
      expect(nextRun.getUTCMinutes()).toBe(0)
    })

    it('should handle invalid cron expression', () => {
      const result = parseCronExpression('invalid cron')
      
      expect(result.isValid).toBe(false)
      expect(result.nextRun).toBeUndefined()
      expect(result.error).toBeDefined()
      expect(typeof result.error).toBe('string')
    })

    it('should handle empty string', () => {
      const result = parseCronExpression('')
      
      expect(result.isValid).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('should parse every minute', () => {
      const result = parseCronExpression('* * * * *')
      
      expect(result.isValid).toBe(true)
      expect(result.nextRun).toBeInstanceOf(Date)
    })

    it('should parse every 5 minutes', () => {
      const result = parseCronExpression('*/5 * * * *')
      
      expect(result.isValid).toBe(true)
      expect(result.nextRun).toBeInstanceOf(Date)
    })

    it('should parse daily at midnight', () => {
      const result = parseCronExpression('0 0 * * *')
      
      expect(result.isValid).toBe(true)
      expect(result.nextRun).toBeInstanceOf(Date)
      
      const nextRun = result.nextRun!
      expect(nextRun.getUTCHours()).toBe(0)
      expect(nextRun.getUTCMinutes()).toBe(0)
    })

    it('should parse weekdays at 9 AM', () => {
      const result = parseCronExpression('0 9 * * 1-5')
      
      expect(result.isValid).toBe(true)
      expect(result.nextRun).toBeInstanceOf(Date)
    })

    it('should parse first day of month', () => {
      const result = parseCronExpression('0 0 1 * *')
      
      expect(result.isValid).toBe(true)
      expect(result.nextRun).toBeInstanceOf(Date)
      
      const nextRun = result.nextRun!
      expect(nextRun.getUTCDate()).toBe(1)
    })

    it('should handle non-Error exceptions', () => {
      // This tests the fallback error message
      const result = parseCronExpression('999 999 999 999 999')
      
      expect(result.isValid).toBe(false)
      expect(result.error).toBeDefined()
    })
  })

  describe('getNextOccurrences', () => {
    it('should return multiple occurrences', () => {
      const occurrences = getNextOccurrences('0 * * * *', 3)
      
      expect(occurrences).toHaveLength(3)
      expect(occurrences[0]).toBeInstanceOf(Date)
      expect(occurrences[1]).toBeInstanceOf(Date)
      expect(occurrences[2]).toBeInstanceOf(Date)
    })

    it('should return occurrences in chronological order', () => {
      const occurrences = getNextOccurrences('0 * * * *', 3)
      
      expect(occurrences[0].getTime()).toBeLessThan(occurrences[1].getTime())
      expect(occurrences[1].getTime()).toBeLessThan(occurrences[2].getTime())
    })

    it('should respect timezone', () => {
      const occurrences = getNextOccurrences('0 12 * * *', 2, 'America/New_York')
      
      expect(occurrences).toHaveLength(2)
      expect(occurrences[0]).toBeInstanceOf(Date)
    })

    it('should use custom base date', () => {
      const baseDate = new Date('2025-01-27T00:00:00Z')
      const occurrences = getNextOccurrences('0 1 * * *', 2, 'UTC', baseDate)
      
      expect(occurrences).toHaveLength(2)
      
      // First occurrence should be at 1:00 AM
      expect(occurrences[0].getUTCHours()).toBe(1)
      
      // Second occurrence should be 24 hours later
      const diff = occurrences[1].getTime() - occurrences[0].getTime()
      expect(diff).toBe(24 * 60 * 60 * 1000)
    })

    it('should return empty array for invalid cron', () => {
      const occurrences = getNextOccurrences('invalid cron', 3)
      
      expect(occurrences).toEqual([])
    })

    it('should handle zero count', () => {
      const occurrences = getNextOccurrences('0 * * * *', 0)
      
      expect(occurrences).toHaveLength(0)
    })

    it('should handle large count', () => {
      const occurrences = getNextOccurrences('0 * * * *', 24)
      
      expect(occurrences).toHaveLength(24)
      
      // Should span 24 hours (hourly schedule)
      const diff = occurrences[23].getTime() - occurrences[0].getTime()
      expect(diff).toBe(23 * 60 * 60 * 1000)
    })

    it('should handle every minute schedule', () => {
      const occurrences = getNextOccurrences('* * * * *', 5)
      
      expect(occurrences).toHaveLength(5)
      
      // Each occurrence should be 1 minute apart
      for (let i = 1; i < occurrences.length; i++) {
        const diff = occurrences[i].getTime() - occurrences[i - 1].getTime()
        expect(diff).toBe(60 * 1000) // 1 minute in ms
      }
    })
  })

  describe('validateCron', () => {
    it('should return true for valid cron expressions', () => {
      expect(validateCron('0 0 * * *')).toBe(true)
      expect(validateCron('* * * * *')).toBe(true)
      expect(validateCron('*/5 * * * *')).toBe(true)
      expect(validateCron('0 9-17 * * 1-5')).toBe(true)
      expect(validateCron('0 0 1 * *')).toBe(true)
    })

    it('should return false for invalid cron expressions', () => {
      expect(validateCron('invalid')).toBe(false)
      expect(validateCron('')).toBe(false)
      expect(validateCron('999 999 999 999 999')).toBe(false)
      expect(validateCron('* * * *')).toBe(false) // Missing field
      expect(validateCron('0 0 * * * *')).toBe(false) // Too many fields (seconds not supported by default)
    })

    it('should handle special characters', () => {
      expect(validateCron('0 0 * * *')).toBe(true)
      expect(validateCron('0 0 1,15 * *')).toBe(true) // 1st and 15th
      expect(validateCron('0 0 * * 0,6')).toBe(true) // Weekend
      expect(validateCron('0 */4 * * *')).toBe(true) // Every 4 hours
    })

    it('should validate range expressions', () => {
      expect(validateCron('0 9-17 * * *')).toBe(true)
      expect(validateCron('0 0 1-7 * *')).toBe(true)
      expect(validateCron('0 0 * 1-6 *')).toBe(true)
      expect(validateCron('0 0 * * 1-5')).toBe(true)
    })

    it('should validate step expressions', () => {
      expect(validateCron('*/15 * * * *')).toBe(true)
      expect(validateCron('0 */2 * * *')).toBe(true)
      expect(validateCron('0 0 */3 * *')).toBe(true)
    })
  })

  describe('edge cases', () => {
    it('should handle leap year dates', () => {
      const baseDate = new Date('2024-02-28T00:00:00Z') // 2024 is a leap year
      const result = parseCronExpression('0 0 29 2 *', 'UTC', baseDate)
      
      expect(result.isValid).toBe(true)
      expect(result.nextRun).toBeInstanceOf(Date)
      expect(result.nextRun!.getUTCDate()).toBe(29)
      expect(result.nextRun!.getUTCMonth()).toBe(1) // February (0-indexed)
    })

    it('should handle end of month correctly', () => {
      const baseDate = new Date('2025-01-31T00:00:00Z')
      const result = parseCronExpression('0 0 31 * *', 'UTC', baseDate)
      
      expect(result.isValid).toBe(true)
      expect(result.nextRun).toBeInstanceOf(Date)
    })

    it('should handle year boundaries', () => {
      const baseDate = new Date('2025-12-31T23:00:00Z')
      const result = parseCronExpression('0 0 * * *', 'UTC', baseDate)
      
      expect(result.isValid).toBe(true)
      expect(result.nextRun).toBeInstanceOf(Date)
      
      // Next run should be on January 1st
      const nextRun = result.nextRun!
      expect(nextRun.getUTCMonth()).toBe(0) // January
      expect(nextRun.getUTCDate()).toBe(1)
    })
  })
})
