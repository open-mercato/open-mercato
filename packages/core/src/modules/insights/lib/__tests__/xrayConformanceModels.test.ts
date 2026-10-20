const findWithDecryptionMock = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => findWithDecryptionMock(...args),
  findOneWithDecryption: jest.fn(),
}))

import { buildWorkflowConformanceModel, workflowModelKey } from '../analytics/workflowModel'
import { redactXrayConformanceSources, resolveDisclosableXrayModelKeys, resolveXrayConformanceModels } from '../xrayConformanceModels'
import type { ConformanceResult } from '../analytics/types'
import { WORKFLOW_DRAFT_SERVICE_KEY, resolveWorkflowDraftService, type XrayWorkflowDefinitionShape } from '../workflowsBridge'

const TENANT_ID = '11111111-0000-4000-8000-000000000001'
const ORG_A = '22222222-0000-4000-8000-00000000000a'
const ORG_B = '22222222-0000-4000-8000-00000000000b'
const DEFINITION_A = '55555555-0000-4000-8000-00000000000a'
const DEFINITION_B = '55555555-0000-4000-8000-00000000000b'

function definition(id: string, overrides: Partial<XrayWorkflowDefinitionShape> = {}): XrayWorkflowDefinitionShape {
  return {
    id,
    workflowId: 'deals.flow',
    version: 3,
    enabled: true,
    steps: [
      { stepId: 'start', stepType: 'START' },
      { stepId: 'qualify', stepType: 'USER_TASK' },
      { stepId: 'route', stepType: 'IF_ELSE' },
      { stepId: 'won', stepType: 'AUTOMATED' },
      { stepId: 'lost', stepType: 'AUTOMATED' },
      { stepId: 'notify', stepType: 'AUTOMATED' },
      { stepId: 'end', stepType: 'END' },
    ],
    transitions: [
      { fromStepId: 'start', toStepId: 'qualify', kind: null },
      { fromStepId: 'qualify', toStepId: 'route', kind: null },
      { fromStepId: 'route', toStepId: 'won', kind: null },
      { fromStepId: 'route', toStepId: 'lost', kind: null },
      { fromStepId: 'won', toStepId: 'notify', kind: null },
      { fromStepId: 'notify', toStepId: 'end', kind: null },
      { fromStepId: 'lost', toStepId: 'end', kind: null },
      { fromStepId: 'lost', toStepId: 'qualify', kind: 'error' },
      { fromStepId: 'qualify', toStepId: 'qualify', kind: null },
    ],
    ...overrides,
  }
}

const STEP_MAP = { 'status:open': 'qualify', 'status:won': 'won', 'status:lost': 'lost', 'status:ghost': 'missing-step' }

describe('buildWorkflowConformanceModel', () => {
  it('projects the workflow onto the mapped steps, passing through unmapped steps and ignoring error routes', () => {
    const model = buildWorkflowConformanceModel(definition(DEFINITION_A), STEP_MAP)
    expect(model).toEqual({
      key: workflowModelKey(DEFINITION_A),
      source: { kind: 'workflow', definitionId: DEFINITION_A, version: 3 },
      steps: ['lost', 'qualify', 'won'],
      transitions: [['qualify', 'lost'], ['qualify', 'qualify'], ['qualify', 'won']],
      startSteps: ['qualify'],
      endSteps: ['lost', 'won'],
      activityStepMap: { 'status:lost': 'lost', 'status:open': 'qualify', 'status:won': 'won' },
    })
  })

  it('keeps every step when no map entry is usable (the coverage check then refuses) and rejects step-less definitions', () => {
    const unmapped = buildWorkflowConformanceModel(definition(DEFINITION_A), { 'status:open': 'nowhere' })
    expect(unmapped?.steps).toEqual(['lost', 'notify', 'qualify', 'route', 'won'])
    expect(unmapped?.activityStepMap).toEqual({})
    expect(buildWorkflowConformanceModel(definition(DEFINITION_A, {
      steps: [{ stepId: 'start', stepType: 'START' }, { stepId: 'end', stepType: 'END' }],
      transitions: [{ fromStepId: 'start', toStepId: 'end', kind: null }],
    }), STEP_MAP)).toBeNull()
    expect(buildWorkflowConformanceModel(definition(DEFINITION_A, {
      transitions: [{ fromStepId: 'qualify', toStepId: 'won', kind: null }],
    }), STEP_MAP)).toBeNull()
  })
})

