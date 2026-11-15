/** @jest-environment jsdom */
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient } from '@tanstack/react-query'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { usePeopleDictionaryMaps } from '../usePeopleDictionaryMaps'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({ readApiResultOrThrow: jest.fn() }))

const readDictionary = jest.mocked(readApiResultOrThrow)
const entries = {
  statuses: { id: 'status', value: 'active', label: 'Aktywny' },
  sources: { id: 'source', value: 'customer_referral', label: 'Polecenie klienta' },
  'lifecycle-stages': { id: 'stage', value: 'customer', label: 'Klient' },
}

function successfulRead(url: string) {
  const kind = url.split('/').pop()?.split('?')[0] as keyof typeof entries
  return Promise.resolve({ items: [entries[kind]] })
}

describe('People dictionary refresh', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    readDictionary.mockReset().mockImplementation(successfulRead)
  })

  afterEach(() => queryClient.clear())

  it('keeps all successful localized labels when an offline refresh fails, then recovers', async () => {
    const { result, rerender } = renderHook(({ reloadToken }) => usePeopleDictionaryMaps(queryClient, 0, reloadToken), {
      initialProps: { reloadToken: 0 },
    })
    await waitFor(() => expect(result.current.sources.customer_referral?.label).toBe('Polecenie klienta'))
    const successfulMaps = result.current
    await queryClient.invalidateQueries()
    readDictionary.mockRejectedValue(new TypeError('offline'))
    rerender({ reloadToken: 1 })
    await waitFor(() => expect(readDictionary).toHaveBeenCalledTimes(6))
    await act(async () => { await Promise.resolve() })
    expect(result.current).toEqual(successfulMaps)
    expect(result.current.statuses.active.label).toBe('Aktywny')
    expect(result.current['lifecycle-stages'].customer.label).toBe('Klient')

    readDictionary.mockImplementation(async (url) => {
      const payload = await successfulRead(url)
      return { items: payload.items.map((entry) => ({ ...entry, label: `${entry.label} updated` })) }
    })
    rerender({ reloadToken: 2 })
    await waitFor(() => expect(result.current.statuses.active.label).toBe('Aktywny updated'))
  })

  it('accepts a successful empty dictionary while preserving other failed dictionaries', async () => {
    const { result, rerender } = renderHook(({ reloadToken }) => usePeopleDictionaryMaps(queryClient, 0, reloadToken), {
      initialProps: { reloadToken: 0 },
    })
    await waitFor(() => expect(result.current.statuses.active).toBeDefined())
    await queryClient.invalidateQueries()
    readDictionary.mockImplementation((url) => url.includes('/statuses?')
      ? Promise.resolve({ items: [] })
      : Promise.reject(new TypeError('offline')))
    rerender({ reloadToken: 1 })
    await waitFor(() => expect(result.current.statuses).toEqual({}))
    expect(result.current.sources.customer_referral.label).toBe('Polecenie klienta')
  })

  it('clears old scope labels even if all new scope reads fail', async () => {
    const { result, rerender } = renderHook(({ scopeVersion }) => usePeopleDictionaryMaps(queryClient, scopeVersion, 0), {
      initialProps: { scopeVersion: 0 },
    })
    await waitFor(() => expect(result.current.statuses.active).toBeDefined())
    readDictionary.mockRejectedValue(new TypeError('offline'))
    rerender({ scopeVersion: 1 })
    expect(Object.values(result.current).every((map) => Object.keys(map).length === 0)).toBe(true)
    await waitFor(() => expect(readDictionary).toHaveBeenCalledTimes(6))
    expect(result.current.statuses).toEqual({})
  })

  it('ignores a late successful response from the previous scope', async () => {
    let finishOldRead: ((payload: unknown) => void) | undefined
    readDictionary.mockImplementation((url) => url.includes('/statuses?')
      ? new Promise((resolve) => { finishOldRead = resolve })
      : successfulRead(url))
    const { result, rerender } = renderHook(({ scopeVersion }) => usePeopleDictionaryMaps(queryClient, scopeVersion, 0), {
      initialProps: { scopeVersion: 0 },
    })
    await waitFor(() => expect(result.current.sources.customer_referral).toBeDefined())
    readDictionary.mockRejectedValue(new TypeError('offline'))
    rerender({ scopeVersion: 1 })
    await act(async () => { finishOldRead?.({ items: [entries.statuses] }) })
    expect(result.current.statuses).toEqual({})
    expect(result.current.sources).toEqual({})
  })
})
