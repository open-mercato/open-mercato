import { describe, it, expect } from '@jest/globals'
import {
  EXCHANGE_RATE_METADATA_MAX_BYTES,
  exchangeRateCreateSchema,
  exchangeRateUpdateSchema,
  isExchangeRateMetadataWithinLimit,
  truncateToMinute,
} from '../validators'

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

describe('exchange rate precision and metadata', () => {
  const baseInput = {
    organizationId: '123e4567-e89b-12d3-a456-426614174000',
    tenantId: '123e4567-e89b-12d3-a456-426614174001',
    fromCurrencyCode: 'IDR',
    toCurrencyCode: 'USD',
    date: '2025-01-15T10:30:00.000Z',
    source: 'Manual',
  }

  it('accepts rates with more than 8 decimals and more than 10 integer digits', () => {
    expect(exchangeRateCreateSchema.parse({ ...baseInput, rate: '0.000056123456789012345678901234' }).rate).toBe(
      '0.000056123456789012345678901234',
    )
    expect(exchangeRateCreateSchema.parse({ ...baseInput, rate: '123456789012345678.5' }).rate).toBe('123456789012345678.5')
  })

  it('rejects zero, negative and malformed rates', () => {
    expect(exchangeRateCreateSchema.safeParse({ ...baseInput, rate: '0.000000000000000000000' }).success).toBe(false)
    expect(exchangeRateCreateSchema.safeParse({ ...baseInput, rate: '-1' }).success).toBe(false)
    expect(exchangeRateCreateSchema.safeParse({ ...baseInput, rate: '1,5' }).success).toBe(false)
    expect(exchangeRateUpdateSchema.safeParse({ id: baseInput.organizationId, rate: '0' }).success).toBe(false)
  })

  it('accepts object or null metadata and rejects other shapes', () => {
    const metadata = { tableNo: '195/C/NBP/2026', nested: { note: 'x' } }
    expect(exchangeRateCreateSchema.parse({ ...baseInput, rate: '1', metadata }).metadata).toEqual(metadata)
    expect(exchangeRateCreateSchema.parse({ ...baseInput, rate: '1', metadata: null }).metadata).toBeNull()
    expect(exchangeRateCreateSchema.safeParse({ ...baseInput, rate: '1', metadata: ['x'] }).success).toBe(false)
    expect(exchangeRateUpdateSchema.safeParse({ id: baseInput.organizationId, metadata: 'x' }).success).toBe(false)
  })
})

describe('exchange rate metadata size cap', () => {
  const input = {
    organizationId: '00000000-0000-4000-8000-000000000001',
    tenantId: '00000000-0000-4000-8000-000000000002',
    fromCurrencyCode: 'USD',
    toCurrencyCode: 'EUR',
    rate: '1.1',
    date: '2026-10-08T10:00:00Z',
    source: 'manual',
  }

  function metadataOfBytes(byteCount: number): Record<string, string> {
    const overhead = JSON.stringify({ note: '' }).length
    return { note: 'x'.repeat(byteCount - overhead) }
  }

  it('accepts metadata up to 16 KB of serialized JSON', () => {
    const metadata = metadataOfBytes(EXCHANGE_RATE_METADATA_MAX_BYTES)
    expect(isExchangeRateMetadataWithinLimit(metadata)).toBe(true)
    expect(exchangeRateCreateSchema.safeParse({ ...input, metadata }).success).toBe(true)
  })

  it('rejects metadata above 16 KB with a translatable message key', () => {
    const metadata = metadataOfBytes(EXCHANGE_RATE_METADATA_MAX_BYTES + 1)
    const created = exchangeRateCreateSchema.safeParse({ ...input, metadata })
    const updated = exchangeRateUpdateSchema.safeParse({ id: input.organizationId, metadata })
    expect(created.success).toBe(false)
    expect(updated.success).toBe(false)
    expect(created.error?.issues[0]).toMatchObject({
      path: ['metadata'],
      message: 'exchangeRates.form.errors.metadataTooLarge',
    })
  })

  it('counts multi-byte characters by their UTF-8 size', () => {
    const overhead = JSON.stringify({ note: '' }).length
    const metadata = { note: '\u0105'.repeat(Math.ceil((EXCHANGE_RATE_METADATA_MAX_BYTES - overhead) / 2) + 1) }
    expect(isExchangeRateMetadataWithinLimit(metadata)).toBe(false)
  })

  it('treats absent metadata as within the limit', () => {
    expect(isExchangeRateMetadataWithinLimit(null)).toBe(true)
    expect(isExchangeRateMetadataWithinLimit(undefined)).toBe(true)
  })
})