describe('resolveXrayConformanceModels', () => {
  const service = { validateDraftDefinition: jest.fn(), getDefinitionForScope: jest.fn() }
  const containerWith = (draftService: unknown) => ({
    resolve: (name: string): unknown => {
      if (name === 'em') return { fork: () => ({ kind: 'em' }) }
      if (name === WORKFLOW_DRAFT_SERVICE_KEY && draftService) return draftService
      throw new Error(`[internal] unexpected service ${name}`)
    },
  })

  beforeEach(() => {
    findWithDecryptionMock.mockReset()
    service.getDefinitionForScope.mockReset()
  })

  it('resolves each organization\'s workflow scoped to the tenant and that organization', async () => {
    findWithDecryptionMock.mockResolvedValue([
      { tenantId: TENANT_ID, organizationId: ORG_A, conformanceWorkflowId: DEFINITION_A, activityStepMap: STEP_MAP },
      { tenantId: TENANT_ID, organizationId: ORG_B, conformanceWorkflowId: DEFINITION_B, activityStepMap: STEP_MAP },
    ])
    service.getDefinitionForScope.mockImplementation(async (id: string, scope: { organizationId: string }) =>
      id === DEFINITION_A && scope.organizationId === ORG_A ? definition(DEFINITION_A) : null)
    const outcome = await resolveXrayConformanceModels(containerWith(service), { tenantId: TENANT_ID, organizationIds: [ORG_A, ORG_B] })
    expect(findWithDecryptionMock).toHaveBeenCalledWith(
      { kind: 'em' },
      expect.anything(),
      { tenantId: TENANT_ID, enabled: true, deletedAt: null, conformanceWorkflowId: { $ne: null }, organizationId: { $in: [ORG_A, ORG_B] } },
      { orderBy: { organizationId: 'asc' }, limit: 21 },
      { tenantId: TENANT_ID },
    )
    expect(service.getDefinitionForScope.mock.calls).toEqual([
      [DEFINITION_A, { tenantId: TENANT_ID, organizationId: ORG_A }],
      [DEFINITION_B, { tenantId: TENANT_ID, organizationId: ORG_B }],
    ])
    expect(outcome).toEqual({ ok: true, models: [expect.objectContaining({ key: workflowModelKey(DEFINITION_A) })], organizationModelKeys: { [ORG_A]: workflowModelKey(DEFINITION_A) } })
  })

  it('reads the whole tenant for a tenant-wide caller and refuses without models, the workflows module or too many organizations', async () => {
    findWithDecryptionMock.mockResolvedValueOnce([])
    expect(await resolveXrayConformanceModels(containerWith(service), { tenantId: TENANT_ID, organizationIds: null })).toEqual({ ok: false, code: 'conformance_model_missing' })
    expect(findWithDecryptionMock.mock.calls[0][2]).not.toHaveProperty('organizationId')
    expect(await resolveXrayConformanceModels(containerWith(null), { tenantId: TENANT_ID, organizationIds: [ORG_A] })).toEqual({ ok: false, code: 'workflows_unavailable' })
    expect(await resolveXrayConformanceModels(containerWith(service), { tenantId: TENANT_ID, organizationIds: [] })).toEqual({ ok: false, code: 'conformance_model_missing' })
    findWithDecryptionMock.mockResolvedValueOnce(Array.from({ length: 21 }, () => ({ tenantId: TENANT_ID, organizationId: ORG_A, conformanceWorkflowId: DEFINITION_A })))
    expect(await resolveXrayConformanceModels(containerWith(service), { tenantId: TENANT_ID, organizationIds: null })).toEqual({ ok: false, code: 'too_many_models' })
  })
})

