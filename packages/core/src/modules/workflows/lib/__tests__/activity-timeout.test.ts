/**
 * @jest-environment node
 *
 * Guards #4424: a per-activity timeout set in the editor never took effect.
 * Three layers disagreed on the field name — the editors wrote `timeoutMs`
 * (number) or `timeout` (number, labelled "ms"), the definition schema accepted
 * only `timeout` (ISO 8601 string), and the executor read only `timeoutMs`. So
 * `z.object()` stripped `timeoutMs` on save, a numeric `timeout` failed
 * validation, and a stored ISO `timeout` was ignored at run time.
 */
import { activityDefinitionSchema } from '../../data/validators'
import { resolveActivityTimeoutMs } from '../activity-executor'

const baseActivity = {
  activityId: 'call_api_1',
  activityName: 'Call API',
  activityType: 'CALL_API' as const,
  config: { endpoint: '/api/x' },
}

describe('activity timeout round-trip (#4424)', () => {
  it('keeps timeoutMs through schema validation instead of stripping it', () => {
    const result = activityDefinitionSchema.safeParse({ ...baseActivity, timeoutMs: 30000 })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.timeoutMs).toBe(30000)
  })

  it('rejects a non-positive or fractional timeoutMs', () => {
    expect(activityDefinitionSchema.safeParse({ ...baseActivity, timeoutMs: 0 }).success).toBe(false)
    expect(activityDefinitionSchema.safeParse({ ...baseActivity, timeoutMs: -1 }).success).toBe(false)
    expect(activityDefinitionSchema.safeParse({ ...baseActivity, timeoutMs: 1.5 }).success).toBe(false)
  })

  it('still accepts the deprecated ISO 8601 timeout string (stored definitions)', () => {
    const result = activityDefinitionSchema.safeParse({ ...baseActivity, timeout: 'PT30S' })
    expect(result.success).toBe(true)
  })
})

describe('resolveActivityTimeoutMs (#4424)', () => {
  it('prefers timeoutMs', () => {
    expect(resolveActivityTimeoutMs({ timeoutMs: 30000 })).toBe(30000)
    expect(resolveActivityTimeoutMs({ timeoutMs: 30000, timeout: 'PT5M' })).toBe(30000)
  })

  it('normalizes a legacy ISO 8601 timeout to milliseconds', () => {
    expect(resolveActivityTimeoutMs({ timeout: 'PT30S' })).toBe(30_000)
    expect(resolveActivityTimeoutMs({ timeout: 'PT5M' })).toBe(300_000)
    expect(resolveActivityTimeoutMs({ timeout: 'PT1H' })).toBe(3_600_000)
  })

  it('normalizes the simple duration format the parser also supports', () => {
    expect(resolveActivityTimeoutMs({ timeout: '30s' })).toBe(30_000)
    expect(resolveActivityTimeoutMs({ timeout: '5m' })).toBe(300_000)
  })

  it('returns undefined when no usable timeout is configured', () => {
    expect(resolveActivityTimeoutMs({})).toBeUndefined()
    expect(resolveActivityTimeoutMs({ timeout: '' })).toBeUndefined()
    expect(resolveActivityTimeoutMs({ timeout: '   ' })).toBeUndefined()
    expect(resolveActivityTimeoutMs({ timeoutMs: 0 })).toBeUndefined()
  })

  it('ignores a malformed timeout rather than failing the activity', () => {
    expect(resolveActivityTimeoutMs({ timeout: 'not-a-duration' })).toBeUndefined()
    expect(resolveActivityTimeoutMs({ timeout: 'PT' })).toBeUndefined()
  })
})
