/** @jest-environment node */

const apiCall = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCall(...args),
}))

import { dictionaryEntriesQueryOptions } from '../useDictionaryEntries'

const dictionaryId = '44444444-4444-4444-8444-444444444444'

const makeItem = (value: string, label: string) => ({
  id: `${value}-id`,
  value,
  label,
  color: null,
  icon: null,
  position: 0,
  isDefault: false,
  createdAt: '2026-04-11T08:00:00.000Z',
  updatedAt: '2026-04-11T08:00:00.000Z',
})

const okPage = (payload: Record<string, unknown>) => ({ ok: true, result: payload })

const runQuery = () => dictionaryEntriesQueryOptions(dictionaryId).queryFn()

const requestedUrls = () => apiCall.mock.calls.map(([url]) => url as string)

describe('useDictionaryEntries paging', () => {
  beforeEach(() => {
    apiCall.mockReset()
  })

  it('issues a single request and keeps the server order when the dictionary fits one page', async () => {
    apiCall.mockResolvedValueOnce(
      okPage({
        items: [makeItem('b', 'Beta'), makeItem('a', 'Alpha')],
        total: 2,
        limit: 500,
        offset: 0,
        hasMore: false,
        sortMode: 'label_asc',
      }),
    )

    const data = await runQuery()

    expect(requestedUrls()).toEqual([`/api/dictionaries/${dictionaryId}/entries`])
    expect(data.fullEntries.map((entry) => entry.value)).toEqual(['b', 'a'])
  })

  it('walks hasMore until the dictionary is fully loaded', async () => {
    apiCall
      .mockResolvedValueOnce(
        okPage({
          items: [makeItem('a', 'Alpha'), makeItem('c', 'Gamma')],
          total: 3,
          limit: 2,
          offset: 0,
          hasMore: true,
          sortMode: 'label_asc',
        }),
      )
      .mockResolvedValueOnce(
        okPage({
          items: [makeItem('b', 'Beta')],
          total: 3,
          limit: 2,
          offset: 2,
          hasMore: false,
          sortMode: 'label_asc',
        }),
      )

    const data = await runQuery()

    expect(requestedUrls()).toEqual([
      `/api/dictionaries/${dictionaryId}/entries`,
      `/api/dictionaries/${dictionaryId}/entries?offset=2`,
    ])
    expect(data.fullEntries).toHaveLength(3)
    expect(data.map.b?.label).toBe('Beta')
  })

  it('re-sorts the assembled set so page boundaries do not break the dictionary sort mode', async () => {
    apiCall
      .mockResolvedValueOnce(
        okPage({
          items: [makeItem('c', 'Gamma'), makeItem('d', 'Delta')],
          total: 4,
          limit: 2,
          offset: 0,
          hasMore: true,
          sortMode: 'label_asc',
        }),
      )
      .mockResolvedValueOnce(
        okPage({
          items: [makeItem('a', 'Alpha'), makeItem('b', 'Beta')],
          total: 4,
          limit: 2,
          offset: 2,
          hasMore: false,
          sortMode: 'label_asc',
        }),
      )

    const data = await runQuery()

    expect(data.fullEntries.map((entry) => entry.label)).toEqual(['Alpha', 'Beta', 'Delta', 'Gamma'])
    expect(data.entries.map((entry) => entry.label)).toEqual(['Alpha', 'Beta', 'Delta', 'Gamma'])
  })

  it('stops instead of spinning when the server keeps reporting hasMore', async () => {
    apiCall.mockResolvedValue(
      okPage({
        items: [makeItem('a', 'Alpha')],
        total: 9999,
        limit: 1,
        offset: 0,
        hasMore: true,
        sortMode: 'label_asc',
      }),
    )

    const data = await runQuery()

    expect(apiCall).toHaveBeenCalledTimes(50)
    expect(data.fullEntries.length).toBeGreaterThan(0)
  })

  it('surfaces the API error instead of returning a truncated list', async () => {
    apiCall
      .mockResolvedValueOnce(
        okPage({
          items: [makeItem('a', 'Alpha')],
          total: 2,
          limit: 1,
          offset: 0,
          hasMore: true,
          sortMode: 'label_asc',
        }),
      )
      .mockResolvedValueOnce({ ok: false, result: { error: 'Forbidden' } })

    await expect(runQuery()).rejects.toThrow('Forbidden')
  })
})
