/** @jest-environment node */

const apiCall = jest.fn()

jest.mock('../apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCall(...args),
}))

import { fetchAllOffsetPages, MAX_OFFSET_PAGES } from '../fetchAllPages'

const okPage = (payload: Record<string, unknown>) => ({ ok: true, result: payload })

const requestedUrls = () => apiCall.mock.calls.map(([url]) => url as string)

describe('fetchAllOffsetPages', () => {
  beforeEach(() => {
    apiCall.mockReset()
  })

  it('issues a single untouched request when the route does not report hasMore', async () => {
    apiCall.mockResolvedValueOnce(okPage({ items: [{ value: 'a' }, { value: 'b' }] }))

    const result = await fetchAllOffsetPages('/api/options')

    expect(requestedUrls()).toEqual(['/api/options'])
    expect(result.ok).toBe(true)
    expect(result.pageCount).toBe(1)
    expect(result.items).toEqual([{ value: 'a' }, { value: 'b' }])
  })

  it('walks hasMore, advancing the offset by the rows already collected', async () => {
    apiCall
      .mockResolvedValueOnce(okPage({ items: [{ value: 'a' }, { value: 'b' }], hasMore: true }))
      .mockResolvedValueOnce(okPage({ items: [{ value: 'c' }], hasMore: false }))

    const result = await fetchAllOffsetPages('/api/options')

    expect(requestedUrls()).toEqual(['/api/options', '/api/options?offset=2'])
    expect(result.items).toHaveLength(3)
    expect(result.pageCount).toBe(2)
  })

  it('preserves the caller query string when it appends the offset', async () => {
    apiCall
      .mockResolvedValueOnce(okPage({ items: [{ value: 'a' }], hasMore: true }))
      .mockResolvedValueOnce(okPage({ items: [{ value: 'b' }], hasMore: false }))

    await fetchAllOffsetPages('/api/options?query=ab&q=ab')

    expect(requestedUrls()[1]).toBe('/api/options?query=ab&q=ab&offset=1')
  })

  it('continues from an offset the caller already put on the url', async () => {
    apiCall
      .mockResolvedValueOnce(okPage({ items: [{ value: 'a' }], hasMore: true }))
      .mockResolvedValueOnce(okPage({ items: [{ value: 'b' }], hasMore: false }))

    await fetchAllOffsetPages('/api/options?offset=10')

    expect(requestedUrls()).toEqual(['/api/options?offset=10', '/api/options?offset=11'])
  })

  it('exposes the first payload so callers can read page-invariant metadata', async () => {
    apiCall
      .mockResolvedValueOnce(okPage({ items: [{ value: 'a' }], hasMore: true, sortMode: 'value_desc' }))
      .mockResolvedValueOnce(okPage({ items: [{ value: 'b' }], hasMore: false, sortMode: 'value_desc' }))

    const result = await fetchAllOffsetPages('/api/options')

    expect(result.firstPayload.sortMode).toBe('value_desc')
  })

  it('stops on an empty page so a route reporting hasMore forever cannot spin', async () => {
    apiCall
      .mockResolvedValueOnce(okPage({ items: [{ value: 'a' }], hasMore: true }))
      .mockResolvedValueOnce(okPage({ items: [], hasMore: true }))

    const result = await fetchAllOffsetPages('/api/options')

    expect(apiCall).toHaveBeenCalledTimes(2)
    expect(result.items).toHaveLength(1)
  })

  it('caps the walk at the page ceiling', async () => {
    apiCall.mockResolvedValue(okPage({ items: [{ value: 'a' }], hasMore: true }))

    const result = await fetchAllOffsetPages('/api/options')

    expect(apiCall).toHaveBeenCalledTimes(MAX_OFFSET_PAGES)
    expect(result.pageCount).toBe(MAX_OFFSET_PAGES)
  })

  it('reports a failed page instead of returning a silently truncated list', async () => {
    apiCall
      .mockResolvedValueOnce(okPage({ items: [{ value: 'a' }], hasMore: true }))
      .mockResolvedValueOnce({ ok: false, result: { error: 'Forbidden' } })

    const result = await fetchAllOffsetPages('/api/options')

    expect(result.ok).toBe(false)
    expect(result.errorPayload).toEqual({ error: 'Forbidden' })
  })
})
