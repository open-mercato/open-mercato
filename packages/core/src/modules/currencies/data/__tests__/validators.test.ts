import { describe, it, expect } from '@jest/globals'
import { truncateToMinute, exchangeRateCreateSchema, exchangeRateUpdateSchema } from '../validators'

describe('truncateToMinute', () => {
  it('should zero out seconds and milliseconds', () => {
    const date = new Date('2025-01-15T10:30:45.123Z')
    const truncated = truncateToMinute(date)
    
    expect(truncated.getSeconds()).toBe(0)
    expect(truncated.getMilliseconds()).toBe(0)
    // Use UTC methods to avoid timezone issues in tests
    expect(truncated.getUTCMinutes()).toBe(30)
    expect(truncated.getUTCHours()).toBe(10)
  })

  it('should not modify a date already at minute precision', () => {
    const date = new Date('2025-01-15T10:30:00.000Z')
    const truncated = truncateToMinute(date)
    
    expect(truncated.getTime()).toBe(date.getTime())
  })

  it('should handle dates with different timezones consistently', () => {
    const date1 = new Date('2025-01-15T10:30:45.123Z')
    const date2 = new Date('2025-01-15T10:30:59.999Z')
    
    const truncated1 = truncateToMinute(date1)
    const truncated2 = truncateToMinute(date2)
    
    expect(truncated1.getTime()).toBe(truncated2.getTime())
  })
})

describe('exchangeRateCreateSchema', () => {
  it('should truncate date to minute precision', () => {
    const input = {
      organizationId: '123e4567-e89b-12d3-a456-426614174000',
      tenantId: '123e4567-e89b-12d3-a456-426614174001',
      fromCurrencyCode: 'USD',
      toCurrencyCode: 'EUR',
      rate: '1.10',
      date: '2025-01-15T10:30:45.123Z',
      source: 'ECB',
    }

    const result = exchangeRateCreateSchema.parse(input)
    
    expect(result.date.getSeconds()).toBe(0)
    expect(result.date.getMilliseconds()).toBe(0)
    expect(result.date.getMinutes()).toBe(30)
  })

  it('should make dates with different seconds map to same minute', () => {
    const baseInput = {
      organizationId: '123e4567-e89b-12d3-a456-426614174000',
      tenantId: '123e4567-e89b-12d3-a456-426614174001',
      fromCurrencyCode: 'USD',
      toCurrencyCode: 'EUR',
      rate: '1.10',
      source: 'ECB',
    }

    const result1 = exchangeRateCreateSchema.parse({
      ...baseInput,
      date: '2025-01-15T10:30:00.000Z',
    })

    const result2 = exchangeRateCreateSchema.parse({
      ...baseInput,
      date: '2025-01-15T10:30:59.999Z',
    })

    expect(result1.date.getTime()).toBe(result2.date.getTime())
  })
})

describe('exchangeRateUpdateSchema', () => {
  it('should truncate date to minute precision when provided', () => {
    const input = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      date: '2025-01-15T10:30:45.123Z',
    }

    const result = exchangeRateUpdateSchema.parse(input)
    
    expect(result.date?.getSeconds()).toBe(0)
    expect(result.date?.getMilliseconds()).toBe(0)
  })

  it('should handle undefined date', () => {
    const input = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      rate: '1.15',
    }

    const result = exchangeRateUpdateSchema.parse(input)
    
    expect(result.date).toBeUndefined()
  })
})
