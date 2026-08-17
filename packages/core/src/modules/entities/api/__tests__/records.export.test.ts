/** @jest-environment node */
import { GET } from '@open-mercato/core/modules/entities/api/records'

const EXPORT_PAGE_SIZE = 1000

const makeItems = (count: number, offset = 0) =>
  Array.from({ length: count }, (_, index) => ({
    id: `rec-${offset + index}`,
    cf_title: `Title ${offset + index}`,
  }))

const mockQE = {
  query: jest.fn(),
}

const mockEm = {
  findOne: jest.fn(async () => ({ id: 'ce-1', entityId: 'example:custom' })),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({ resolve: (k: string) => (k === 'queryEngine' ? mockQE : mockEm) }),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({ getAuthFromRequest: () => ({ orgId: 'org', tenantId: 't1', roles: ['admin'] }) }))

function queueQueryPages(pages: Array<Array<Record<string, unknown>>>, total: number) {
  mockQE.query.mockImplementation(async (_entityId: string, opts: { page?: { page?: number } }) => {
    const page = opts.page?.page ?? 1
    return { items: pages[page - 1] ?? [], total, page, pageSize: EXPORT_PAGE_SIZE }
  })
}

async function csvRowCount(res: Response): Promise<number> {
  const body = await res.text()
  return body.trim().split('\n').length - 1
}

describe('GET /api/entities/records export loop', () => {
  beforeEach(() => { jest.clearAllMocks() })

  it('exports every row even when total under-reports the result set', async () => {
    queueQueryPages(
      [makeItems(EXPORT_PAGE_SIZE), makeItems(EXPORT_PAGE_SIZE, EXPORT_PAGE_SIZE), makeItems(7, EXPORT_PAGE_SIZE * 2)],
      5,
    )
    const res = await GET(new Request('http://x/api/entities/records?entityId=example:custom&format=csv'))
    expect(res.status).toBe(200)
    expect(await csvRowCount(res)).toBe(EXPORT_PAGE_SIZE * 2 + 7)
    expect(mockQE.query).toHaveBeenCalledTimes(3)
  })

  it('terminates on a short final page instead of trusting an inflated total', async () => {
    queueQueryPages([makeItems(3)], 10_000)
    const res = await GET(new Request('http://x/api/entities/records?entityId=example:custom&format=csv'))
    expect(res.status).toBe(200)
    expect(await csvRowCount(res)).toBe(3)
    expect(mockQE.query).toHaveBeenCalledTimes(1)
  })

  it('fails closed at the page ceiling rather than serializing a partial export', async () => {
    const fullPage = makeItems(EXPORT_PAGE_SIZE)
    mockQE.query.mockImplementation(async () => ({
      items: fullPage,
      total: EXPORT_PAGE_SIZE,
      page: 1,
      pageSize: EXPORT_PAGE_SIZE,
    }))
    const res = await GET(new Request('http://x/api/entities/records?entityId=example:custom&format=csv'))
    expect(res.status).toBe(500)
    expect(mockQE.query).toHaveBeenCalledTimes(1000)
  })
})
