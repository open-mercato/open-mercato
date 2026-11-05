/**
 * @jest-environment node
 */
import type React from 'react'
import { readString, toDateInputValue, formatAmount, openNativeDatePicker } from '../shared'

describe('sales dashboard shared helpers', () => {
  describe('readString', () => {
    it('returns string value as-is', () => {
      expect(readString('hello')).toBe('hello')
    })

    it('returns null for a number', () => {
      expect(readString(42)).toBeNull()
    })

    it('returns null for null', () => {
      expect(readString(null)).toBeNull()
    })

    it('returns null for undefined', () => {
      expect(readString(undefined)).toBeNull()
    })

    it('returns null for an object', () => {
      expect(readString({ key: 'value' })).toBeNull()
    })
  })

  describe('toDateInputValue', () => {
    it('returns empty string for null', () => {
      expect(toDateInputValue(null)).toBe('')
    })

    it('returns empty string for undefined', () => {
      expect(toDateInputValue(undefined)).toBe('')
    })

    it('returns empty string for empty string', () => {
      expect(toDateInputValue('')).toBe('')
    })

    it('returns YYYY-MM-DD for a valid date string', () => {
      const result = toDateInputValue('2025-03-15T10:00:00Z')
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    })

    it('returns empty string for an invalid date string', () => {
      expect(toDateInputValue('not-a-date')).toBe('')
    })
  })

  describe('formatAmount', () => {
    it('returns -- for non-numeric value', () => {
      expect(formatAmount('abc', null)).toBe('--')
    })

    it('returns -- for NaN string', () => {
      expect(formatAmount('NaN', null)).toBe('--')
    })

    it('returns currency-formatted string when currency is provided', () => {
      const result = formatAmount('1234.50', 'USD', 'en-US')
      expect(result).toMatch(/1.*234.*50/)
    })

    it('returns decimal-formatted string when currency is null', () => {
      const result = formatAmount('1234', null, 'en-US')
      expect(result).toMatch(/1.*234/)
    })

    it('returns decimal-formatted string when currency is empty', () => {
      const result = formatAmount('500.5', '', 'en-US')
      expect(result).toMatch(/500/)
    })

    it('returns plain number string on Intl error', () => {
      const result = formatAmount('100', 'INVALID_CURRENCY_CODE_THAT_DOES_NOT_EXIST', 'en-US')
      expect(result).toBe('100')
    })
  })

  describe('openNativeDatePicker', () => {
    it('calls showPicker when available', () => {
      const showPicker = jest.fn()
      const event = { currentTarget: { showPicker } } as unknown as React.SyntheticEvent<HTMLInputElement>
      openNativeDatePicker(event)
      expect(showPicker).toHaveBeenCalledTimes(1)
    })

    it('does nothing when showPicker is not available', () => {
      const event = { currentTarget: {} } as unknown as React.SyntheticEvent<HTMLInputElement>
      expect(() => openNativeDatePicker(event)).not.toThrow()
    })
  })
})
