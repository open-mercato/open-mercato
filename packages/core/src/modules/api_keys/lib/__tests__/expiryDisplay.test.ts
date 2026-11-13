import { describe, expect, it } from '@jest/globals'
import { formatDisplayDateTime } from '@open-mercato/ui/primitives/date-format'
import { formatApiKeyExpiry } from '../expiryDisplay'

describe('formatApiKeyExpiry', () => {
  it('renders a date picked in the create form as that calendar day', () => {
    expect(formatApiKeyExpiry('2026-11-07T00:00:00.000Z', 'en-US')).toBe('Nov 7, 2026')
  })

  it('keeps the time of an expiry set as a real instant', () => {
    const value = '2026-11-07T15:30:00.000Z'
    expect(formatApiKeyExpiry(value, 'en-US')).toBe(formatDisplayDateTime(value, 'en-US'))
  })

  it.each([null, undefined, '', 'not-a-date'])('returns null for %p', (value) => {
    expect(formatApiKeyExpiry(value, 'en-US')).toBeNull()
  })
})
