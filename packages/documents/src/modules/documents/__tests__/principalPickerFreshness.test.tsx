/** @jest-environment jsdom */

import { act, renderHook } from '@testing-library/react'

const apiCallMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
}))

import { usePrincipalPicker } from '../backend/documents/components/usePrincipalPicker'

async function flushPromises(iterations = 4): Promise<void> {
  for (let index = 0; index < iterations; index += 1) await Promise.resolve()
}

const ADA = {
  id: '11111111-1111-4111-8111-111111111111',
  label: 'Ada Lovelace',
  secondary: 'ada@example.com',
}
const DOCUMENT_ID = '22222222-2222-4222-8222-222222222222'
const OTHER_DOCUMENT_ID = '33333333-3333-4333-8333-333333333333'

describe('principal picker result freshness', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    apiCallMock.mockReset()
  })

  afterEach(() => { jest.useRealTimers() })

  it('clears and invalidates old options before a changed query can select them', async () => {
    const onChange = jest.fn()
    apiCallMock.mockResolvedValue({ ok: true, result: { items: [ADA], total: 1, totalPages: 1 } })
    const { result } = renderHook(() => usePrincipalPicker({
      documentId: DOCUMENT_ID, principalType: 'user', value: null, onChange, disabled: false,
      fallbackLabel: 'Unknown user',
    }))

    act(() => result.current.setOpen(true))
    await act(async () => {
      jest.advanceTimersByTime(250)
      await flushPromises()
    })
    const staleOption = result.current.items[0]
    expect(staleOption).toBeDefined()
    expect(apiCallMock).toHaveBeenCalledWith(
      `/api/documents/${DOCUMENT_ID}/principals?mode=share&type=user&page=1&pageSize=20`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
      expect.anything(),
    )

    act(() => result.current.changeSearch('grace'))
    expect(result.current.items).toEqual([])
    expect(result.current.activeIndex).toBe(-1)
    expect(result.current.hasFetched).toBe(false)

    act(() => result.current.selectOption(staleOption!))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('does not query encrypted principal fields below the tokenizer minimum', async () => {
    const { result } = renderHook(() => usePrincipalPicker({
      documentId: DOCUMENT_ID,
      principalType: 'user',
      value: null,
      onChange: jest.fn(),
      disabled: false,
      fallbackLabel: 'Unknown user',
    }))

    act(() => result.current.changeSearch('ab'))
    await act(async () => {
      jest.advanceTimersByTime(500)
      await flushPromises()
    })

    expect(apiCallMock).not.toHaveBeenCalled()
    expect(result.current.items).toEqual([])
  })

  it('aborts an in-flight query and ignores its response after the search context changes', async () => {
    let resolveAda: ((value: unknown) => void) | null = null
    let adaSignal: AbortSignal | undefined
    apiCallMock.mockImplementation((_url: string, options?: RequestInit) => {
      adaSignal = options?.signal ?? undefined
      return new Promise((resolve) => { resolveAda = resolve })
    })
    const { result } = renderHook(() => usePrincipalPicker({
      documentId: DOCUMENT_ID, principalType: 'user', value: null, onChange: jest.fn(), disabled: false,
      fallbackLabel: 'Unknown user',
    }))

    act(() => { result.current.changeSearch('ada') })
    await act(async () => {
      jest.advanceTimersByTime(250)
      await Promise.resolve()
    })
    expect(adaSignal?.aborted).toBe(false)

    act(() => result.current.changeSearch('grace'))
    expect(adaSignal?.aborted).toBe(true)
    expect(result.current.items).toEqual([])

    await act(async () => {
      resolveAda?.({ ok: true, result: { items: [ADA], total: 1, totalPages: 1 } })
      await flushPromises()
    })
    expect(result.current.items).toEqual([])
  })

  it('blocks user results immediately after switching to the role context', async () => {
    const onChange = jest.fn()
    apiCallMock.mockResolvedValue({ ok: true, result: { items: [ADA], total: 1, totalPages: 1 } })
    const { rerender, result } = renderHook(
      ({ principalType }: { principalType: 'user' | 'role' }) => usePrincipalPicker({
        documentId: DOCUMENT_ID, principalType, value: null, onChange, disabled: false,
        fallbackLabel: principalType === 'user' ? 'Unknown user' : 'Unknown role',
      }),
      { initialProps: { principalType: 'user' as const } },
    )

    act(() => result.current.setOpen(true))
    await act(async () => {
      jest.advanceTimersByTime(250)
      await flushPromises()
    })
    const staleUser = result.current.items[0]
    expect(staleUser).toBeDefined()

    rerender({ principalType: 'role' })
    expect(result.current.items).toEqual([])
    act(() => result.current.selectOption(staleUser!))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('invalidates in-flight results when the mounted dialog switches documents', async () => {
    let resolveRequest: ((value: unknown) => void) | null = null
    apiCallMock.mockImplementation(() => new Promise((resolve) => { resolveRequest = resolve }))
    const onChange = jest.fn()
    const { rerender, result } = renderHook(
      ({ documentId }: { documentId: string }) => usePrincipalPicker({
        documentId,
        principalType: 'user',
        value: null,
        onChange,
        disabled: false,
        fallbackLabel: 'Unknown user',
      }),
      { initialProps: { documentId: DOCUMENT_ID } },
    )

    act(() => result.current.changeSearch('ada'))
    await act(async () => {
      jest.advanceTimersByTime(250)
      await Promise.resolve()
    })

    rerender({ documentId: OTHER_DOCUMENT_ID })
    await act(async () => {
      resolveRequest?.({ ok: true, result: { items: [ADA], total: 1, totalPages: 1 } })
      await flushPromises()
    })

    expect(result.current.items).toEqual([])
    expect(onChange).not.toHaveBeenCalled()
  })

  it('closes, invalidates, and refuses stale selection when the picker becomes disabled', async () => {
    const onChange = jest.fn()
    apiCallMock.mockResolvedValue({ ok: true, result: { items: [ADA], total: 1, totalPages: 1 } })
    const { rerender, result } = renderHook(
      ({ disabled }: { disabled: boolean }) => usePrincipalPicker({
        documentId: DOCUMENT_ID,
        principalType: 'user',
        value: null,
        onChange,
        disabled,
        fallbackLabel: 'Unknown user',
      }),
      { initialProps: { disabled: false } },
    )

    act(() => result.current.setOpen(true))
    await act(async () => {
      jest.advanceTimersByTime(250)
      await flushPromises()
    })
    const staleOption = result.current.items[0]
    expect(staleOption).toBeDefined()

    rerender({ disabled: true })

    expect(result.current.open).toBe(false)
    expect(result.current.items).toEqual([])
    act(() => result.current.selectOption(staleOption!))
    expect(onChange).not.toHaveBeenCalled()
  })
})
