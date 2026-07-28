/**
 * @jest-environment node
 *
 * Follow-up guard for #4425: `customize` materializes a code workflow into a
 * `workflow_definitions` row and `reset-to-code` removes it again, so both
 * endpoints change WHICH source owns the workflow's triggers (code projection ↔
 * embedded DB row). Neither used to invalidate the trigger cache, leaving the
 * wildcard event-trigger subscriber on a stale snapshot for up to
 * TRIGGER_CACHE_TTL — after `reset-to-code` it kept matching the embedded
 * triggers of a row that no longer exists.
 */

const TENANT_ID = '123e4567-e89b-12d3-a456-426614174001'
const ORG_ID = '123e4567-e89b-12d3-a456-426614174002'
const DEFINITION_ID = '123e4567-e89b-12d3-a456-426614174070'
const WORKFLOW_ID = 'sales.order-approval'

const mockGetAuthFromRequest = jest.fn()

const codeDefinition = {
  workflowId: WORKFLOW_ID,
  workflowName: 'Order Approval',
  description: null,
  version: 1,
  enabled: true,
  metadata: null,
  definition: { steps: [], transitions: [], triggers: [] },
}

const overrideRecord = {
  id: DEFINITION_ID,
  workflowId: WORKFLOW_ID,
  codeWorkflowId: WORKFLOW_ID,
  tenantId: TENANT_ID,
  organizationId: ORG_ID,
  deletedAt: null,
  updatedAt: new Date('2026-06-01T10:00:00.000Z'),
}

const mockEm = {
  findOne: jest.fn(async () => null as unknown),
  create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({ ...data, id: DEFINITION_ID })),
  persist: jest.fn(),
  remove: jest.fn(),
  count: jest.fn(async () => 0),
  flush: jest.fn(async () => undefined),
}

const mockRbacService = { userHasAllFeatures: jest.fn(async () => true) }

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'em') return mockEm
    if (token === 'rbacService') return mockRbacService
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

jest.mock('@open-mercato/shared/lib/crud/mutation-guard', () => ({
  validateCrudMutationGuard: jest.fn(async () => null),
  runCrudMutationGuardAfterSuccess: jest.fn(async () => undefined),
}))

jest.mock('../../../../lib/event-trigger-service', () => ({
  invalidateTriggerCache: jest.fn(),
}))

jest.mock('../../../../lib/code-registry', () => ({
  getCodeWorkflow: jest.fn(() => codeDefinition),
}))

jest.mock('../../serialize', () => ({
  serializeWorkflowDefinition: (def: { id: string }) => ({ id: def.id }),
  serializeCodeWorkflowDefinition: (def: { workflowId: string }, id: string) => ({
    id,
    workflowId: def.workflowId,
  }),
}))

import { invalidateTriggerCache } from '../../../../lib/event-trigger-service'
import { POST as customize } from '../customize/route'
import { POST as resetToCode } from '../reset-to-code/route'

const mockInvalidateTriggerCache = invalidateTriggerCache as jest.MockedFunction<
  typeof invalidateTriggerCache
>

function request(path: string) {
  return new Request(`http://localhost/api/workflows/definitions/${path}`, { method: 'POST' })
}

describe('workflows definition customize/reset-to-code trigger cache invalidation', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetAuthFromRequest.mockResolvedValue({ sub: 'user-1', tenantId: TENANT_ID, orgId: ORG_ID })
    mockEm.findOne.mockResolvedValue(null)
    mockEm.count.mockResolvedValue(0)
  })

  it('invalidates the trigger cache when customize creates the override row', async () => {
    const context = { params: Promise.resolve({ id: `code:${WORKFLOW_ID}` }) }
    const res = await customize(request(`code:${WORKFLOW_ID}/customize`) as never, context as never)

    expect(res.status).toBe(200)
    expect(mockEm.flush).toHaveBeenCalled()
    expect(mockInvalidateTriggerCache).toHaveBeenCalledWith(TENANT_ID, ORG_ID)
  })

  it('invalidates the trigger cache when customize refreshes an existing override row', async () => {
    mockEm.findOne.mockResolvedValue({ ...overrideRecord })
    const context = { params: Promise.resolve({ id: `code:${WORKFLOW_ID}` }) }
    const res = await customize(request(`code:${WORKFLOW_ID}/customize`) as never, context as never)

    expect(res.status).toBe(200)
    expect(mockInvalidateTriggerCache).toHaveBeenCalledWith(TENANT_ID, ORG_ID)
  })

  it('invalidates for the revived row\'s own organization, not the caller\'s', async () => {
    const siblingOrgId = '123e4567-e89b-12d3-a456-426614174003'
    mockEm.findOne.mockResolvedValue({ ...overrideRecord, organizationId: siblingOrgId })
    const context = { params: Promise.resolve({ id: `code:${WORKFLOW_ID}` }) }
    const res = await customize(request(`code:${WORKFLOW_ID}/customize`) as never, context as never)

    expect(res.status).toBe(200)
    expect(mockInvalidateTriggerCache).toHaveBeenCalledWith(TENANT_ID, siblingOrgId)
  })

  it('invalidates the trigger cache when reset-to-code removes the override row', async () => {
    mockEm.findOne.mockResolvedValue({ ...overrideRecord })
    const context = { params: Promise.resolve({ id: DEFINITION_ID }) }
    const res = await resetToCode(request(`${DEFINITION_ID}/reset-to-code`) as never, context as never)

    expect(res.status).toBe(200)
    expect(mockEm.remove).toHaveBeenCalled()
    expect(mockInvalidateTriggerCache).toHaveBeenCalledWith(TENANT_ID, ORG_ID)
  })

  it('leaves the trigger cache alone when reset-to-code is rejected for active instances', async () => {
    mockEm.findOne.mockResolvedValue({ ...overrideRecord })
    mockEm.count.mockResolvedValue(2)
    const context = { params: Promise.resolve({ id: DEFINITION_ID }) }
    const res = await resetToCode(request(`${DEFINITION_ID}/reset-to-code`) as never, context as never)

    expect(res.status).toBe(409)
    expect(mockEm.remove).not.toHaveBeenCalled()
    expect(mockInvalidateTriggerCache).not.toHaveBeenCalled()
  })
})
