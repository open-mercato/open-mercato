/** @jest-environment node */
import { POST } from '../definitions.batch'

const invalidateDefinitionsCacheMock = jest.fn()

type Where = Record<string, unknown>

const mockEm = {
  begin: jest.fn(async () => {}),
  commit: jest.fn(async () => {}),
  rollback: jest.fn(async () => {}),
  find: jest.fn(async (_entity: unknown, _where: Where) => [] as unknown[]),
  findOne: jest.fn(async () => null),
  create: jest.fn((_entity: unknown, data: Where) => ({ ...data })),
  persist: jest.fn(),
  flush: jest.fn(async () => {}),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({
    resolve: (key: string) => {
      if (key === 'em') return mockEm
      if (key === 'cache') throw new Error('no cache')
      return null
    },
  }),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: async () => ({
    sub: 'user-1',
    tenantId: 'tenant-1',
    orgId: 'org-1',
    roles: ['admin'],
  }),
}))

jest.mock('@open-mercato/core/modules/entities/data/entities', () => ({
  CustomFieldDef: 'CustomFieldDef',
  CustomFieldEntityConfig: 'CustomFieldEntityConfig',
}))

jest.mock('../definitions.cache', () => ({
  invalidateDefinitionsCache: (...args: unknown[]) => invalidateDefinitionsCacheMock(...args),
}))

const makeRequest = (body: unknown) =>
  new Request('http://x/api/entities/definitions/batch', {
    method: 'POST',
    body: JSON.stringify(body),
  })

describe('entities/definitions.batch POST (issue #1399)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockEm.find.mockResolvedValue([] as unknown[])
  })

  it('prefetches existing definitions in one query instead of a lookup per definition', async () => {
    const body = {
      entityId: 'test:entity',
      definitions: [
        { key: 'alpha', kind: 'text' },
        { key: 'beta', kind: 'integer' },
        { key: 'gamma', kind: 'boolean' },
      ],
    }

    const response = await POST(makeRequest(body))

    expect(response.status).toBe(200)
    // Single prefetch keyed by the full set of keys, scoped to tenant/org/entity.
    const defFinds = mockEm.find.mock.calls.filter((call) => call[0] === 'CustomFieldDef')
    expect(defFinds).toHaveLength(1)
    expect(defFinds[0][1]).toMatchObject({
      entityId: 'test:entity',
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      key: { $in: ['alpha', 'beta', 'gamma'] },
    })
    // No per-definition point lookups.
    expect(mockEm.findOne).not.toHaveBeenCalled()
    // All three created (none existed) and flushed once in the transaction.
    expect(mockEm.create).toHaveBeenCalledTimes(3)
    expect(mockEm.flush).toHaveBeenCalledTimes(1)
    expect(mockEm.commit).toHaveBeenCalledTimes(1)
  })

  it('updates a prefetched definition in place rather than re-querying it', async () => {
    const existing = { entityId: 'test:entity', key: 'alpha', kind: 'text', configJson: {}, isActive: true }
    mockEm.find.mockResolvedValueOnce([existing] as unknown[])

    const body = {
      entityId: 'test:entity',
      definitions: [
        { key: 'alpha', kind: 'integer' },
        { key: 'beta', kind: 'text' },
      ],
    }

    const response = await POST(makeRequest(body))

    expect(response.status).toBe(200)
    expect(mockEm.findOne).not.toHaveBeenCalled()
    // Existing 'alpha' mutated in memory; only 'beta' is newly created.
    expect(existing.kind).toBe('integer')
    expect(mockEm.create).toHaveBeenCalledTimes(1)
    expect(mockEm.create.mock.calls[0][1]).toMatchObject({ key: 'beta' })
    expect(mockEm.flush).toHaveBeenCalledTimes(1)
  })
})
