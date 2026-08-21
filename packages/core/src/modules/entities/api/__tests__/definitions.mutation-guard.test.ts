/** @jest-environment node */

const validateCrudMutationGuardMock = jest.fn()
const runCrudMutationGuardAfterSuccessMock = jest.fn()

type Where = Record<string, unknown>

const mockEm = {
  begin: jest.fn(async () => {}),
  commit: jest.fn(async () => {}),
  rollback: jest.fn(async () => {}),
  find: jest.fn(async (_entity: unknown, _where: Where) => [] as unknown[]),
  findOne: jest.fn(async () => null),
  create: jest.fn((_entity: unknown, data: Where) => ({ id: 'created-id', ...data })),
  persist: jest.fn(),
  flush: jest.fn(async () => {}),
}

const mockCache = {
  get: jest.fn(async () => null),
  set: jest.fn(async () => undefined),
  deleteByTags: jest.fn(async () => undefined),
}

const container = {
  resolve: (key: string) => {
    if (key === 'em') return mockEm
    if (key === 'cache') return mockCache
    return null
  },
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => container,
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: async () => ({
    sub: 'user-1',
    userId: 'user-1',
    tenantId: 'tenant-1',
    orgId: 'org-1',
    roles: ['admin'],
  }),
}))

jest.mock('@open-mercato/shared/lib/crud/mutation-guard', () => ({
  validateCrudMutationGuard: (...args: unknown[]) => validateCrudMutationGuardMock(...args),
  runCrudMutationGuardAfterSuccess: (...args: unknown[]) => runCrudMutationGuardAfterSuccessMock(...args),
}))

jest.mock('@open-mercato/core/modules/entities/data/entities', () => ({
  CustomEntity: 'CustomEntity',
  CustomFieldDef: 'CustomFieldDef',
  CustomFieldEntityConfig: 'CustomFieldEntityConfig',
}))

jest.mock('@open-mercato/shared/lib/encryption/entityIds', () => ({
  getEntityIds: () => ({}),
}))

jest.mock('@open-mercato/shared/lib/entities/system-entities', () => ({
  isSystemEntitySelectable: () => true,
  filterSelectableSystemEntityIds: (ids: string[]) => ids,
}))

jest.mock('@open-mercato/shared/lib/data/engine', () => ({
  SYSTEM_ENTITY_RECORDS_BLOCKED_CODE: 'SYSTEM_ENTITY_RECORDS_BLOCKED',
  isOrmBackedSystemEntityId: () => false,
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: async () => ({ tenantId: 'tenant-1', selectedId: 'org-1' }),
}))

jest.mock('../definitions.cache', () => ({
  invalidateDefinitionsCache: jest.fn(async () => undefined),
  createDefinitionsCacheKey: () => 'key',
  createDefinitionsCacheTags: () => [],
  ENTITY_DEFINITIONS_CACHE_TTL_MS: 1000,
}))

jest.mock('../../lib/fieldsets', () => ({
  loadEntityFieldsetConfigs: async () => new Map(),
  CustomFieldsetDefinition: class {},
  mergeEntityFieldsetConfig: (existing: unknown) => existing,
  normalizeEntityFieldsetConfig: () => ({ fieldsets: [], singleFieldsetPerRecord: true }),
}))

jest.mock('../../lib/install-from-ce', () => ({
  installCustomEntitiesFromModules: async () => ({}),
}))

import { POST as ENTITIES_POST, DELETE as ENTITIES_DELETE } from '../entities'
import { POST as DEFINITIONS_POST, DELETE as DEFINITIONS_DELETE } from '../definitions'
import { POST as DEFINITIONS_BATCH_POST } from '../definitions.batch'
import { POST as DEFINITIONS_RESTORE_POST } from '../definitions.restore'

const allow = () => validateCrudMutationGuardMock.mockResolvedValue({ ok: true, shouldRunAfterSuccess: true, metadata: { token: 'guard' } })
const block = () => validateCrudMutationGuardMock.mockResolvedValue({ ok: false, status: 423, body: { error: 'blocked by guard' } })

const jsonRequest = (url: string, method: string, body: unknown) =>
  new Request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

