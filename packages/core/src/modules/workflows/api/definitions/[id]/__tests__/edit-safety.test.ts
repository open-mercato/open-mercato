/** @jest-environment node */

import { PUT } from '../route'
import { PUT as putDraft } from '../draft/route'
import { WorkflowDefinition, WorkflowDefinitionDraft, WorkflowInstance } from '../../../../data/entities'
import { STRUCTURAL_EDIT_CONFLICT_CODE } from '../../../../lib/definition-edit-safety'

const TENANT_ID = '123e4567-e89b-12d3-a456-426614174001'
const ORG_ID = '123e4567-e89b-12d3-a456-426614174002'
const DEFINITION_ID = '123e4567-e89b-12d3-a456-426614174070'

const storedDefinition = {
  steps: [
    { stepId: 'start', stepName: 'Start', stepType: 'START' },
    { stepId: 'review', stepName: 'Review', stepType: 'USER_TASK' },
    { stepId: 'end', stepName: 'End', stepType: 'END' },
  ],
  transitions: [
    { transitionId: 't_a', fromStepId: 'start', toStepId: 'review', trigger: 'auto' },
    { transitionId: 't_b', fromStepId: 'review', toStepId: 'end', trigger: 'auto' },
  ],
}

function cloneStored(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(storedDefinition)) as Record<string, unknown>
}

/** Re-points `t_a` at the END step — the exact edit the rule must refuse. */
function retargetedDefinition(): Record<string, unknown> {
  const next = cloneStored()
  ;(next.transitions as Array<Record<string, unknown>>)[0].toStepId = 'end'
  return next
}

/** Renames a step — cosmetic, must always save in place. */
function renamedDefinition(): Record<string, unknown> {
  const next = cloneStored()
  ;(next.steps as Array<Record<string, unknown>>)[1].stepName = 'Manager review'
  return next
}

let definitionRecord: Record<string, unknown>
let activeInstanceCount = 0
let countCalls: Array<Record<string, unknown>> = []
let draftRecords: Array<Record<string, unknown>> = []

const mockGetAuthFromRequest = jest.fn()

const mockEm = {
  findOne: jest.fn(async (entity: unknown) => {
    if (entity === WorkflowDefinition) return definitionRecord
    if (entity === WorkflowDefinitionDraft) return draftRecords[0] ?? null
    return null
  }),
  count: jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
    if (entity !== WorkflowInstance) return 0
    countCalls.push(where)
    return activeInstanceCount
  }),
  create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({ id: 'draft-1', ...data })),
  persist: jest.fn((entity: Record<string, unknown>) => {
    draftRecords.push(entity)
    return entity
  }),
  flush: jest.fn(async () => undefined),
}

const mockRbacService = { userHasAllFeatures: jest.fn(async () => true) }

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'em') return mockEm
    if (token === 'rbacService') return mockRbacService
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
  serializeWorkflowDefinition: (def: { id: string }) => ({ id: def.id }),
  serializeCodeWorkflowDefinition: jest.fn(),
}))

function definitionRequest(body: unknown) {
  return new Request(`http://localhost/api/workflows/definitions/${DEFINITION_ID}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function draftRequest(body: unknown) {
  return new Request(`http://localhost/api/workflows/definitions/${DEFINITION_ID}/draft`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const context = { params: Promise.resolve({ id: DEFINITION_ID }) }

describe('workflows definition PUT edit-safety rule', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    activeInstanceCount = 0
    countCalls = []
    draftRecords = []
    definitionRecord = {
      id: DEFINITION_ID,
      workflowId: 'flow',
      workflowName: 'Flow',
      description: null,
      version: 1,
      definition: cloneStored(),
      metadata: null,
      enabled: true,
      effectiveFrom: null,
      effectiveTo: null,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      deletedAt: null,
      updatedAt: new Date('2026-06-01T10:00:00.000Z'),
    }
    mockGetAuthFromRequest.mockResolvedValue({ sub: 'user-1', tenantId: TENANT_ID, orgId: ORG_ID })
  })

  it('refuses a structural edit while instances are still running', async () => {
    activeInstanceCount = 3

    const res = await PUT(definitionRequest({ definition: retargetedDefinition() }) as never, context as never)

    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe(STRUCTURAL_EDIT_CONFLICT_CODE)
    expect(body.activeInstanceCount).toBe(3)
    expect(body.changes).toEqual([{ kind: 'transitionRetargeted', id: 't_a' }])
    expect(body.remedy).toEqual({
      action: 'createVersion',
      method: 'POST',
      endpoint: `/api/workflows/definitions/${DEFINITION_ID}/publish`,
    })
    expect(mockEm.flush).not.toHaveBeenCalled()
    expect((definitionRecord.definition as { transitions: Array<{ toStepId: string }> }).transitions[0].toStepId)
      .toBe('review')
  })

  it('counts only tenant-scoped, non-deleted instances in executing statuses', async () => {
    activeInstanceCount = 1

    await PUT(definitionRequest({ definition: retargetedDefinition() }) as never, context as never)

    expect(countCalls).toHaveLength(1)
    expect(countCalls[0]).toMatchObject({
      definitionId: DEFINITION_ID,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      deletedAt: null,
    })
    expect(countCalls[0].status).toEqual({
      $in: ['RUNNING', 'PAUSED', 'WAITING_FOR_ACTIVITIES', 'FORKED', 'COMPENSATING'],
    })
  })

  it('applies the same structural edit in place when nothing is running', async () => {
    activeInstanceCount = 0

    const res = await PUT(definitionRequest({ definition: retargetedDefinition() }) as never, context as never)

    expect(res.status).toBe(200)
    expect(mockEm.flush).toHaveBeenCalled()
    expect((definitionRecord.definition as { transitions: Array<{ toStepId: string }> }).transitions[0].toStepId)
      .toBe('end')
  })

  it('lets cosmetic edits through while instances are running', async () => {
    activeInstanceCount = 5

    const res = await PUT(definitionRequest({ definition: renamedDefinition() }) as never, context as never)

    expect(res.status).toBe(200)
    expect(mockEm.count).not.toHaveBeenCalled()
    expect((definitionRecord.definition as { steps: Array<{ stepName: string }> }).steps[1].stepName)
      .toBe('Manager review')
  })

  it('lets metadata-only edits through while instances are running', async () => {
    activeInstanceCount = 5

    const res = await PUT(
      definitionRequest({ workflowName: 'Renamed flow', metadata: { editor: { samples: {} } } }) as never,
      context as never,
    )

    expect(res.status).toBe(200)
    expect(mockEm.count).not.toHaveBeenCalled()
    expect(definitionRecord.workflowName).toBe('Renamed flow')
  })

  it('never blocks per-user draft autosave, structural or not', async () => {
    activeInstanceCount = 7

    const res = await putDraft(
      draftRequest({ definition: retargetedDefinition(), baseUpdatedAt: '2026-06-01T10:00:00.000Z' }) as never,
      context as never,
    )

    expect(res.status).toBe(200)
    expect(mockEm.count).not.toHaveBeenCalled()
    expect((definitionRecord.definition as { transitions: Array<{ toStepId: string }> }).transitions[0].toStepId)
      .toBe('review')
  })
})
