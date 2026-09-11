/**
 * @jest-environment jsdom
 *
 * Step 4.1: activity-type selects are driven by the Activity Registry instead
 * of hardcoded label arrays. The hook must return one option per registered
 * type (all nine built-ins, including SET_VARIABLE and INVOKE_AGENT) with labels resolved
 * through the i18n t function.
 */
import { renderHook } from '@testing-library/react'
import { useActivityTypeOptions } from '../fields/useActivityTypeOptions'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string) => `translated:${key}`,
}))

const BUILTIN_ACTIVITY_TYPE_IDS = [
  'SEND_EMAIL',
  'EMIT_EVENT',
  'UPDATE_ENTITY',
  'CALL_WEBHOOK',
  'EXECUTE_FUNCTION',
  'WAIT',
  'CALL_API',
  'SET_VARIABLE',
  'INVOKE_AGENT',
]

describe('useActivityTypeOptions', () => {
  it('returns one option per registered activity type', () => {
    const { result } = renderHook(() => useActivityTypeOptions())

    expect(result.current).toHaveLength(BUILTIN_ACTIVITY_TYPE_IDS.length)
    expect(result.current.map((option) => option.value)).toEqual(
      expect.arrayContaining(BUILTIN_ACTIVITY_TYPE_IDS),
    )
  })

  it('resolves labels through t using each registry i18n key', () => {
    const { result } = renderHook(() => useActivityTypeOptions())

    for (const option of result.current) {
      expect(option.label).toBe(`translated:workflows.activities.types.${option.value}`)
    }
  })
})
