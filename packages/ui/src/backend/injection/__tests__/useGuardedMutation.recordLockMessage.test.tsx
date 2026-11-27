/** @jest-environment jsdom */

// Regression (#9225): a widget's onBeforeSave can block a mutation with an
// i18n key as `message` (e.g. the record-lock conflict toast) instead of a
// hard-coded English string. `runMutation` must resolve it through the
// active dictionary before throwing, so callers that flash `err.message`
// (quote Send/Convert) show localized text, not the raw key.

const triggerEventMock = jest.fn()

jest.mock('../InjectionSpot', () => ({
  useInjectionSpotEvents: () => ({
    triggerEvent: (...args: unknown[]) => triggerEventMock(...args),
  }),
}))

const DICTIONARY: Record<string, string> = {
  'record_locks.conflict.title': 'Konflikt rekordu',
}

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string) => DICTIONARY[key] ?? fallback ?? key,
}))

import { act, renderHook } from '@testing-library/react'
import { useGuardedMutation } from '../useGuardedMutation'

describe('useGuardedMutation — localizes widget-blocked messages', () => {
  beforeEach(() => {
    triggerEventMock.mockReset()
  })

  it('resolves an i18n key returned by onBeforeSave to the translated text', async () => {
    triggerEventMock.mockResolvedValue({
      ok: false,
      message: 'record_locks.conflict.title',
      details: { code: 'record_lock_conflict' },
    })
    const { result } = renderHook(() => useGuardedMutation<Record<string, unknown>>({ contextId: 'test-form' }))

    let thrown: Error | null = null
    await act(async () => {
      try {
        await result.current.runMutation({
          operation: async () => 'should-not-run',
          context: {},
          mutationPayload: {},
        })
      } catch (err) {
        thrown = err as Error
      }
    })

    expect(thrown?.message).toBe('Konflikt rekordu')
  })

  it('keeps literal (non-key) widget messages unchanged', async () => {
    triggerEventMock.mockResolvedValue({
      ok: false,
      message: 'This order has shipments. Cancel or return them before cancelling the order.',
    })
    const { result } = renderHook(() => useGuardedMutation<Record<string, unknown>>({ contextId: 'test-form' }))

    let thrown: Error | null = null
    await act(async () => {
      try {
        await result.current.runMutation({
          operation: async () => 'should-not-run',
          context: {},
          mutationPayload: {},
        })
      } catch (err) {
        thrown = err as Error
      }
    })

    expect(thrown?.message).toBe('This order has shipments. Cancel or return them before cancelling the order.')
  })

  it('falls back to blockedMessage when onBeforeSave returns no message', async () => {
    triggerEventMock.mockResolvedValue({ ok: false })
    const { result } = renderHook(() => useGuardedMutation<Record<string, unknown>>({
      contextId: 'test-form',
      blockedMessage: 'Save blocked by validation',
    }))

    let thrown: Error | null = null
    await act(async () => {
      try {
        await result.current.runMutation({
          operation: async () => 'should-not-run',
          context: {},
          mutationPayload: {},
        })
      } catch (err) {
        thrown = err as Error
      }
    })

    expect(thrown?.message).toBe('Save blocked by validation')
  })
})