describe('entities write routes — mutation guard lifecycle (issue #3226)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockEm.find.mockResolvedValue([] as unknown[])
    mockEm.findOne.mockResolvedValue(null)
    runCrudMutationGuardAfterSuccessMock.mockResolvedValue(undefined)
  })

  describe('POST /api/entities/entities', () => {
    const body = { entityId: 'mod:thing', label: 'Thing' }

    it('blocks persistence when the guard rejects the mutation', async () => {
      block()
      const response = await ENTITIES_POST(jsonRequest('http://x/api/entities/entities', 'POST', body))
      expect(response.status).toBe(423)
      expect(validateCrudMutationGuardMock).toHaveBeenCalledWith(
        container,
        expect.objectContaining({ resourceKind: 'entities.entity', operation: 'create', tenantId: 'tenant-1' }),
      )
      expect(mockEm.flush).not.toHaveBeenCalled()
      expect(runCrudMutationGuardAfterSuccessMock).not.toHaveBeenCalled()
    })

    it('runs the after-success hook once the write succeeds', async () => {
      allow()
      const response = await ENTITIES_POST(jsonRequest('http://x/api/entities/entities', 'POST', body))
      expect(response.status).toBe(200)
      expect(mockEm.flush).toHaveBeenCalled()
      expect(runCrudMutationGuardAfterSuccessMock).toHaveBeenCalledWith(
        container,
        expect.objectContaining({ resourceKind: 'entities.entity', operation: 'create' }),
      )
    })
  })

  describe('DELETE /api/entities/entities', () => {
    const body = { entityId: 'mod:thing' }

    it('blocks deletion when the guard rejects the mutation', async () => {
      block()
      mockEm.findOne.mockResolvedValue({ id: 'ent-1', updatedAt: new Date() })
      const response = await ENTITIES_DELETE(jsonRequest('http://x/api/entities/entities', 'DELETE', body))
      expect(response.status).toBe(423)
      expect(validateCrudMutationGuardMock).toHaveBeenCalledWith(
        container,
        expect.objectContaining({ resourceKind: 'entities.entity', operation: 'delete' }),
      )
      expect(mockEm.flush).not.toHaveBeenCalled()
    })

    it('runs the after-success hook once the soft delete succeeds', async () => {
      allow()
      mockEm.findOne.mockResolvedValue({ id: 'ent-1', updatedAt: new Date() })
      const response = await ENTITIES_DELETE(jsonRequest('http://x/api/entities/entities', 'DELETE', body))
      expect(response.status).toBe(200)
      expect(mockEm.flush).toHaveBeenCalled()
      expect(runCrudMutationGuardAfterSuccessMock).toHaveBeenCalled()
    })
  })

  describe('POST /api/entities/definitions', () => {
    const body = { entityId: 'mod:thing', key: 'color', kind: 'text', configJson: { label: 'Color' } }

    it('blocks persistence when the guard rejects the mutation', async () => {
      block()
      const response = await DEFINITIONS_POST(jsonRequest('http://x/api/entities/definitions', 'POST', body))
      expect(response.status).toBe(423)
      expect(validateCrudMutationGuardMock).toHaveBeenCalledWith(
        container,
        expect.objectContaining({ resourceKind: 'entities.field_definition', operation: 'create' }),
      )
      expect(mockEm.flush).not.toHaveBeenCalled()
    })

    it('runs the after-success hook once the write succeeds', async () => {
      allow()
      const response = await DEFINITIONS_POST(jsonRequest('http://x/api/entities/definitions', 'POST', body))
      expect(response.status).toBe(200)
      expect(mockEm.flush).toHaveBeenCalled()
      expect(runCrudMutationGuardAfterSuccessMock).toHaveBeenCalled()
    })
  })

  describe('DELETE /api/entities/definitions', () => {
    const body = { entityId: 'mod:thing', key: 'color' }

    it('blocks deletion when the guard rejects the mutation', async () => {
      block()
      mockEm.findOne.mockResolvedValue({ id: 'def-1', updatedAt: new Date() })
      const response = await DEFINITIONS_DELETE(jsonRequest('http://x/api/entities/definitions', 'DELETE', body))
      expect(response.status).toBe(423)
      expect(mockEm.flush).not.toHaveBeenCalled()
    })

    it('runs the after-success hook once the soft delete succeeds', async () => {
      allow()
      mockEm.findOne.mockResolvedValue({ id: 'def-1', updatedAt: new Date() })
      const response = await DEFINITIONS_DELETE(jsonRequest('http://x/api/entities/definitions', 'DELETE', body))
      expect(response.status).toBe(200)
      expect(runCrudMutationGuardAfterSuccessMock).toHaveBeenCalled()
    })
  })

  describe('POST /api/entities/definitions/batch', () => {
    const body = { entityId: 'mod:thing', definitions: [{ key: 'color', kind: 'text' }] }

    it('blocks the batch before opening a transaction when the guard rejects', async () => {
      block()
      const response = await DEFINITIONS_BATCH_POST(jsonRequest('http://x/api/entities/definitions/batch', 'POST', body))
      expect(response.status).toBe(423)
      expect(validateCrudMutationGuardMock).toHaveBeenCalledWith(
        container,
        expect.objectContaining({ resourceKind: 'entities.field_definition', operation: 'custom' }),
      )
      expect(mockEm.begin).not.toHaveBeenCalled()
      expect(mockEm.flush).not.toHaveBeenCalled()
    })

    it('runs the after-success hook once the batch commits', async () => {
      allow()
      const response = await DEFINITIONS_BATCH_POST(jsonRequest('http://x/api/entities/definitions/batch', 'POST', body))
      expect(response.status).toBe(200)
      expect(mockEm.commit).toHaveBeenCalled()
      expect(runCrudMutationGuardAfterSuccessMock).toHaveBeenCalled()
    })
  })

  describe('POST /api/entities/definitions/restore', () => {
    const body = { entityId: 'mod:thing', key: 'color' }

    it('blocks the restore when the guard rejects the mutation', async () => {
      block()
      mockEm.findOne.mockResolvedValue({ id: 'def-1', updatedAt: new Date() })
      const response = await DEFINITIONS_RESTORE_POST(jsonRequest('http://x/api/entities/definitions/restore', 'POST', body))
      expect(response.status).toBe(423)
      expect(mockEm.flush).not.toHaveBeenCalled()
    })

    it('runs the after-success hook once the restore succeeds', async () => {
      allow()
      mockEm.findOne.mockResolvedValue({ id: 'def-1', updatedAt: new Date() })
      const response = await DEFINITIONS_RESTORE_POST(jsonRequest('http://x/api/entities/definitions/restore', 'POST', body))
      expect(response.status).toBe(200)
      expect(runCrudMutationGuardAfterSuccessMock).toHaveBeenCalled()
    })
  })
})
