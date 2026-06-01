/** @jest-environment node */

const tenantId = '11111111-1111-4111-8111-111111111111'

const em = {
  find: jest.fn(),
  findAndCount: jest.fn(),
} as { find: jest.Mock; findAndCount: jest.Mock }

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
  getAuthFromRequest: jest.fn(async () => ({ sub: 'user-1', tenantId })),
}))

const loadCustomFieldValues = jest.fn(async () => ({}))
const buildCustomFieldFiltersFromQuery = jest.fn(async () => ({}))

jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({
  loadCustomFieldValues: (...args: unknown[]) => loadCustomFieldValues(...(args as [])),
  buildCustomFieldFiltersFromQuery: (...args: unknown[]) => buildCustomFieldFiltersFromQuery(...(args as [])),
}))

jest.mock('@open-mercato/shared/lib/crud/factory', () => ({
  makeCrudRoute: () => ({ GET: jest.fn(), POST: jest.fn(), PUT: jest.fn(), DELETE: jest.fn() }),
  logCrudAccess: jest.fn(async () => {}),
}))

import { GET } from '../route'

const makeTenant = (i: number, extra: Record<string, unknown> = {}) => ({
  id: `00000000-0000-4000-8000-${i.toString().padStart(12, '0')}`,
  name: `Tenant ${i}`,
  isActive: true,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  ...extra,
})

describe('GET /api/directory/tenants pagination', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    loadCustomFieldValues.mockResolvedValue({})
    buildCustomFieldFiltersFromQuery.mockResolvedValue({})
  })

  it('pushes limit and offset to findAndCount when no custom-field filter is active', async () => {
    em.findAndCount.mockResolvedValue([[makeTenant(1)], 137])
    const res = await GET(new Request('http://localhost/api/directory/tenants?page=3&pageSize=25'))

    expect(em.find).not.toHaveBeenCalled()
    expect(em.findAndCount).toHaveBeenCalledTimes(1)
    const [, , options] = em.findAndCount.mock.calls[0]
    expect(options).toEqual(
      expect.objectContaining({ orderBy: { name: 'ASC' }, limit: 25, offset: 50 }),
    )

    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: unknown[]; total: number; page: number; pageSize: number; totalPages: number }
    expect(body.items).toHaveLength(1)
    expect(body.total).toBe(137)
    expect(body.page).toBe(3)
    expect(body.pageSize).toBe(25)
    expect(body.totalPages).toBe(Math.ceil(137 / 25))
  })

  it('respects sortField + sortDir on the pushed-down query', async () => {
    em.findAndCount.mockResolvedValue([[], 0])
    await GET(new Request('http://localhost/api/directory/tenants?page=1&pageSize=50&sortField=name&sortDir=desc'))
    const options = em.findAndCount.mock.calls[0][2]
    expect(options.orderBy).toEqual({ name: 'DESC' })
    expect(options.limit).toBe(50)
    expect(options.offset).toBe(0)
  })

  it('falls back to fetch-all + JS slice when a custom-field filter must be matched in memory', async () => {
    // Custom-field values live in a separate store and are matched in JS, so the
    // full set must be loaded before filtering — pagination cannot be pushed down.
    buildCustomFieldFiltersFromQuery.mockResolvedValue({ 'cf:tier': { $in: ['gold'] } })
    const gold1 = makeTenant(1)
    const gold2 = makeTenant(2)
    const silver = makeTenant(3)
    em.find.mockResolvedValue([gold1, gold2, silver])
    loadCustomFieldValues.mockResolvedValue({
      [gold1.id]: { cf_tier: 'gold' },
      [gold2.id]: { cf_tier: 'gold' },
      [silver.id]: { cf_tier: 'silver' },
    })

    const res = await GET(new Request('http://localhost/api/directory/tenants?page=1&pageSize=50&cf_tier=gold'))

    expect(em.findAndCount).not.toHaveBeenCalled()
    expect(em.find).toHaveBeenCalledTimes(1)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: { id: string }[]; total: number }
    expect(body.total).toBe(2)
    expect(body.items.map((it) => it.id)).toEqual([gold1.id, gold2.id])
  })
})
