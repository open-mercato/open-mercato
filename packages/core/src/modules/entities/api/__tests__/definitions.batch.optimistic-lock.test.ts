/** @jest-environment node */
import { POST } from '../definitions.batch'
import {
  OPTIMISTIC_LOCK_CONFLICT_CODE,
  OPTIMISTIC_LOCK_HEADER_NAME,
} from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

/**
 * Optimistic locking for the entity definition edit form (issue #3152).
 *
 * The batch endpoint upserts a whole definition set, so two tabs saving the same
 * entity used to silently overwrite each other. It now compares the client-sent
 * expected schema version against the current aggregate version and returns the
 * shared structured 409 on mismatch — while staying strictly additive for
 * callers that do not send the header.
 */

const invalidateDefinitionsCacheMock = jest.fn()
const resolveVersionMock = jest.fn(async () => '2026-06-01T00:00:00.000Z')

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

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: async () => ({ tenantId: 'tenant-1', selectedId: 'org-1' }),
}))

jest.mock('@open-mercato/core/modules/entities/data/entities', () => ({
  CustomFieldDef: 'CustomFieldDef',
  CustomFieldEntityConfig: 'CustomFieldEntityConfig',
}))

jest.mock('../definitions.cache', () => ({
  invalidateDefinitionsCache: (...args: unknown[]) => invalidateDefinitionsCacheMock(...args),
}))

jest.mock('../../lib/definitions-version', () => ({
  resolveEntityDefinitionsVersion: (...args: unknown[]) => resolveVersionMock(...args),
}))

const makeRequest = (body: unknown, headers?: Record<string, string>) =>
  new Request('http://x/api/entities/definitions/batch', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(headers ?? {}) },
    body: JSON.stringify(body),
  })

const body = { entityId: 'test:entity', definitions: [{ key: 'alpha', kind: 'text' }] }

describe('entities/definitions.batch POST optimistic locking (issue #3152)', () => {
  let previousEnv: string | undefined

  beforeAll(() => {
    previousEnv = process.env.OM_OPTIMISTIC_LOCK
    process.env.OM_OPTIMISTIC_LOCK = 'all'
  })

  afterAll(() => {
    if (previousEnv === undefined) delete process.env.OM_OPTIMISTIC_LOCK
    else process.env.OM_OPTIMISTIC_LOCK = previousEnv
  })

  beforeEach(() => {
    jest.clearAllMocks()
    mockEm.find.mockResolvedValue([] as unknown[])
    resolveVersionMock.mockResolvedValue('2026-06-01T00:00:00.000Z')
  })

  it('rejects a stale save with a structured 409 before touching the transaction', async () => {
    // Client loaded an older version than the current aggregate version.
    const response = await POST(
      makeRequest(body, { [OPTIMISTIC_LOCK_HEADER_NAME]: '2026-01-01T00:00:00.000Z' }),
    )

    expect(response.status).toBe(409)
    const json = (await response.json()) as { code?: string }
    expect(json.code).toBe(OPTIMISTIC_LOCK_CONFLICT_CODE)
    // Conflict is detected before any write work.
    expect(mockEm.begin).not.toHaveBeenCalled()
    expect(mockEm.persist).not.toHaveBeenCalled()
    expect(mockEm.commit).not.toHaveBeenCalled()
  })

  it('saves and returns the fresh version when the expected version matches', async () => {
    const response = await POST(
      makeRequest(body, { [OPTIMISTIC_LOCK_HEADER_NAME]: '2026-06-01T00:00:00.000Z' }),
    )

    expect(response.status).toBe(200)
    const json = (await response.json()) as { ok?: boolean; version?: string | null }
    expect(json.ok).toBe(true)
    expect(json.version).toBe('2026-06-01T00:00:00.000Z')
    expect(mockEm.commit).toHaveBeenCalledTimes(1)
  })

  it('stays additive: a save without the header proceeds unchanged', async () => {
    const response = await POST(makeRequest(body))

    expect(response.status).toBe(200)
    expect(mockEm.commit).toHaveBeenCalledTimes(1)
  })

  it('does not lock when there is no current version (empty schema edge case)', async () => {
    resolveVersionMock.mockResolvedValue(null as unknown as string)

    const response = await POST(
      makeRequest(body, { [OPTIMISTIC_LOCK_HEADER_NAME]: '2026-01-01T00:00:00.000Z' }),
    )

    expect(response.status).toBe(200)
    expect(mockEm.commit).toHaveBeenCalledTimes(1)
  })
})
