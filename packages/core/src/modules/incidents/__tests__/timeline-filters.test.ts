const mockCreateRequestContainer = jest.fn()
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => mockCreateRequestContainer(...args),
}))

const mockGetAuthFromRequest = jest.fn()
jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => mockGetAuthFromRequest(...args),
}))

const mockResolveOrganizationScopeForRequest = jest.fn()
jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: (...args: unknown[]) => mockResolveOrganizationScopeForRequest(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

const mockFindOneWithDecryption = jest.fn()
const mockFindWithDecryption = jest.fn()
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
}))

jest.mock('../commands/timeline', () => ({}))

import { GET } from '../api/[id]/timeline/route'

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
const incidentId = '44444444-4444-4444-8444-444444444444'

type TimelineEntryRecord = {
  id: string
  incidentId: string
  kind: string
  actorUserId: string | null
  body: string | null
  visibility: string
  metadata: Record<string, unknown> | null
  createdAt: Date
  organizationId: string
  tenantId: string
}

type MockEntityManager = {
  fork: jest.Mock<MockEntityManager, []>
  count: jest.Mock<Promise<number>, [unknown, Record<string, unknown>]>
}

function makeEntityManager(): MockEntityManager {
  const em = {
    fork: jest.fn<MockEntityManager, []>(),
    count: jest.fn<Promise<number>, [unknown, Record<string, unknown>]>(),
  }
  em.fork.mockReturnValue(em)
  return em
}

function makeTimelineEntry(overrides: Partial<TimelineEntryRecord> = {}): TimelineEntryRecord {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    incidentId,
    kind: 'note',
    actorUserId: null,
    body: 'Timeline entry',
    visibility: 'internal',
    metadata: null,
    createdAt: new Date('2026-07-02T10:00:00.000Z'),
    organizationId,
    tenantId,
    ...overrides,
  }
}

function timelineRequest(query = ''): Request {
  return new Request(`http://localhost/api/incidents/${incidentId}/timeline${query}`)
}

function baseWhere(): Record<string, unknown> {
  return {
    incidentId,
    organizationId,
    tenantId,
  }
}

describe('incidents timeline filters', () => {
  let em: MockEntityManager

  beforeEach(() => {
    jest.clearAllMocks()
    em = makeEntityManager()
    mockCreateRequestContainer.mockResolvedValue({
      resolve: jest.fn((name: string) => {
        if (name === 'em') return em
        throw new Error(`Unexpected dependency: ${name}`)
      }),
    })
    mockGetAuthFromRequest.mockResolvedValue({
      sub: userId,
      tenantId,
      orgId: organizationId,
    })
    mockResolveOrganizationScopeForRequest.mockResolvedValue({
      selectedId: organizationId,
      filterIds: [organizationId],
      allowedIds: [organizationId],
      tenantId,
    })
    mockFindOneWithDecryption.mockResolvedValue({ id: incidentId })
    mockFindWithDecryption.mockResolvedValue([makeTimelineEntry()])
    em.count.mockResolvedValue(1)
  })

  it('parses a kinds CSV and applies it as a shared $in filter', async () => {
    const response = await GET(timelineRequest('?kinds=note,update&page=2&pageSize=10'), { params: { id: incidentId } })

    expect(response.status).toBe(200)
    const expectedWhere = {
      ...baseWhere(),
      kind: { $in: ['note', 'update'] },
    }
    const findWhere = mockFindWithDecryption.mock.calls[0]?.[2]
    const countWhere = em.count.mock.calls[0]?.[1]
    expect(findWhere).toEqual(expectedWhere)
    expect(countWhere).toBe(findWhere)
    expect(mockFindWithDecryption.mock.calls[0]?.[3]).toEqual({
      orderBy: { createdAt: 'desc' },
      limit: 10,
      offset: 10,
    })
  })

  it('rejects an unknown kind with 400', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)

    const response = await GET(timelineRequest('?kinds=note,unknown'), { params: { id: incidentId } })

    consoleErrorSpy.mockRestore()
    expect(response.status).toBe(400)
    expect(mockFindOneWithDecryption).not.toHaveBeenCalled()
    expect(mockFindWithDecryption).not.toHaveBeenCalled()
    expect(em.count).not.toHaveBeenCalled()
  })

  it('applies visibility to the shared timeline where clause', async () => {
    const response = await GET(timelineRequest('?visibility=customer_facing'), { params: { id: incidentId } })

    expect(response.status).toBe(200)
    const expectedWhere = {
      ...baseWhere(),
      visibility: 'customer_facing',
    }
    const findWhere = mockFindWithDecryption.mock.calls[0]?.[2]
    const countWhere = em.count.mock.calls[0]?.[1]
    expect(findWhere).toEqual(expectedWhere)
    expect(countWhere).toBe(findWhere)
  })

  it('keeps the no-filter query unchanged', async () => {
    const response = await GET(timelineRequest(), { params: { id: incidentId } })

    expect(response.status).toBe(200)
    expect(mockFindWithDecryption.mock.calls[0]?.[2]).toEqual(baseWhere())
    expect(mockFindWithDecryption.mock.calls[0]?.[3]).toEqual({
      orderBy: { createdAt: 'desc' },
      limit: 50,
      offset: 0,
    })
    expect(em.count.mock.calls[0]?.[1]).toBe(mockFindWithDecryption.mock.calls[0]?.[2])
  })

  it('returns the filtered count as total', async () => {
    em.count.mockResolvedValueOnce(7)

    const response = await GET(timelineRequest('?kinds=system&visibility=internal'), { params: { id: incidentId } })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      total: 7,
      page: 1,
      pageSize: 50,
    })
    expect(em.count.mock.calls[0]?.[1]).toEqual({
      ...baseWhere(),
      kind: { $in: ['system'] },
      visibility: 'internal',
    })
  })
})
