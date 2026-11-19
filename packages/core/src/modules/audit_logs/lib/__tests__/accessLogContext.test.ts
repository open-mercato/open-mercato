import {
  collectAccessLogContextDetails,
  formatContextValue,
  readAccessLogDurationMs,
  readAccessLogOutcome,
} from '../accessLogContext'

describe('accessLogContext', () => {
  it('accepts only known outcomes', () => {
    expect(readAccessLogOutcome({ outcome: 'ok' })).toBe('ok')
    expect(readAccessLogOutcome({ outcome: 'mutation_denied' })).toBe('mutation_denied')
    expect(readAccessLogOutcome({ outcome: 'whatever' })).toBeNull()
    expect(readAccessLogOutcome({ outcome: 'constructor' })).toBeNull()
    expect(readAccessLogOutcome({ outcome: '__proto__' })).toBeNull()
    expect(readAccessLogOutcome({ outcome: 42 })).toBeNull()
    expect(readAccessLogOutcome(null)).toBeNull()
    expect(readAccessLogOutcome(['ok'])).toBeNull()
  })

  it('accepts only finite non-negative durations', () => {
    expect(readAccessLogDurationMs({ durationMs: 12.6 })).toBe(13)
    expect(readAccessLogDurationMs({ durationMs: -1 })).toBeNull()
    expect(readAccessLogDurationMs({ durationMs: Number.POSITIVE_INFINITY })).toBeNull()
    expect(readAccessLogDurationMs({ durationMs: '12' })).toBeNull()
    expect(readAccessLogDurationMs(undefined)).toBeNull()
  })

  it('formats and truncates context values', () => {
    expect(formatContextValue(null)).toBeNull()
    expect(formatContextValue('')).toBeNull()
    expect(formatContextValue([])).toBeNull()
    expect(formatContextValue(false)).toBe('false')
    expect(formatContextValue(['q', 'limit'])).toBe('q, limit')
    expect(formatContextValue({ nested: 1 })).toBe('{"nested":1}')
    const long = formatContextValue('x'.repeat(1000))
    expect(long).toHaveLength(301)
    expect(long?.endsWith('…')).toBe(true)
  })

  it('collects only allow-listed context keys, in a stable order', () => {
    const rows = collectAccessLogContextDetails({
      argKeys: ['q'],
      correlationId: 'corr-1',
      outcome: 'ok',
      durationMs: 5,
      secretToken: 'should-not-be-listed',
      apiKeyId: null,
      principal: 'api_key',
    })
    expect(rows).toEqual([
      { key: 'principal', value: 'api_key' },
      { key: 'correlationId', value: 'corr-1' },
      { key: 'argKeys', value: 'q' },
    ])
  })
})