describe('resolveWorkflowDraftService', () => {
  it('resolves the service softly and refuses anything that is not one', () => {
    const service = { validateDraftDefinition: async () => ({ ok: false, issues: [] }), getDefinitionForScope: async () => null }
    expect(resolveWorkflowDraftService({ resolve: () => service })).toBe(service)
    expect(resolveWorkflowDraftService({ resolve: () => ({ validateDraftDefinition: 1 }) })).toBeNull()
    expect(resolveWorkflowDraftService({ resolve: () => { throw new Error('missing') } })).toBeNull()
    expect(resolveWorkflowDraftService({ resolve: () => service, hasRegistration: () => false })).toBeNull()
  })
})

describe('conformance workflow identity', () => {
  const keyA = workflowModelKey(DEFINITION_A)
  const keyB = workflowModelKey(DEFINITION_B)

  it('discloses a model only when the caller holds workflows.definitions.view in every organization that configured it', async () => {
    const userHasAllFeatures = jest.fn(async (_userId: string, required: string[], scope: { organizationId: string | null }) => (
      required.length === 1 && required[0] === 'workflows.definitions.view' && scope.organizationId === ORG_A
    ))
    const container = { resolve: () => ({ userHasAllFeatures }) }
    const shared = await resolveDisclosableXrayModelKeys(container, { userId: 'user-1', tenantId: TENANT_ID, organizationModelKeys: { [ORG_A]: keyA, [ORG_B]: keyA } })
    expect(shared.size).toBe(0)
    const split = await resolveDisclosableXrayModelKeys(container, { userId: 'user-1', tenantId: TENANT_ID, organizationModelKeys: { [ORG_A]: keyA, [ORG_B]: keyB } })
    expect(Array.from(split)).toEqual([keyA])
    expect(userHasAllFeatures).toHaveBeenCalledWith('user-1', ['workflows.definitions.view'], { tenantId: TENANT_ID, organizationId: ORG_B })
    expect((await resolveDisclosableXrayModelKeys({ resolve: () => { throw new Error('missing') } }, { userId: 'user-1', tenantId: TENANT_ID, organizationModelKeys: { [ORG_A]: keyA } })).size).toBe(0)
  })

  it('replaces the source and the definition-bearing key of hidden workflows, keeping sequences and refusals', () => {
    const model = (key: string, source: { kind: 'workflow' | 'sequence'; definitionId: string | null; version: number | null }) => ({
      key, source, n: 5, conformingCases: null, fitness: null, fitnessLowerBound: null, lowConfidence: true, transitions: null, deviations: [],
    })
    const ok = {
      processKey: 'test.deal', organizationIds: [ORG_A, ORG_B], n: 5, computedThrough: null, incomplete: false,
      status: 'ok', coverage: 1, minCoverage: 0.6, truncatedCases: 0, unresolvedCases: 0, unmappedActivities: [],
      models: [
        model(keyA, { kind: 'workflow', definitionId: DEFINITION_A, version: 3 }),
        model(keyB, { kind: 'workflow', definitionId: DEFINITION_B, version: 1 }),
        model('sequence', { kind: 'sequence', definitionId: null, version: null }),
      ],
    } as unknown as ConformanceResult
    const redacted = redactXrayConformanceSources(ok, new Set([keyB]))
    expect(redacted.status === 'ok' ? redacted.models.map((entry) => [entry.key, entry.source?.definitionId ?? null]) : null).toEqual([
      ['workflow:hidden:1', null],
      [keyB, DEFINITION_B],
      ['sequence', null],
    ])
    expect(JSON.stringify(redacted)).not.toContain(DEFINITION_A)
    const refused = { status: 'refused' } as unknown as ConformanceResult
    expect(redactXrayConformanceSources(refused, new Set())).toBe(refused)
  })
})
