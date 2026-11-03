/**
 * @jest-environment node
 *
 * The timeout inputs bind two fields — canonical `timeoutMs` and the deprecated
 * `timeout` alias — so a patch that writes only one of them leaves the box
 * showing a value the executor will not use. These cases pin the round-trip:
 * whatever the input displays after an edit is what `resolveActivityTimeoutMs`
 * resolves, and the resulting activity still validates.
 */
import { activityDefinitionSchema } from '../../data/validators'
import {
  durationTimeoutInputValue,
  durationTimeoutPatch,
  millisecondTimeoutInputValue,
  millisecondTimeoutPatch,
  resolveActivityTimeoutMs,
} from '../activityTimeoutFields'

const baseActivity = {
  activityId: 'call_api_1',
  activityName: 'Call API',
  activityType: 'CALL_API' as const,
  config: { endpoint: '/api/x' },
}

describe('durationTimeoutInputValue', () => {
  it('prefers the raw alias text so a duration string stays readable', () => {
    expect(durationTimeoutInputValue({ timeout: 'PT30S' })).toBe('PT30S')
    expect(durationTimeoutInputValue({ timeout: 'PT30S', timeoutMs: 30000 })).toBe('PT30S')
  })

  it('falls back to the canonical field for an activity written by a visual editor', () => {
    expect(durationTimeoutInputValue({ timeoutMs: 5000 })).toBe('5000')
  })

  it('shows nothing when no timeout is configured', () => {
    expect(durationTimeoutInputValue({})).toBe('')
    expect(durationTimeoutInputValue({ timeout: '' })).toBe('')
  })
})

describe('millisecondTimeoutInputValue', () => {
  it('prefers the canonical field', () => {
    expect(millisecondTimeoutInputValue({ timeoutMs: 5000 })).toBe(5000)
    expect(millisecondTimeoutInputValue({ timeoutMs: 5000, timeout: 'PT30S' })).toBe(5000)
  })

  it('normalizes a legacy alias to milliseconds', () => {
    expect(millisecondTimeoutInputValue({ timeout: 'PT30S' })).toBe(30000)
    expect(millisecondTimeoutInputValue({ timeout: '30000' })).toBe(30000)
  })

  it('shows nothing for an absent or unusable timeout', () => {
    expect(millisecondTimeoutInputValue({})).toBe('')
    expect(millisecondTimeoutInputValue({ timeout: 'not-a-duration' })).toBe('')
  })
})

describe('durationTimeoutPatch', () => {
  it('writes both fields so the canonical one reflects what was typed', () => {
    expect(durationTimeoutPatch('60000')).toEqual({ timeout: '60000', timeoutMs: 60000 })
    expect(durationTimeoutPatch('PT30S')).toEqual({ timeout: 'PT30S', timeoutMs: 30000 })
  })

  it('keeps unparseable text visible while clearing the canonical field', () => {
    expect(durationTimeoutPatch('PT')).toEqual({ timeout: 'PT', timeoutMs: undefined })
  })

  it('clears both fields when the box is emptied', () => {
    expect(durationTimeoutPatch('')).toEqual({ timeout: undefined, timeoutMs: undefined })
  })
})

describe('millisecondTimeoutPatch', () => {
  it('writes the canonical field and drops the deprecated alias', () => {
    expect(millisecondTimeoutPatch('60000')).toEqual({ timeout: undefined, timeoutMs: 60000 })
  })

  it('clears both fields when the box is emptied', () => {
    expect(millisecondTimeoutPatch('')).toEqual({ timeout: undefined, timeoutMs: undefined })
  })

  it('never writes a value the definition schema would reject', () => {
    expect(millisecondTimeoutPatch('0').timeoutMs).toBeUndefined()
    expect(millisecondTimeoutPatch('-5').timeoutMs).toBeUndefined()
    expect(millisecondTimeoutPatch('1.5').timeoutMs).toBeUndefined()
  })
})

describe('editor round-trip resolves to the value the box shows', () => {
  it('applies an edit made in the duration editor to an activity a visual editor wrote', () => {
    const stored = { ...baseActivity, timeoutMs: 5000 }
    expect(durationTimeoutInputValue(stored)).toBe('5000')

    const edited = { ...stored, ...durationTimeoutPatch('60000') }

    expect(resolveActivityTimeoutMs(edited)).toBe(60000)
    expect(activityDefinitionSchema.safeParse(edited).success).toBe(true)
  })

  it('clears a legacy alias when the millisecond editor box is emptied', () => {
    const stored = { ...baseActivity, timeout: 'PT30S' }
    expect(millisecondTimeoutInputValue(stored)).toBe(30000)

    const cleared = { ...stored, ...millisecondTimeoutPatch('') }

    expect(resolveActivityTimeoutMs(cleared)).toBeUndefined()
    expect(millisecondTimeoutInputValue(cleared)).toBe('')
    expect(activityDefinitionSchema.safeParse(cleared).success).toBe(true)
  })

  it('replaces a legacy alias when the millisecond editor sets a new value', () => {
    const stored = { ...baseActivity, timeout: 'PT30S' }

    const edited = { ...stored, ...millisecondTimeoutPatch('45000') }

    expect(resolveActivityTimeoutMs(edited)).toBe(45000)
    expect(edited.timeout).toBeUndefined()
  })
})
