const mockApiCall = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => mockApiCall(...args),
}))

import { loadSalesOptions, SALES_OPTIONS_MAX_PAGES, SALES_OPTIONS_PAGE_SIZE, type SalesOptionSource } from '../components/settings/salesOptions'

type Channel = { id: string; name: string }

const SOURCE: SalesOptionSource<Channel> = {
  path: '/api/sales/channels',
  label: 'sales channels',
  toOption: (item) => ({ value: item.id, label: item.name }),
}

function channels(prefix: string, count: number): Channel[] {
  return Array.from({ length: count }, (_, index) => ({ id: `${prefix}-${index}`, name: `${prefix} ${index}` }))
}

function paramsOf(url: string): URLSearchParams {
  return new URL(url, 'http://localhost').searchParams
}

function respondWith(pages: Channel[][], byId: Record<string, Channel> = {}) {
  mockApiCall.mockImplementation(async (url: string) => {
    const params = paramsOf(url)
    const id = params.get('id')
    if (id) return { ok: true, status: 200, result: { items: byId[id] ? [byId[id]] : [], totalPages: 1 } }
    const page = Number(params.get('page'))
    return { ok: true, status: 200, result: { items: pages[page - 1] ?? [], totalPages: pages.length } }
  })
}

describe('loadSalesOptions', () => {
  beforeEach(() => mockApiCall.mockReset())

  it('pages through every option, not only the first 100', async () => {
    respondWith([channels('a', SALES_OPTIONS_PAGE_SIZE), channels('b', 30)])
    const options = await loadSalesOptions(SOURCE, null)
    expect(options).toHaveLength(SALES_OPTIONS_PAGE_SIZE + 30)
    expect(options[SALES_OPTIONS_PAGE_SIZE]).toEqual({ value: 'b-0', label: 'b 0' })
    expect(mockApiCall).toHaveBeenCalledTimes(2)
    expect(paramsOf(mockApiCall.mock.calls[1][0]).get('page')).toBe('2')
    expect(paramsOf(mockApiCall.mock.calls[1][0]).get('pageSize')).toBe(String(SALES_OPTIONS_PAGE_SIZE))
  })

  it('keeps a saved option that is past the page cap', async () => {
    const pages = Array.from({ length: SALES_OPTIONS_MAX_PAGES + 2 }, (_, index) => channels(`p${index}`, SALES_OPTIONS_PAGE_SIZE))
    const saved = { id: 'saved-channel', name: 'Saved channel' }
    respondWith(pages, { [saved.id]: saved })
    const options = await loadSalesOptions(SOURCE, saved.id)
    expect(options).toContainEqual({ value: saved.id, label: 'Saved channel' })
    expect(options).toHaveLength(SALES_OPTIONS_MAX_PAGES * SALES_OPTIONS_PAGE_SIZE + 1)
    const lookups = mockApiCall.mock.calls.filter(([url]) => paramsOf(url).get('id') === saved.id)
    expect(lookups).toHaveLength(1)
  })

  it('does not look the saved option up again when it is already listed', async () => {
    respondWith([channels('a', 3)])
    const options = await loadSalesOptions(SOURCE, 'a-1')
    expect(options.map((option) => option.value)).toEqual(['a-0', 'a-1', 'a-2'])
    expect(mockApiCall).toHaveBeenCalledTimes(1)
  })

  it('leaves a saved option that no longer exists to the field', async () => {
    respondWith([channels('a', 2)])
    const options = await loadSalesOptions(SOURCE, 'gone')
    expect(options.map((option) => option.value)).toEqual(['a-0', 'a-1'])
  })

  it('fails when a page cannot be loaded', async () => {
    mockApiCall.mockResolvedValue({ ok: false, status: 403, result: {} })
    await expect(loadSalesOptions(SOURCE, null)).rejects.toThrow('loading sales channels failed with 403')
  })
})
