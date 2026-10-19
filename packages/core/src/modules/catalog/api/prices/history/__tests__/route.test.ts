const tenantId = '11111111-1111-4111-8111-111111111111'
const otherTenantId = '99999999-9999-4999-8999-999999999999'
const organizationId = '22222222-2222-4222-8222-222222222222'
const otherOrganizationId = '88888888-8888-4888-8888-888888888888'
const userId = '33333333-3333-4333-8333-333333333333'
const productId = '44444444-4444-4444-8444-444444444444'
const priceKindId = '55555555-5555-4555-8555-555555555555'
const priceId = '66666666-6666-4666-8666-666666666666'

type Row = Record<string, unknown>
type Scope = { selectedId: string | null; filterIds: string[] | null; allowedIds: string[] | null; tenantId: string | null }

function compareValues(left: unknown, right: unknown): number {
  const normalize = (value: unknown) => (value instanceof Date ? value.getTime() : value)
  const leftValue = normalize(left) as string | number
  const rightValue = normalize(right) as string | number
  if (leftValue < rightValue) return -1
  if (leftValue > rightValue) return 1
  return 0
}

function matchesCondition(value: unknown, condition: unknown): boolean {
  if (condition instanceof Date) return value instanceof Date && value.getTime() === condition.getTime()
  if (condition && typeof condition === 'object' && !Array.isArray(condition)) {
    return Object.entries(condition as Record<string, unknown>).every(([operator, operand]) => {
      if (operator === '$in') return (operand as unknown[]).includes(value)
      if (operator === '$lt') return compareValues(value, operand) < 0
      if (operator === '$lte') return compareValues(value, operand) <= 0
      if (operator === '$gte') return compareValues(value, operand) >= 0
      throw new Error(`unsupported operator ${operator}`)
    })
  }
  return value === condition
}

function matchesWhere(row: Row, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (key === '$and') return (condition as Record<string, unknown>[]).every((part) => matchesWhere(row, part))
    if (key === '$or') return (condition as Record<string, unknown>[]).some((part) => matchesWhere(row, part))
    return matchesCondition(row[key], condition)
  })
}

let dataset: Row[] = []
let authValue: Record<string, unknown> | null = null
let scopeValue: Scope = { selectedId: null, filterIds: null, allowedIds: null, tenantId: null }
const findWithDecryptionMock = jest.fn()
const countMock = jest.fn()

function queryRows(where: Record<string, unknown>, options?: { limit?: number }): Row[] {
  const sorted = dataset
    .filter((row) => matchesWhere(row, where))
    .sort((left, right) => {
      const byDate = compareValues(right.recordedAt, left.recordedAt)
      return byDate !== 0 ? byDate : compareValues(right.id, left.id)
    })
  return typeof options?.limit === 'number' ? sorted.slice(0, options.limit) : sorted
}

const em = {
  fork: () => em,
  count: (...args: unknown[]) => countMock(...args),
}

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'em') return em
    throw new Error(`Unexpected container resolve: ${name}`)
  }),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => authValue),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(async () => scopeValue),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => findWithDecryptionMock(...args),
}))

import { GET, metadata } from '../route'
import { decodePriceHistoryCursor, encodePriceHistoryCursor } from '../../../../lib/priceHistoryQuery'

function uuidFor(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`
}

function makeRow(index: number, overrides: Row = {}): Row {
  return {
    id: uuidFor(index),
    tenantId,
    organizationId,
    priceId,
    productId,
    variantId: null,
    offerId: null,
    channelId: null,
    priceKindId,
    priceKindCode: 'regular',
    currencyCode: 'PLN',
    unitPriceNet: '81.3008',
    unitPriceGross: '100',
    taxRate: '23.0000',
    taxAmount: '18.6992',
    minQuantity: null,
    maxQuantity: null,
    startsAt: null,
    endsAt: null,
    recordedAt: new Date(Date.UTC(2026, 4, 1, 9, 0, index)),
    changeType: 'update',
    source: 'api',
    isAnnounced: null,
    idempotencyKey: null,
    metadata: null,
    ...overrides,
  }
}

function request(query: string): Request {
  return new Request(`http://localhost/api/catalog/prices/history${query}`)
}

function scopedRequest(query: string): Request {
  const params = query.startsWith('?') ? `&${query.slice(1)}` : query
  return request(`?productId=${productId}${params}`)
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>
}

