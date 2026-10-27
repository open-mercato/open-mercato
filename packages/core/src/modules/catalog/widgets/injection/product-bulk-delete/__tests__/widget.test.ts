jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  fetchCrudList: jest.fn(),
}))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
}))

import widget from '../widget'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'

const mockedFetchCrudList = fetchCrudList as jest.MockedFunction<typeof fetchCrudList>
const mockedApiCall = apiCall as jest.MockedFunction<typeof apiCall>

const PAGE_SIZE = 100

const bulkDeleteFiltered = widget.bulkActions?.find(
  (action) => action.id === 'catalog.products.bulk-delete-filtered',
)

const makeItems = (count: number, offset = 0) =>
  Array.from({ length: count }, (_, index) => ({ id: `product-${offset + index}` }))

const listPayload = (items: Array<{ id: string }>, totalPages: number) => ({
  items,
  total: items.length,
  page: 1,
  pageSize: PAGE_SIZE,
  totalPages,
})

const context = {
  confirm: jest.fn(async () => true),
  translate: (_key: string, fallback: string) => fallback,
}

describe('catalog product-bulk-delete widget - filtered id enumeration', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockedApiCall.mockResolvedValue({
      ok: true,
      status: 200,
      result: { ok: true, progressJobId: 'job-1' },
      response: {} as Response,
      cacheStatus: null,
    })
  })

  it('exists on the widget', () => {
    expect(bulkDeleteFiltered).toBeDefined()
  })

  it('enumerates every page even when totalPages under-reports the result set', async () => {
    mockedFetchCrudList
      .mockResolvedValueOnce(listPayload(makeItems(PAGE_SIZE), 1))
      .mockResolvedValueOnce(listPayload(makeItems(PAGE_SIZE, PAGE_SIZE), 1))
      .mockResolvedValueOnce(listPayload(makeItems(5, PAGE_SIZE * 2), 1))

    const result = await bulkDeleteFiltered!.onExecute([], context)

    expect(result).toMatchObject({ ok: true, progressJobId: 'job-1' })
    expect(mockedFetchCrudList).toHaveBeenCalledTimes(3)
    const deleteCall = mockedApiCall.mock.calls[0]
    const body = JSON.parse((deleteCall[1] as RequestInit).body as string)
    expect(body.ids).toHaveLength(PAGE_SIZE * 2 + 5)
    expect(body.scope).toBe('filtered')
  })

  it('terminates on a short final page', async () => {
    mockedFetchCrudList.mockResolvedValueOnce(listPayload(makeItems(3), 50))

    const result = await bulkDeleteFiltered!.onExecute([], context)

    expect(result).toMatchObject({ ok: true })
    expect(mockedFetchCrudList).toHaveBeenCalledTimes(1)
    const body = JSON.parse((mockedApiCall.mock.calls[0][1] as RequestInit).body as string)
    expect(body.ids).toHaveLength(3)
  })

  it('throws at the page ceiling rather than deleting a partial set', async () => {
    let offset = 0
    mockedFetchCrudList.mockImplementation(async () => {
      const items = makeItems(PAGE_SIZE, offset)
      offset += PAGE_SIZE
      return listPayload(items, 10_000)
    })

    await expect(bulkDeleteFiltered!.onExecute([], context)).rejects.toThrow(
      /refusing to bulk-delete a partial set/,
    )
    expect(mockedFetchCrudList).toHaveBeenCalledTimes(1000)
    expect(mockedApiCall).not.toHaveBeenCalled()
  })
})
