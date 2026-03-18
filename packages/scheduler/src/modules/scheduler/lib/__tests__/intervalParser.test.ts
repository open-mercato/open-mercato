import { describe, it, expect } from '@jest/globals'
import {
  parseInterval,
  calculateNextRunFromInterval,
  validateInterval,
  intervalToHuman,
} from '../intervalParser'

describe('intervalParser', () => {
  describe('parseInterval', () => {
    describe('seconds', () => {
      it('should parse seconds correctly', () => {
        expect(parseInterval('30s')).toBe(30 * 1000)
        expect(parseInterval('1s')).toBe(1000)
        expect(parseInterval('60s')).toBe(60 * 1000)
      })
    })

    describe('minutes', () => {
      it('should parse minutes correctly', () => {
        expect(parseInterval('15m')).toBe(15 * 60 * 1000)
        expect(parseInterval('1m')).toBe(60 * 1000)
        expect(parseInterval('30m')).toBe(30 * 60 * 1000)
      })
    })

    describe('hours', () => {
      it('should parse hours correctly', () => {
        expect(parseInterval('2h')).toBe(2 * 60 * 60 * 1000)
        expect(parseInterval('1h')).toBe(60 * 60 * 1000)
        expect(parseInterval('24h')).toBe(24 * 60 * 60 * 1000)
      })
    })

    describe('days', () => {
      it('should parse days correctly', () => {
        expect(parseInterval('1d')).toBe(24 * 60 * 60 * 1000)
        expect(parseInterval('7d')).toBe(7 * 24 * 60 * 60 * 1000)
        expect(parseInterval('30d')).toBe(30 * 24 * 60 * 60 * 1000)
      })
    })

    describe('invalid formats', () => {
      it('should throw error for missing unit', () => {
        expect(() => parseInterval('15')).toThrow('Invalid interval format')
      })

      it('should throw error for invalid unit', () => {
        expect(() => parseInterval('15x')).toThrow('Invalid interval format')
        expect(() => parseInterval('15w')).toThrow('Invalid interval format')
        expect(() => parseInterval('15M')).toThrow('Invalid interval format')
      })

      it('should throw error for missing number', () => {
        expect(() => parseInterval('m')).toThrow('Invalid interval format')
        expect(() => parseInterval('h')).toThrow('Invalid interval format')
      })

      it('should throw error for empty string', () => {
        expect(() => parseInterval('')).toThrow('Invalid interval format')
      })

      it('should throw error for spaces', () => {
        expect(() => parseInterval('15 m')).toThrow('Invalid interval format')
        expect(() => parseInterval(' 15m')).toThrow('Invalid interval format')
        expect(() => parseInterval('15m ')).toThrow('Invalid interval format')
      })

      it('should throw error for negative numbers', () => {
        expect(() => parseInterval('-15m')).toThrow('Invalid interval format')
      })

      it('should throw error for decimal numbers', () => {
        expect(() => parseInterval('15.5m')).toThrow('Invalid interval format')
      })

      it('should throw error for multiple units', () => {
        expect(() => parseInterval('15m30s')).toThrow('Invalid interval format')
      })

      it('should include helpful error message', () => {
        expect(() => parseInterval('invalid')).toThrow(
          'Invalid interval format: invalid. Expected format: <number><unit> (e.g., 15m, 2h, 1d)'
        )
      })
    })

    describe('edge cases', () => {
      it('should handle zero', () => {
        expect(parseInterval('0s')).toBe(0)
        expect(parseInterval('0m')).toBe(0)
        expect(parseInterval('0h')).toBe(0)
        expect(parseInterval('0d')).toBe(0)
      })

      it('should handle large numbers', () => {
        expect(parseInterval('999s')).toBe(999 * 1000)
        expect(parseInterval('999m')).toBe(999 * 60 * 1000)
        expect(parseInterval('999h')).toBe(999 * 60 * 60 * 1000)
        expect(parseInterval('365d')).toBe(365 * 24 * 60 * 60 * 1000)
      })
    })
  })

  describe('calculateNextRunFromInterval', () => {
    it('should calculate next run from current time', () => {
      const before = new Date()
      const nextRun = calculateNextRunFromInterval('1h')
      
      // Next run should be approximately 1 hour in the future
      const diffMs = nextRun.getTime() - before.getTime()
      expect(diffMs).toBeGreaterThanOrEqual(60 * 60 * 1000 - 100) // Allow 100ms tolerance
      expect(diffMs).toBeLessThanOrEqual(60 * 60 * 1000 + 100)
    })

    it('should calculate next run from specific date', () => {
      const baseDate = new Date('2025-01-27T12:00:00Z')
      const nextRun = calculateNextRunFromInterval('30m', baseDate)
      
      expect(nextRun).toEqual(new Date('2025-01-27T12:30:00Z'))
    })

    it('should handle seconds intervals', () => {
      const baseDate = new Date('2025-01-27T12:00:00Z')
      const nextRun = calculateNextRunFromInterval('30s', baseDate)
      
      expect(nextRun).toEqual(new Date('2025-01-27T12:00:30Z'))
    })

    it('should handle minute intervals', () => {
      const baseDate = new Date('2025-01-27T12:00:00Z')
      const nextRun = calculateNextRunFromInterval('15m', baseDate)
      
      expect(nextRun).toEqual(new Date('2025-01-27T12:15:00Z'))
    })

    it('should handle hour intervals', () => {
      const baseDate = new Date('2025-01-27T12:00:00Z')
      const nextRun = calculateNextRunFromInterval('2h', baseDate)
      
      expect(nextRun).toEqual(new Date('2025-01-27T14:00:00Z'))
    })

    it('should handle day intervals', () => {
      const baseDate = new Date('2025-01-27T12:00:00Z')
      const nextRun = calculateNextRunFromInterval('1d', baseDate)
      
      expect(nextRun).toEqual(new Date('2025-01-28T12:00:00Z'))
    })

    it('should handle crossing day boundaries', () => {
      const baseDate = new Date('2025-01-27T23:00:00Z')
      const nextRun = calculateNextRunFromInterval('2h', baseDate)
      
      expect(nextRun).toEqual(new Date('2025-01-28T01:00:00Z'))
    })

    it('should handle crossing month boundaries', () => {
      const baseDate = new Date('2025-01-31T12:00:00Z')
      const nextRun = calculateNextRunFromInterval('1d', baseDate)
      
      expect(nextRun).toEqual(new Date('2025-02-01T12:00:00Z'))
    })

    it('should handle crossing year boundaries', () => {
      const baseDate = new Date('2025-12-31T12:00:00Z')
      const nextRun = calculateNextRunFromInterval('1d', baseDate)
      
      expect(nextRun).toEqual(new Date('2026-01-01T12:00:00Z'))
    })

    it('should throw error for invalid interval', () => {
      const baseDate = new Date()
      expect(() => calculateNextRunFromInterval('invalid', baseDate)).toThrow(
        'Invalid interval format'
      )
    })
  })

  describe('validateInterval', () => {
    it('should return true for valid intervals', () => {
      expect(validateInterval('30s')).toBe(true)
      expect(validateInterval('15m')).toBe(true)
      expect(validateInterval('2h')).toBe(true)
      expect(validateInterval('1d')).toBe(true)
      expect(validateInterval('0s')).toBe(true)
      expect(validateInterval('999d')).toBe(true)
    })

    it('should return false for invalid intervals', () => {
      expect(validateInterval('invalid')).toBe(false)
      expect(validateInterval('')).toBe(false)
      expect(validateInterval('15')).toBe(false)
      expect(validateInterval('15x')).toBe(false)
      expect(validateInterval('m')).toBe(false)
      expect(validateInterval('15 m')).toBe(false)
      expect(validateInterval('-15m')).toBe(false)
      expect(validateInterval('15.5m')).toBe(false)
    })
  })

  describe('intervalToHuman', () => {
    describe('seconds', () => {
      it('should convert seconds to human readable', () => {
        expect(intervalToHuman('1s')).toBe('1 second')
        expect(intervalToHuman('30s')).toBe('30 seconds')
        expect(intervalToHuman('59s')).toBe('59 seconds')
      })
    })

    describe('minutes', () => {
      it('should convert minutes to human readable', () => {
        expect(intervalToHuman('1m')).toBe('1 minute')
        expect(intervalToHuman('15m')).toBe('15 minutes')
        expect(intervalToHuman('30m')).toBe('30 minutes')
        expect(intervalToHuman('59m')).toBe('59 minutes')
      })
    })

    describe('hours', () => {
      it('should convert hours to human readable', () => {
        expect(intervalToHuman('1h')).toBe('1 hour')
        expect(intervalToHuman('2h')).toBe('2 hours')
        expect(intervalToHuman('12h')).toBe('12 hours')
        expect(intervalToHuman('23h')).toBe('23 hours')
      })
    })

    describe('days', () => {
      it('should convert days to human readable', () => {
        expect(intervalToHuman('1d')).toBe('1 day')
        expect(intervalToHuman('2d')).toBe('2 days')
        expect(intervalToHuman('7d')).toBe('7 days')
        expect(intervalToHuman('30d')).toBe('30 days')
      })
    })

    describe('partial units', () => {
      it('should handle non-whole minutes as seconds', () => {
        expect(intervalToHuman('90s')).toBe('90 seconds')
      })

      it('should handle non-whole hours as minutes', () => {
        expect(intervalToHuman('90m')).toBe('90 minutes')
      })

      it('should handle non-whole days as hours', () => {
        expect(intervalToHuman('36h')).toBe('36 hours')
      })
    })

    describe('singular vs plural', () => {
      it('should use singular for 1', () => {
        expect(intervalToHuman('1s')).toBe('1 second')
        expect(intervalToHuman('1m')).toBe('1 minute')
        expect(intervalToHuman('1h')).toBe('1 hour')
        expect(intervalToHuman('1d')).toBe('1 day')
      })

      it('should use plural for other numbers', () => {
        expect(intervalToHuman('0s')).toBe('0 seconds')
        expect(intervalToHuman('2s')).toBe('2 seconds')
        expect(intervalToHuman('2m')).toBe('2 minutes')
        expect(intervalToHuman('2h')).toBe('2 hours')
        expect(intervalToHuman('2d')).toBe('2 days')
      })
    })

    describe('invalid intervals', () => {
      it('should return original string for invalid intervals', () => {
        expect(intervalToHuman('invalid')).toBe('invalid')
        expect(intervalToHuman('')).toBe('')
        expect(intervalToHuman('15')).toBe('15')
        expect(intervalToHuman('15x')).toBe('15x')
      })
    })

    describe('edge cases', () => {
      it('should handle zero', () => {
        expect(intervalToHuman('0s')).toBe('0 seconds')
        expect(intervalToHuman('0m')).toBe('0 seconds')
        expect(intervalToHuman('0h')).toBe('0 seconds')
        expect(intervalToHuman('0d')).toBe('0 seconds')
      })

      it('should prefer larger units', () => {
        expect(intervalToHuman('60s')).toBe('60 seconds') // Not converted to minutes
        expect(intervalToHuman('60m')).toBe('1 hour') // Exactly 1 hour
        expect(intervalToHuman('120m')).toBe('2 hours') // Exactly 2 hours
        expect(intervalToHuman('24h')).toBe('1 day') // Exactly 1 day
        expect(intervalToHuman('48h')).toBe('2 days') // Exactly 2 days
      })

      it('should handle large numbers', () => {
        expect(intervalToHuman('365d')).toBe('365 days')
        expect(intervalToHuman('8760h')).toBe('365 days') // 365 * 24 hours = 365 days
      })
    })
  })

  describe('integration', () => {
    it('should work end-to-end for various intervals', () => {
      const intervals = ['30s', '15m', '2h', '1d']
      
      intervals.forEach(interval => {
        expect(validateInterval(interval)).toBe(true)
        
        const ms = parseInterval(interval)
        expect(ms).toBeGreaterThan(0)
        
        const nextRun = calculateNextRunFromInterval(interval)
        expect(nextRun).toBeInstanceOf(Date)
        expect(nextRun.getTime()).toBeGreaterThan(Date.now())
        
        const human = intervalToHuman(interval)
        expect(human).not.toBe(interval)
        expect(human).toContain(' ')
      })
    })
  })
})
