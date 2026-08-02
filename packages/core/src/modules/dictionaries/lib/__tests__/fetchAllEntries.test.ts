/** @jest-environment node */

const apiCall = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCall(...args),
}))

import { fetchAllDictionaryEntries } from '../fetchAllEntries'

const dictionaryId = '55555555-5555-4555-8555-555555555555'

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

const requestedUrls = () => apiCall.mock.calls.map(([url]) => url as string)

describe('fetchAllDictionaryEntries', () => {
  beforeEach(() => {
    apiCall.mockReset()
  })

  it('keeps the server ordering untouched when the dictionary fits one page', async () => {
    apiCall.mockResolvedValueOnce(
      okPage({
        items: [makeItem('b', 'Beta'), makeItem('a', 'Alpha')],
        total: 2,
        hasMore: false,
        sortMode: 'label_asc',
      }),
    )

    const result = await fetchAllDictionaryEntries(dictionaryId)

    expect(requestedUrls()).toEqual([`/api/dictionaries/${dictionaryId}/entries`])
    expect(result.items.map((entry) => entry.value)).toEqual(['b', 'a'])
    expect(result.pageCount).toBe(1)
  })

  it('walks hasMore so entries past the route ceiling are still returned', async () => {
    apiCall
      .mockResolvedValueOnce(
        okPage({ items: [makeItem('a', 'Alpha'), makeItem('b', 'Beta')], hasMore: true, sortMode: 'label_asc' }),
      )
      .mockResolvedValueOnce(
        okPage({ items: [makeItem('c', 'Gamma')], hasMore: false, sortMode: 'label_asc' }),
      )

    const result = await fetchAllDictionaryEntries(dictionaryId)

    expect(requestedUrls()).toEqual([
      `/api/dictionaries/${dictionaryId}/entries`,
      `/api/dictionaries/${dictionaryId}/entries?offset=2`,
    ])
    expect(result.items).toHaveLength(3)
  })

  it('re-sorts the assembled set so page boundaries do not break the sort mode', async () => {
    apiCall
      .mockResolvedValueOnce(
        okPage({ items: [makeItem('c', 'Gamma'), makeItem('d', 'Delta')], hasMore: true, sortMode: 'label_asc' }),
      )
      .mockResolvedValueOnce(
        okPage({ items: [makeItem('a', 'Alpha'), makeItem('b', 'Beta')], hasMore: false, sortMode: 'label_asc' }),
      )

    const result = await fetchAllDictionaryEntries(dictionaryId)

    expect(result.items.map((entry) => entry.label)).toEqual(['Alpha', 'Beta', 'Delta', 'Gamma'])
  })

  it('honors a non-default sort mode when it re-sorts across pages', async () => {
    apiCall
      .mockResolvedValueOnce(
        okPage({ items: [makeItem('a', 'Alpha'), makeItem('c', 'Gamma')], hasMore: true, sortMode: 'value_desc' }),
      )
      .mockResolvedValueOnce(
        okPage({ items: [makeItem('b', 'Beta')], hasMore: false, sortMode: 'value_desc' }),
      )

    const result = await fetchAllDictionaryEntries(dictionaryId)

    expect(result.items.map((entry) => entry.value)).toEqual(['c', 'b', 'a'])
  })

  it('surfaces the route error instead of reporting a truncated list as complete', async () => {
    apiCall
      .mockResolvedValueOnce(okPage({ items: [makeItem('a', 'Alpha')], hasMore: true, sortMode: 'label_asc' }))
      .mockResolvedValueOnce({ ok: false, result: { error: 'Forbidden' } })

    const result = await fetchAllDictionaryEntries(dictionaryId)

    expect(result.ok).toBe(false)
    expect(result.errorMessage).toBe('Forbidden')
  })
})
