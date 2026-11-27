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

const selectedAction = widget.bulkActions.find((action) => action.id === 'catalog.products.ai-categorize-selected')!
const filteredAction = widget.bulkActions.find((action) => action.id === 'catalog.products.ai-categorize-filtered')!

const makeRows = (count: number) => Array.from({ length: count }, (_, index) => ({ id: `product-${index}` }))

const apiResponse = (status: number, result: unknown) =>
  ({ ok: status >= 200 && status < 300, status, result, response: {} as Response, cacheStatus: null }) as never

const buildContext = (confirmResult = true) => ({
  confirm: jest.fn(async () => confirmResult),
  translate: (_key: string, fallback: string, params?: Record<string, string | number>) =>
    fallback.replace(/\{(\w+)\}/g, (_match, name: string) => String(params?.[name] ?? '')),
})

const mockSettings = (effective: boolean) =>
  mockedApiCall.mockImplementation(async (url: string) => {
    if (url.endsWith('/settings')) return apiResponse(200, { effective })
    return apiResponse(202, { ok: true, progressJobId: 'job-1' })
  })

describe('catalog product-ai-categorize widget', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockSettings(true)
  })

  it('is gated by the ai_categorization.use feature and exposes both actions', () => {
    expect(widget.metadata.features).toEqual(['catalog.ai_categorization.use'])
    expect(selectedAction).toBeDefined()
    expect(filteredAction.requiresSelection).toBe(false)
  })

  it('reports an empty selection without calling the API', async () => {
    const result = await selectedAction.onExecute([], buildContext())
    expect(result).toMatchObject({ ok: false })
    expect(mockedApiCall).not.toHaveBeenCalled()
  })

  it('confirms with the count and posts the selected ids', async () => {
    const context = buildContext()
    const result = await selectedAction.onExecute(makeRows(3), context)

    expect(result).toMatchObject({ ok: true, progressJobId: 'job-1' })
    expect(context.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('3 products') }),
    )
    const bulkCall = mockedApiCall.mock.calls.find((call) => call[0] === '/api/catalog/ai-categorization/bulk')!
    const body = JSON.parse((bulkCall[1] as RequestInit).body as string)
    expect(body).toEqual({ productIds: ['product-0', 'product-1', 'product-2'], scope: 'selected' })
  })

  it('does not start a job when the operator cancels the dialog', async () => {
    const result = await selectedAction.onExecute(makeRows(2), buildContext(false))
    expect(result).toEqual({ ok: false, message: undefined })
    expect(mockedApiCall.mock.calls.some((call) => call[0] === '/api/catalog/ai-categorization/bulk')).toBe(false)
  })

  it('refuses a selection above the 1000 product cap before any request', async () => {
    const context = buildContext()
    const result = await selectedAction.onExecute(makeRows(1001), context)
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining('1000') })
    expect(context.confirm).not.toHaveBeenCalled()
    expect(mockedApiCall).not.toHaveBeenCalled()
  })

  it('stops with a message and no dialog when the feature is not effective', async () => {
    mockSettings(false)
    const context = buildContext()
    const result = await selectedAction.onExecute(makeRows(2), context)
    expect(result).toMatchObject({ ok: false })
    expect(context.confirm).not.toHaveBeenCalled()
  })

  it('maps a 409 from the bulk route to the unavailable message', async () => {
    mockedApiCall.mockImplementation(async (url: string) =>
      url.endsWith('/settings')
        ? apiResponse(200, { effective: true })
        : apiResponse(409, { code: 'ai_categorization_unavailable' }),
    )
    const result = await selectedAction.onExecute(makeRows(1), buildContext())
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining('not available') })
  })

  it('enumerates filtered ids and refuses more than 1000 matches', async () => {
    let offset = 0
    mockedFetchCrudList.mockImplementation(async () => {
      const items = Array.from({ length: 100 }, (_, index) => ({ id: `product-${offset + index}` }))
      offset += 100
      return { items, total: 5000, page: 1, pageSize: 100, totalPages: 50 } as never
    })
    const context = buildContext()
    const result = await filteredAction.onExecute([], context)
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining('1000') })
    expect(mockedFetchCrudList).toHaveBeenCalledTimes(11)
    expect(context.confirm).not.toHaveBeenCalled()
  })

  it('posts filtered ids with the filtered scope', async () => {
    mockedFetchCrudList.mockResolvedValueOnce({
      items: makeRows(4),
      total: 4,
      page: 1,
      pageSize: 100,
      totalPages: 1,
    } as never)
    const result = await filteredAction.onExecute([], buildContext())
    expect(result).toMatchObject({ ok: true, progressJobId: 'job-1' })
    const bulkCall = mockedApiCall.mock.calls.find((call) => call[0] === '/api/catalog/ai-categorization/bulk')!
    expect(JSON.parse((bulkCall[1] as RequestInit).body as string)).toMatchObject({ scope: 'filtered' })
  })
})