describe('GET /api/catalog/prices/history', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    authValue = { tenantId, sub: userId, orgId: organizationId }
    scopeValue = { selectedId: organizationId, filterIds: [organizationId], allowedIds: [organizationId], tenantId }
    dataset = []
    findWithDecryptionMock.mockImplementation(
      async (_em: unknown, _entity: unknown, where: Record<string, unknown>, options?: { limit?: number }) =>
        queryRows(where, options),
    )
    countMock.mockImplementation(async (_entity: unknown, where: Record<string, unknown>) => queryRows(where).length)
  })

  it('guards the route with catalog.price_history.view', () => {
    expect(metadata.GET).toEqual({ requireAuth: true, requireFeatures: ['catalog.price_history.view'] })
  })

  it('rejects unauthenticated requests', async () => {
    authValue = null
    const response = await GET(request(''))
    expect(response.status).toBe(401)
    await expect(readJson(response)).resolves.toEqual({ error: 'Unauthorized' })
    expect(findWithDecryptionMock).not.toHaveBeenCalled()
  })

  it.each([
    ['unknown parameter', '?foo=bar'],
    ['non-uuid productId', '?productId=abc'],
    ['pageSize above 100', '?pageSize=101'],
    ['pageSize below 1', '?pageSize=0'],
    ['invalid currency', '?currencyCode=PL'],
    ['invalid from date', '?from=yesterday'],
    ['from after to', '?from=2026-06-02T00:00:00.000Z&to=2026-06-01T00:00:00.000Z'],
    ['invalid includeTotal', '?includeTotal=maybe'],
    ['neither productId nor variantId', ''],
    ['an unscoped total', '?includeTotal=true'],
    ['only non-scoping filters', `?priceKindId=${priceKindId}&currencyCode=PLN`],
  ])('returns 400 for %s', async (_label, query) => {
    const response = await GET(request(query))
    expect(response.status).toBe(400)
    const body = await readJson(response)
    expect(body.error).toBe('Invalid query')
    expect(body.details).toEqual(expect.any(Object))
    expect(findWithDecryptionMock).not.toHaveBeenCalled()
  })

  it('never returns rows from another tenant or organization', async () => {
    dataset = [
      makeRow(1),
      makeRow(2, { tenantId: otherTenantId }),
      makeRow(3, { organizationId: otherOrganizationId }),
      makeRow(4, { tenantId: otherTenantId, organizationId: otherOrganizationId }),
    ]
    const response = await GET(request(`?productId=${productId}&includeTotal=true`))
    expect(response.status).toBe(200)
    const body = await readJson(response)
    expect((body.items as Row[]).map((item) => item.id)).toEqual([uuidFor(1)])
    expect(body.total).toBe(1)
    const [, , where, , decryptionScope] = findWithDecryptionMock.mock.calls[0]
    expect(JSON.stringify(where)).toContain(tenantId)
    expect(decryptionScope).toEqual({ tenantId, organizationId })
  })

  it('returns an empty page without querying when the caller has no organization access', async () => {
    authValue = { tenantId, sub: userId, orgId: null }
    scopeValue = { selectedId: null, filterIds: [], allowedIds: [], tenantId }
    dataset = [makeRow(1)]
    const response = await GET(scopedRequest('?includeTotal=true'))
    await expect(readJson(response)).resolves.toEqual({ items: [], nextCursor: null, total: 0 })
    expect(findWithDecryptionMock).not.toHaveBeenCalled()
  })

  it('applies field filters and the inclusive recorded_at window', async () => {
    dataset = [
      makeRow(1),
      makeRow(2, { currencyCode: 'EUR' }),
      makeRow(3, { priceKindId: uuidFor(900) }),
      makeRow(10),
    ]
    const from = new Date(Date.UTC(2026, 4, 1, 9, 0, 1)).toISOString()
    const to = new Date(Date.UTC(2026, 4, 1, 9, 0, 5)).toISOString()
    const response = await GET(
      scopedRequest(`?priceKindId=${priceKindId}&currencyCode=pln&from=${from}&to=${to}`),
    )
    const body = await readJson(response)
    expect((body.items as Row[]).map((item) => item.id)).toEqual([uuidFor(1)])
  })

  it('serializes money as fixed 4-decimal strings and omits total by default', async () => {
    dataset = [makeRow(1, { isAnnounced: true, startsAt: new Date('2026-06-01T00:00:00.000Z') })]
    const response = await GET(scopedRequest(''))
    const body = await readJson(response)
    expect(body).not.toHaveProperty('total')
    expect(body.nextCursor).toBeNull()
    expect(countMock).not.toHaveBeenCalled()
    const [item] = body.items as Row[]
    expect(item).toMatchObject({
      unitPriceNet: '81.3008',
      unitPriceGross: '100.0000',
      taxRate: '23.0000',
      isAnnounced: true,
      startsAt: '2026-06-01T00:00:00.000Z',
      recordedAt: '2026-05-01T09:00:01.000Z',
    })
    expect(item).not.toHaveProperty('tenantId')
    expect(item).not.toHaveProperty('idempotencyKey')
  })

  it('pages through every row exactly once with the keyset cursor, including recordedAt ties', async () => {
    const tiedAt = new Date(Date.UTC(2026, 4, 2, 0, 0, 0))
    dataset = [
      makeRow(1),
      makeRow(2),
      makeRow(3, { recordedAt: tiedAt }),
      makeRow(4, { recordedAt: tiedAt }),
      makeRow(5, { recordedAt: tiedAt }),
    ]
    const seen: string[] = []
    let cursor: string | null = null
    let pages = 0
    do {
      const query: string = cursor ? `?pageSize=2&cursor=${encodeURIComponent(cursor)}` : '?pageSize=2&includeTotal=true'
      const body = await readJson(await GET(scopedRequest(query)))
      if (pages === 0) expect(body.total).toBe(5)
      seen.push(...(body.items as Row[]).map((item) => String(item.id)))
      cursor = body.nextCursor as string | null
      pages += 1
    } while (cursor && pages < 10)
    expect(pages).toBe(3)
    expect(seen).toEqual([uuidFor(5), uuidFor(4), uuidFor(3), uuidFor(2), uuidFor(1)])
  })

  it('treats an invalid cursor as the first page', async () => {
    dataset = [makeRow(1), makeRow(2)]
    const response = await GET(scopedRequest('?cursor=not-a-valid-cursor'))
    expect(response.status).toBe(200)
    const body = await readJson(response)
    expect((body.items as Row[]).map((item) => item.id)).toEqual([uuidFor(2), uuidFor(1)])
  })

  it('accepts a variantId-only query', async () => {
    const variantId = uuidFor(500)
    dataset = [makeRow(1, { variantId }), makeRow(2)]
    const response = await GET(request(`?variantId=${variantId}`))
    expect(response.status).toBe(200)
    const body = await readJson(response)
    expect((body.items as Row[]).map((item) => item.id)).toEqual([uuidFor(1)])
  })

  it('counts the filtered set independently of the cursor', async () => {
    dataset = [makeRow(1), makeRow(2), makeRow(3)]
    const firstPage = await readJson(await GET(scopedRequest('?pageSize=1&includeTotal=true')))
    const secondPage = await readJson(
      await GET(scopedRequest(`?pageSize=1&includeTotal=true&cursor=${encodeURIComponent(String(firstPage.nextCursor))}`)),
    )
    expect(firstPage.total).toBe(3)
    expect(secondPage.total).toBe(3)
    expect((secondPage.items as Row[]).map((item) => item.id)).toEqual([uuidFor(2)])
  })
})

describe('price history cursor codec', () => {
  it('round-trips a cursor', () => {
    const cursor = { recordedAt: '2026-05-01T09:00:00.456Z', id: uuidFor(7) }
    expect(decodePriceHistoryCursor(encodePriceHistoryCursor(cursor))).toEqual(cursor)
  })

  it.each([
    ['empty', ''],
    ['not base64 json', 'abc'],
    ['missing id', Buffer.from(JSON.stringify({ recordedAt: '2026-05-01T09:00:00.000Z' })).toString('base64')],
    ['non-uuid id', Buffer.from(JSON.stringify({ recordedAt: '2026-05-01T09:00:00.000Z', id: 'h1' })).toString('base64')],
    ['bad date', Buffer.from(JSON.stringify({ recordedAt: 'nope', id: uuidFor(1) })).toString('base64')],
  ])('rejects %s', (_label, value) => {
    expect(decodePriceHistoryCursor(value)).toBeNull()
  })
})
