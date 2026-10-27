/** @jest-environment jsdom */

import { act, renderHook } from '@testing-library/react'

const apiCallMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
}))

jest.mock('@open-mercato/shared/modules/widgets/injection-loader', () => {
  const enabledModuleIds = new Set(['customers'])
  return {
    getEnabledModuleIds: () => enabledModuleIds,
    getInjectionRegistryVersion: () => 1,
    subscribeToInjectionRegistryChanges: () => () => undefined,
  }
})

import { useEntitySearch } from '../backend/documents/components/useEntitySearch'

async function flushPromises(iterations = 4): Promise<void> {
  for (let index = 0; index < iterations; index += 1) await Promise.resolve()
}

describe('entity search type switching', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    apiCallMock.mockReset()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('clears old typed results immediately and ignores their in-flight response', async () => {
    let resolveDelayedPerson: ((value: unknown) => void) | null = null
    apiCallMock
      .mockResolvedValueOnce({
        ok: true,
        result: { items: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Ada Lovelace' }] },
      })
      .mockImplementationOnce(() => new Promise((resolve) => { resolveDelayedPerson = resolve }))

    const { result } = renderHook(() => useEntitySearch(
      true,
      ['customer-person', 'deal'],
    ))

    act(() => result.current.setSearchValue('ada'))
    await act(async () => {
      jest.advanceTimersByTime(250)
      await flushPromises()
    })
    expect(result.current.items).toEqual([
      expect.objectContaining({ id: '11111111-1111-4111-8111-111111111111', label: 'Ada Lovelace' }),
    ])

    act(() => result.current.setSearchValue('grace'))
    await act(async () => {
      jest.advanceTimersByTime(250)
      await Promise.resolve()
    })
    expect(resolveDelayedPerson).not.toBeNull()

    act(() => result.current.setActiveType('deal'))
    expect(result.current.activeEntry?.type).toBe('deal')
    expect(result.current.items).toEqual([])
    expect(result.current.activeIndex).toBe(-1)
    expect(result.current.hasSearched).toBe(false)

    await act(async () => {
      resolveDelayedPerson?.({
        ok: true,
        result: { items: [{ id: '22222222-2222-4222-8222-222222222222', name: 'Grace Hopper' }] },
      })
      await flushPromises()
    })

    expect(result.current.activeEntry?.type).toBe('deal')
    expect(result.current.items).toEqual([])
  })

  it('invalidates selectable results synchronously when the query changes', async () => {
    apiCallMock.mockResolvedValue({
      ok: true,
      result: { items: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Ada Lovelace' }] },
    })
    const { result } = renderHook(() => useEntitySearch(true, ['customer-person']))

    act(() => result.current.setSearchValue('ada'))
    await act(async () => {
      jest.advanceTimersByTime(250)
      await flushPromises()
    })
    expect(result.current.items).toHaveLength(1)
    expect(result.current.isResultCurrent()).toBe(true)

    act(() => result.current.setSearchValue('grace'))

    expect(result.current.items).toEqual([])
    expect(result.current.activeIndex).toBe(-1)
    expect(result.current.hasSearched).toBe(false)
    expect(result.current.isResultCurrent()).toBe(false)
  })

  it('keeps transient failures retryable without removing the active type', async () => {
    apiCallMock
      .mockResolvedValueOnce({ ok: false, status: 503, result: { error: 'unavailable' } })
      .mockResolvedValueOnce({
        ok: true,
        result: { items: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Ada Lovelace' }] },
      })
    const { result } = renderHook(() => useEntitySearch(true, ['customer-person']))

    act(() => result.current.setSearchValue('ada'))
    await act(async () => {
      jest.advanceTimersByTime(250)
      await flushPromises()
    })

    expect(result.current.hasError).toBe(true)
    expect(result.current.availableEntries.map((entry) => entry.type)).toEqual(['customer-person'])
    expect(result.current.hasSearched).toBe(false)

    act(() => result.current.retry())
    await act(async () => {
      jest.advanceTimersByTime(250)
      await flushPromises()
    })

    expect(result.current.hasError).toBe(false)
    expect(result.current.items).toEqual([
      expect.objectContaining({ id: '11111111-1111-4111-8111-111111111111', label: 'Ada Lovelace' }),
    ])
  })

  it('removes only definitively forbidden entity types', async () => {
    apiCallMock
      .mockResolvedValueOnce({ ok: false, status: 403, result: { error: 'forbidden' } })
      .mockResolvedValueOnce({ ok: true, result: { items: [] } })
    const { result } = renderHook(() => useEntitySearch(true, ['customer-person', 'deal']))

    act(() => result.current.setSearchValue('restricted'))
    await act(async () => {
      jest.advanceTimersByTime(250)
      await flushPromises()
    })
    await act(async () => {
      jest.advanceTimersByTime(250)
      await flushPromises()
    })

    expect(result.current.availableEntries.map((entry) => entry.type)).toEqual(['deal'])
    expect(result.current.activeEntry?.type).toBe('deal')
    expect(result.current.hasError).toBe(false)
  })
})
