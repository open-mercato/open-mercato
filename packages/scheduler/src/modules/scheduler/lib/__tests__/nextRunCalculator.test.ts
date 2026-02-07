import { describe, it, expect } from '@jest/globals'
import { calculateNextRun, recalculateNextRun } from '../nextRunCalculator'

describe('nextRunCalculator', () => {
  describe('calculateNextRun', () => {
    describe('cron schedules', () => {
      it('should calculate next run for cron expression', () => {
        const result = calculateNextRun('cron', '0 0 * * *')
        
        expect(result).toBeInstanceOf(Date)
        expect(result!.getUTCHours()).toBe(0)
        expect(result!.getUTCMinutes()).toBe(0)
      })

      it('should respect timezone for cron', () => {
        const result = calculateNextRun('cron', '0 12 * * *', 'America/New_York')
        
        expect(result).toBeInstanceOf(Date)
      })

      it('should use custom fromDate for cron', () => {
        const fromDate = new Date('2025-01-27T00:00:00Z')
        const result = calculateNextRun('cron', '0 1 * * *', 'UTC', fromDate)
        
        expect(result).toBeInstanceOf(Date)
        expect(result!.getUTCHours()).toBe(1)
      })

      it('should return null for invalid cron', () => {
        const result = calculateNextRun('cron', 'invalid cron')
        
        expect(result).toBeNull()
      })

      it('should handle every minute', () => {
        const result = calculateNextRun('cron', '* * * * *')
        
        expect(result).toBeInstanceOf(Date)
      })

      it('should handle every 5 minutes', () => {
        const result = calculateNextRun('cron', '*/5 * * * *')
        
        expect(result).toBeInstanceOf(Date)
      })

      it('should handle weekdays only', () => {
        const result = calculateNextRun('cron', '0 9 * * 1-5')
        
        expect(result).toBeInstanceOf(Date)
        
        // Should be a weekday (Monday = 1, Sunday = 0)
        const day = result!.getUTCDay()
        expect(day).toBeGreaterThanOrEqual(1)
        expect(day).toBeLessThanOrEqual(5)
      })

      it('should handle first day of month', () => {
        const result = calculateNextRun('cron', '0 0 1 * *')
        
        expect(result).toBeInstanceOf(Date)
        expect(result!.getUTCDate()).toBe(1)
      })
    })

    describe('interval schedules', () => {
      it('should calculate next run for interval', () => {
        const fromDate = new Date('2025-01-27T12:00:00Z')
        const result = calculateNextRun('interval', '1h', 'UTC', fromDate)
        
        expect(result).toEqual(new Date('2025-01-27T13:00:00Z'))
      })

      it('should handle seconds', () => {
        const fromDate = new Date('2025-01-27T12:00:00Z')
        const result = calculateNextRun('interval', '30s', 'UTC', fromDate)
        
        expect(result).toEqual(new Date('2025-01-27T12:00:30Z'))
      })

      it('should handle minutes', () => {
        const fromDate = new Date('2025-01-27T12:00:00Z')
        const result = calculateNextRun('interval', '15m', 'UTC', fromDate)
        
        expect(result).toEqual(new Date('2025-01-27T12:15:00Z'))
      })

      it('should handle hours', () => {
        const fromDate = new Date('2025-01-27T12:00:00Z')
        const result = calculateNextRun('interval', '2h', 'UTC', fromDate)
        
        expect(result).toEqual(new Date('2025-01-27T14:00:00Z'))
      })

      it('should handle days', () => {
        const fromDate = new Date('2025-01-27T12:00:00Z')
        const result = calculateNextRun('interval', '1d', 'UTC', fromDate)
        
        expect(result).toEqual(new Date('2025-01-28T12:00:00Z'))
      })

      it('should use current time when fromDate not provided', () => {
        const before = Date.now()
        const result = calculateNextRun('interval', '1h')
        const after = Date.now()
        
        expect(result).toBeInstanceOf(Date)
        expect(result!.getTime()).toBeGreaterThan(before)
        expect(result!.getTime()).toBeGreaterThan(after)
      })

      it('should ignore timezone for intervals', () => {
        const fromDate = new Date('2025-01-27T12:00:00Z')
        const result1 = calculateNextRun('interval', '1h', 'UTC', fromDate)
        const result2 = calculateNextRun('interval', '1h', 'America/New_York', fromDate)
        
        // Timezone doesn't affect interval calculation
        expect(result1).toEqual(result2)
      })
    })

    describe('edge cases', () => {
      it('should return null for unknown schedule type', () => {
        const result = calculateNextRun('unknown' as any, '1h')
        
        expect(result).toBeNull()
      })

      it('should handle empty schedule value for cron', () => {
        const result = calculateNextRun('cron', '')
        
        expect(result).toBeNull()
      })

      it('should handle boundary dates', () => {
        const fromDate = new Date('2025-12-31T23:00:00Z')
        const result = calculateNextRun('interval', '2h', 'UTC', fromDate)
        
        expect(result).toEqual(new Date('2026-01-01T01:00:00Z'))
      })

      it('should handle leap year', () => {
        const fromDate = new Date('2024-02-28T00:00:00Z')
        const result = calculateNextRun('interval', '1d', 'UTC', fromDate)
        
        expect(result).toEqual(new Date('2024-02-29T00:00:00Z'))
      })
    })

    describe('default parameters', () => {
      it('should use UTC as default timezone', () => {
        const result = calculateNextRun('cron', '0 0 * * *')
        
        expect(result).toBeInstanceOf(Date)
      })

      it('should use current date as default fromDate', () => {
        const before = Date.now()
        const result = calculateNextRun('cron', '* * * * *')
        const after = Date.now()
        
        expect(result).toBeInstanceOf(Date)
        expect(result!.getTime()).toBeGreaterThan(before - 60000) // Within last minute
        expect(result!.getTime()).toBeLessThan(after + 60000) // Within next minute
      })
    })
  })

  describe('recalculateNextRun', () => {
    describe('cron schedules', () => {
      it('should recalculate from current time', () => {
        const before = Date.now()
        const result = recalculateNextRun('cron', '* * * * *')
        const after = Date.now()
        
        expect(result).toBeInstanceOf(Date)
        expect(result!.getTime()).toBeGreaterThan(before)
        expect(result!.getTime()).toBeLessThan(after + 60000)
      })

      it('should use UTC timezone by default', () => {
        const result = recalculateNextRun('cron', '0 0 * * *')
        
        expect(result).toBeInstanceOf(Date)
        expect(result!.getUTCHours()).toBe(0)
      })

      it('should respect custom timezone', () => {
        const result = recalculateNextRun('cron', '0 12 * * *', 'America/New_York')
        
        expect(result).toBeInstanceOf(Date)
      })

      it('should return null for invalid cron', () => {
        const result = recalculateNextRun('cron', 'invalid')
        
        expect(result).toBeNull()
      })

      it('should always use current time, not future time', () => {
        // Even if we call it multiple times quickly, each should be based on "now"
        const result1 = recalculateNextRun('cron', '0 * * * *')
        const result2 = recalculateNextRun('cron', '0 * * * *')
        
        // Results should be very close (within a few ms)
        expect(Math.abs(result1!.getTime() - result2!.getTime())).toBeLessThan(1000)
      })
    })

    describe('interval schedules', () => {
      it('should recalculate from current time', () => {
        const before = Date.now()
        const result = recalculateNextRun('interval', '1h')
        const after = Date.now()
        
        expect(result).toBeInstanceOf(Date)
        
        // Should be approximately 1 hour from now
        const diffMs = result!.getTime() - before
        expect(diffMs).toBeGreaterThanOrEqual(60 * 60 * 1000 - 100)
        expect(diffMs).toBeLessThanOrEqual(60 * 60 * 1000 + 100)
      })

      it('should handle various intervals', () => {
        const before = Date.now()
        
        const result30s = recalculateNextRun('interval', '30s')
        expect(result30s!.getTime() - before).toBeCloseTo(30 * 1000, -2)
        
        const result15m = recalculateNextRun('interval', '15m')
        expect(result15m!.getTime() - before).toBeCloseTo(15 * 60 * 1000, -2)
        
        const result2h = recalculateNextRun('interval', '2h')
        expect(result2h!.getTime() - before).toBeCloseTo(2 * 60 * 60 * 1000, -2)
      })

      it('should ignore timezone parameter', () => {
        const result1 = recalculateNextRun('interval', '1h', 'UTC')
        const result2 = recalculateNextRun('interval', '1h', 'America/New_York')
        
        // Should be very close (within a few ms) regardless of timezone
        expect(Math.abs(result1!.getTime() - result2!.getTime())).toBeLessThan(10)
      })
    })

    describe('drift prevention', () => {
      it('should prevent drift by always calculating from "now"', () => {
        // Simulate executing a schedule multiple times
        // Each time should be calculated from current time, not from last run
        
        const results: Date[] = []
        
        // Simulate 3 executions with small delays
        for (let i = 0; i < 3; i++) {
          const result = recalculateNextRun('interval', '1h')
          expect(result).not.toBeNull()
          results.push(result!)
          
          // Each next run should be approximately the same time from "now"
          // (within the small delay between loop iterations)
          if (i > 0) {
            const diff = Math.abs(results[i].getTime() - results[i - 1].getTime())
            expect(diff).toBeLessThan(100) // Should be very close
          }
        }
      })

      it('should not accumulate drift over multiple runs', () => {
        const expectedInterval = 30 * 60 * 1000 // 30 minutes in ms
        
        const run1 = recalculateNextRun('interval', '30m')!
        const run2 = recalculateNextRun('interval', '30m')!
        const run3 = recalculateNextRun('interval', '30m')!
        
        // All should be approximately the same distance from now
        // (accounting for small timing differences in the loop)
        const now = Date.now()
        const diff1 = run1.getTime() - now
        const diff2 = run2.getTime() - now
        const diff3 = run3.getTime() - now
        
        expect(Math.abs(diff1 - expectedInterval)).toBeLessThan(10)
        expect(Math.abs(diff2 - expectedInterval)).toBeLessThan(10)
        expect(Math.abs(diff3 - expectedInterval)).toBeLessThan(10)
      })
    })

    describe('edge cases', () => {
      it('should handle unknown schedule type', () => {
        const result = recalculateNextRun('unknown' as any, '1h')
        
        expect(result).toBeNull()
      })

      it('should handle empty schedule value', () => {
        const result = recalculateNextRun('cron', '')
        
        expect(result).toBeNull()
      })

      it('should handle invalid interval format', () => {
        // Invalid interval should throw inside calculateNextRun
        // But recalculateNextRun should handle it gracefully
        const result = recalculateNextRun('interval', 'invalid')
        
        expect(result).toBeNull()
      })
    })
  })

  describe('integration tests', () => {
    it('should produce consistent results for same inputs', () => {
      const fromDate = new Date('2025-01-27T12:00:00Z')
      
      const result1 = calculateNextRun('cron', '0 0 * * *', 'UTC', fromDate)
      const result2 = calculateNextRun('cron', '0 0 * * *', 'UTC', fromDate)
      
      expect(result1).toEqual(result2)
    })

    it('should handle all schedule types correctly', () => {
      const fromDate = new Date('2025-01-27T12:00:00Z')
      
      const cronResult = calculateNextRun('cron', '0 0 * * *', 'UTC', fromDate)
      expect(cronResult).toBeInstanceOf(Date)
      
      const intervalResult = calculateNextRun('interval', '1h', 'UTC', fromDate)
      expect(intervalResult).toBeInstanceOf(Date)
      
      // Interval should be exactly 1 hour from base
      expect(intervalResult!.getTime() - fromDate.getTime()).toBe(60 * 60 * 1000)
    })

    it('should work with real-world schedules', () => {
      const schedules = [
        { type: 'cron' as const, value: '0 0 * * *' }, // Daily at midnight
        { type: 'cron' as const, value: '*/5 * * * *' }, // Every 5 minutes
        { type: 'cron' as const, value: '0 9-17 * * 1-5' }, // Weekdays 9am-5pm
        { type: 'interval' as const, value: '30s' },
        { type: 'interval' as const, value: '15m' },
        { type: 'interval' as const, value: '2h' },
        { type: 'interval' as const, value: '1d' },
      ]
      
      schedules.forEach(schedule => {
        const result = calculateNextRun(schedule.type, schedule.value)
        expect(result).toBeInstanceOf(Date)
        expect(result!.getTime()).toBeGreaterThan(Date.now())
      })
    })
  })
})
