/** @jest-environment node */

import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { createOptimisticLockGuardService } from '@open-mercato/shared/lib/crud/optimistic-lock'
import { PUT } from '../route'

const TENANT_ID = '123e4567-e89b-12d3-a456-426614174001'
const ORG_ID = '123e4567-e89b-12d3-a456-426614174002'
const DEFINITION_ID = '123e4567-e89b-12d3-a456-426614174070'
const CURRENT_VERSION = '2026-06-01T10:00:00.000Z'
const STALE_VERSION = '2026-06-01T09:00:00.000Z'

const mockGetAuthFromRequest = jest.fn()

const definitionRecord = {
  id: DEFINITION_ID,
  workflowId: 'flow',
  workflowName: 'Flow',
  description: null,
  version: 1,
  definition: { steps: [], transitions: [] },
  metadata: null,
  enabled: true,
  effectiveFrom: null,
  effectiveTo: null,
  tenantId: TENANT_ID,
  organizationId: ORG_ID,
  deletedAt: null,
  updatedAt: new Date(CURRENT_VERSION),
}

const mockEm = {
  findOne: jest.fn(async () => definitionRecord),
  flush: jest.fn(async () => undefined),
}

const mockRbacService = { userHasAllFeatures: jest.fn(async () => true) }

const optimisticLockGuardService = createOptimisticLockGuardService({
  getEm: () => mockEm,
  envValue: 'all',
  readers: {
    'workflows.definition': async () => definitionRecord.updatedAt.toISOString(),
  },
})

const crudMutationGuardService = {
  validateMutation: (input: Parameters<typeof optimisticLockGuardService.validateMutation>[0]) =>
    optimisticLockGuardService.validateMutation(input),
  afterMutationSuccess: jest.fn(async () => undefined),
}

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'em') return mockEm
    if (token === 'rbacService') return mockRbacService
    if (token === 'crudMutationGuardService') return crudMutationGuardService
    if (token === 'eventBus') return null
    return null
  }),
}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn((req: Request) => mockGetAuthFromRequest(req)),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(async () => ({ selectedId: ORG_ID })),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScopeFilter', () => ({
  resolveOrganizationScopeFilter: jest.fn(() => ({ where: { organizationId: ORG_ID } })),
}))

jest.mock('../../../../lib/event-trigger-service', () => ({
  invalidateTriggerCache: jest.fn(),
}))

jest.mock('../../../../lib/code-registry', () => ({
  getCodeWorkflow: jest.fn(() => null),
}))

jest.mock('../../serialize', () => ({
  serializeWorkflowDefinition: (def: { id: string; updatedAt: Date }) => ({
    id: def.id,
    updatedAt: def.updatedAt instanceof Date ? def.updatedAt.toISOString() : def.updatedAt,
  }),
  serializeCodeWorkflowDefinition: jest.fn(),
}))

function request(headerVersion: string | null, body: unknown) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (headerVersion) headers[OPTIMISTIC_LOCK_HEADER_NAME] = headerVersion
  return new Request(`http://localhost/api/workflows/definitions/${DEFINITION_ID}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(body),
  })
}

const context = { params: Promise.resolve({ id: DEFINITION_ID }) }

describe('workflows definition PUT optimistic locking', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetAuthFromRequest.mockResolvedValue({ sub: 'user-1', tenantId: TENANT_ID, orgId: ORG_ID })
    mockEm.findOne.mockResolvedValue(definitionRecord)
  })

  it('returns 409 with the structured conflict body when the expected version is stale', async () => {
    const res = await PUT(request(STALE_VERSION, { workflowName: 'X' }) as never, context as never)
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('optimistic_lock_conflict')
    expect(body.currentUpdatedAt).toBe(CURRENT_VERSION)
    expect(mockEm.flush).not.toHaveBeenCalled()
  })

  it('succeeds when the expected version matches', async () => {
    const res = await PUT(request(CURRENT_VERSION, { workflowName: 'X' }) as never, context as never)
    expect(res.status).toBe(200)
    expect(mockEm.flush).toHaveBeenCalled()
  })

  it('is a no-op (no 409) when the client sends no expected-version header', async () => {
    const res = await PUT(request(null, { workflowName: 'X' }) as never, context as never)
    expect(res.status).toBe(200)
    expect(mockEm.flush).toHaveBeenCalled()
  })
})
