import type { EntityManager } from '@mikro-orm/postgresql'
import { asValue, createContainer, type AwilixContainer } from 'awilix'
import { z } from 'zod'

const findOneWithDecryptionMock = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryptionMock(...args),
}))

import { WorkflowDefinition } from '../../data/entities'
import { register as registerWorkflowsDi } from '../../di'
import type { ActivityTypeEntry } from '../activity-registry'
import {
  createWorkflowDraftService,
  WORKFLOW_DRAFT_FORBIDDEN_ACTIVITY_TYPES,
  WORKFLOW_DRAFT_SERVICE_KEY,
  type WorkflowDraftIssue,
  type WorkflowDraftService,
} from '../draft-service'
import { clearWorkflowSafeCommandsForTests, registerWorkflowSafeCommands } from '../workflow-safe-commands'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_A = '22222222-2222-4222-8222-222222222222'
const ORG_B = '33333333-3333-4333-8333-333333333333'
const OTHER_TENANT_ID = '44444444-4444-4444-8444-444444444444'
const DEFINITION_ID = '55555555-5555-4555-8555-555555555555'
const SCOPE = { tenantId: TENANT_ID, organizationId: ORG_A }

type DraftDefinitionPayload = Record<string, unknown>

function updateEntityActivity(activityId: string, commandId: string): Record<string, unknown> {
  return {
    activityId,
    activityName: 'Set status',
    activityType: 'UPDATE_ENTITY',
    config: { commandId, input: { id: '{{context.recordId}}', status: 'won' } },
  }
}

function buildSteps(automatedActivities?: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return [
    { stepId: 'start', stepName: 'Start', stepType: 'START' },
    {
      stepId: 'set_status',
      stepName: 'Set status',
      stepType: 'AUTOMATED',
      ...(automatedActivities ? { activities: automatedActivities } : {}),
    },
    { stepId: 'end', stepName: 'End', stepType: 'END' },
  ]
}

function buildTransitions(firstActivities?: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return [
    {
      transitionId: 'start_to_set_status',
      fromStepId: 'start',
      toStepId: 'set_status',
      trigger: 'auto',
      ...(firstActivities ? { activities: firstActivities } : {}),
    },
    { transitionId: 'set_status_to_end', fromStepId: 'set_status', toStepId: 'end', trigger: 'auto' },
  ]
}

function buildDraftPayload(overrides: DraftDefinitionPayload = {}): DraftDefinitionPayload {
  return {
    workflowId: 'insights.deal-won-draft',
    workflowName: 'Deal won draft',
    enabled: false,
    lifecycle: 'draft',
    definition: {
      steps: buildSteps(),
      transitions: buildTransitions([updateEntityActivity('set_status_won', 'customers.deals.update')]),
    },
    ...overrides,
  }
}

function withoutKey(payload: DraftDefinitionPayload, key: string): DraftDefinitionPayload {
  return Object.fromEntries(Object.entries(payload).filter(([entryKey]) => entryKey !== key))
}

function buildEntityManagers(takenCount = 0) {
  const countMock = jest.fn(async () => takenCount)
  const forkedEm = { count: countMock }
  const forkMock = jest.fn(() => forkedEm)
  const rootEm = { fork: forkMock }
  return { countMock, forkMock, forkedEm, rootEm }
}

function buildService(rootEm: object): WorkflowDraftService {
  const container: AwilixContainer = createContainer()
  container.register({ em: asValue(rootEm as unknown as EntityManager) })
  return createWorkflowDraftService(container)
}

function issueCodes(issues: WorkflowDraftIssue[]): string[] {
  return issues.map((issue) => issue.code)
}

function buildStoredDefinition(overrides: Partial<WorkflowDefinition> = {}): WorkflowDefinition {
  const record = new WorkflowDefinition()
  record.id = DEFINITION_ID
  record.workflowId = 'sales.deal-pipeline'
  record.workflowName = 'Deal pipeline'
  record.version = 3
  record.enabled = true
  record.tenantId = TENANT_ID
  record.organizationId = ORG_A
  record.deletedAt = null
  record.grantedFeatures = ['customers.deals.manage']
  record.metadata = { tags: ['sales'] }
  record.definition = {
    steps: [
      { stepId: 'start', stepName: 'Start', stepType: 'START', config: { secret: 'start-config' } },
      {
        stepId: 'qualify',
        stepName: 'Qualify',
        stepType: 'USER_TASK',
        userTaskConfig: { assignedTo: 'user-1' },
        activities: [
          { activityId: 'notify', activityName: 'Notify', activityType: 'CALL_WEBHOOK', config: { url: 'https://hooks.example.test' } },
        ],
        metadata: { unmappedConfig: { token: 'leak' } },
      },
      { stepId: 'end', stepName: 'End', stepType: 'END' },
      { stepName: 'Broken', stepType: 'AUTOMATED' },
    ],
    transitions: [
      {
        transitionId: 'start_to_qualify',
        fromStepId: 'start',
        toStepId: 'qualify',
        trigger: 'auto',
        activities: [updateEntityActivity('set_status_won', 'customers.deals.update')],
      },
      { transitionId: 'qualify_to_end', fromStepId: 'qualify', toStepId: 'end', trigger: 'manual' },
      { transitionId: 'qualify_failed', fromStepId: 'qualify', toStepId: 'end', trigger: 'auto', kind: 'error' },
      { transitionId: 'dangling', fromStepId: 'qualify', trigger: 'auto' },
    ],
  }
  Object.assign(record, overrides)
  return record
}

describe('workflowDraftService contract', () => {
  test('exposes the DI key and the credential-bearing activity types', () => {
    expect(WORKFLOW_DRAFT_SERVICE_KEY).toBe('workflowDraftService')
    expect([...WORKFLOW_DRAFT_FORBIDDEN_ACTIVITY_TYPES]).toEqual(['CALL_API', 'CALL_WEBHOOK', 'CALL_OPEN_MERCATO'])
  })

  test('is registered in the workflows DI container under its key', () => {
    const { rootEm } = buildEntityManagers(0)
    const container: AwilixContainer = createContainer()
    container.register({ em: asValue(rootEm as unknown as EntityManager) })
    registerWorkflowsDi(container)

    expect(container.hasRegistration(WORKFLOW_DRAFT_SERVICE_KEY)).toBe(true)
    const service = container.resolve<WorkflowDraftService>(WORKFLOW_DRAFT_SERVICE_KEY)
    expect(typeof service.validateDraftDefinition).toBe('function')
    expect(typeof service.getDefinitionForScope).toBe('function')
  })
})

describe('workflowDraftService.validateDraftDefinition', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    clearWorkflowSafeCommandsForTests()
    registerWorkflowSafeCommands([
      { commandId: 'customers.deals.update', requiredFeatures: ['customers.deals.manage'] },
      { commandId: 'catalog.products.update', requiredFeatures: ['catalog.products.manage', 'catalog.products.view'] },
    ])
  })

  afterAll(() => {
    clearWorkflowSafeCommandsForTests()
  })

  test('accepts a disabled draft and reports its UPDATE_ENTITY command with the declared features', async () => {
    const { countMock, forkMock, forkedEm, rootEm } = buildEntityManagers(0)
    const service = buildService(rootEm)

    const result = await service.validateDraftDefinition(buildDraftPayload({ unknownKey: 'stripped' }), SCOPE)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.commands).toEqual([
      { commandId: 'customers.deals.update', requiredFeatures: ['customers.deals.manage'] },
    ])
    expect(result.workflowIdAvailable).toBe(true)
    expect(result.payload.workflowId).toBe('insights.deal-won-draft')
    expect(result.payload.enabled).toBe(false)
    expect(result.payload.lifecycle).toBe('draft')
    expect(result.payload.version).toBe(1)
    expect(result.payload.definition.transitions[0].priority).toBe(0)
    expect(result.payload).not.toHaveProperty('unknownKey')
    expect(forkMock).toHaveBeenCalledTimes(1)
    expect(countMock).toHaveBeenCalledTimes(1)
    expect(countMock).toHaveBeenCalledWith(WorkflowDefinition, {
      workflowId: 'insights.deal-won-draft',
      tenantId: TENANT_ID,
    })
    expect(countMock.mock.contexts[0]).toBe(forkedEm)
  })

  test('reports the workflow id as taken when the tenant already has a definition with it', async () => {
    const { rootEm } = buildEntityManagers(1)
    const service = buildService(rootEm)

    const result = await service.validateDraftDefinition(buildDraftPayload(), SCOPE)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.workflowIdAvailable).toBe(false)
  })

  test('returns distinct commands sorted by command id from steps and transitions', async () => {
    const { rootEm } = buildEntityManagers(0)
    const service = buildService(rootEm)
    const payload = buildDraftPayload({
      definition: {
        steps: buildSteps([
          updateEntityActivity('update_product', 'catalog.products.update'),
          updateEntityActivity('update_deal_again', 'customers.deals.update'),
        ]),
        transitions: buildTransitions([updateEntityActivity('set_status_won', 'customers.deals.update')]),
      },
    })

    const result = await service.validateDraftDefinition(payload, SCOPE)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.commands).toEqual([
      { commandId: 'catalog.products.update', requiredFeatures: ['catalog.products.manage', 'catalog.products.view'] },
      { commandId: 'customers.deals.update', requiredFeatures: ['customers.deals.manage'] },
    ])
  })

  test('accepts an explicit plain workflow kind and an empty or null grant', async () => {
    const { rootEm } = buildEntityManagers(0)
    const service = buildService(rootEm)

    const withKind = await service.validateDraftDefinition(buildDraftPayload({ kind: 'workflow' }), SCOPE)
    const withEmptyGrant = await service.validateDraftDefinition(buildDraftPayload({ grantedFeatures: [] }), SCOPE)
    const withNullGrant = await service.validateDraftDefinition(buildDraftPayload({ grantedFeatures: null }), SCOPE)

    expect(withKind.ok).toBe(true)
    expect(withEmptyGrant.ok).toBe(true)
    expect(withNullGrant.ok).toBe(true)
  })

  test.each([
    ['enabled: true', buildDraftPayload({ enabled: true })],
    ['enabled omitted', withoutKey(buildDraftPayload(), 'enabled')],
  ])('rejects a draft with %s as must_be_disabled', async (_label, payload) => {
    const { countMock, rootEm } = buildEntityManagers(0)
    const service = buildService(rootEm)

    const result = await service.validateDraftDefinition(payload, SCOPE)

    expect(result).toEqual({
      ok: false,
      issues: [{ path: 'enabled', code: 'must_be_disabled', message: expect.any(String) }],
    })
    expect(countMock).not.toHaveBeenCalled()
  })

  test.each([
    ['lifecycle: published', buildDraftPayload({ lifecycle: 'published' })],
    ['lifecycle omitted', withoutKey(buildDraftPayload(), 'lifecycle')],
  ])('rejects a draft with %s as must_be_draft', async (_label, payload) => {
    const { rootEm } = buildEntityManagers(0)
    const service = buildService(rootEm)

    const result = await service.validateDraftDefinition(payload, SCOPE)

    expect(result).toEqual({
      ok: false,
      issues: [{ path: 'lifecycle', code: 'must_be_draft', message: expect.any(String) }],
    })
  })

  test('rejects a component draft as kind_not_allowed', async () => {
    const { rootEm } = buildEntityManagers(0)
    const service = buildService(rootEm)

    const result = await service.validateDraftDefinition(buildDraftPayload({ kind: 'component' }), SCOPE)

    expect(result).toEqual({
      ok: false,
      issues: [{ path: 'kind', code: 'kind_not_allowed', message: expect.any(String) }],
    })
  })

  test('rejects a draft that carries an execution grant as grant_not_allowed', async () => {
    const { rootEm } = buildEntityManagers(0)
    const service = buildService(rootEm)

    const result = await service.validateDraftDefinition(
      buildDraftPayload({ grantedFeatures: ['customers.deals.manage'] }),
      SCOPE,
    )

    expect(result).toEqual({
      ok: false,
      issues: [{ path: 'grantedFeatures', code: 'grant_not_allowed', message: expect.any(String) }],
    })
  })

  test('reports every credential-bearing activity on steps and transitions', async () => {
    const { countMock, rootEm } = buildEntityManagers(0)
    const service = buildService(rootEm)
    const payload = buildDraftPayload({
      definition: {
        steps: buildSteps([
          {
            activityId: 'call_partner',
            activityName: 'Call partner',
            activityType: 'CALL_API',
            config: { endpoint: '/api/customers/deals' },
          },
        ]),
        transitions: buildTransitions([
          updateEntityActivity('set_status_won', 'customers.deals.update'),
          {
            activityId: 'notify_partner',
            activityName: 'Notify partner',
            activityType: 'CALL_WEBHOOK',
            config: { url: 'https://hooks.example.test/deal' },
          },
        ]),
      },
    })

    const result = await service.validateDraftDefinition(payload, SCOPE)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues).toEqual([
      {
        path: 'definition.steps.1.activities.0.activityType',
        code: 'credential_activity',
        message: expect.any(String),
      },
      {
        path: 'definition.transitions.0.activities.1.activityType',
        code: 'credential_activity',
        message: expect.any(String),
      },
    ])
    expect(countMock).not.toHaveBeenCalled()
  })

  test('rejects an UPDATE_ENTITY command that is not catalogued as workflow-safe', async () => {
    const { rootEm } = buildEntityManagers(0)
    const service = buildService(rootEm)
    const payload = buildDraftPayload({
      definition: {
        steps: buildSteps(),
        transitions: buildTransitions([updateEntityActivity('delete_deal', 'customers.deals.delete')]),
      },
    })

    const result = await service.validateDraftDefinition(payload, SCOPE)

    expect(result).toEqual({
      ok: false,
      issues: [
        {
          path: 'definition.transitions.0.activities.0.config.commandId',
          code: 'command_not_workflow_safe',
          message: expect.any(String),
        },
      ],
    })
  })

  test('collects every policy issue instead of stopping at the first', async () => {
    const { rootEm } = buildEntityManagers(0)
    const service = buildService(rootEm)
    const payload = buildDraftPayload({
      enabled: true,
      lifecycle: 'published',
      kind: 'component',
      grantedFeatures: ['customers.deals.manage'],
      definition: {
        steps: buildSteps([
          { activityId: 'call_partner', activityName: 'Call partner', activityType: 'CALL_API', config: { endpoint: '/api/x' } },
        ]),
        transitions: buildTransitions([updateEntityActivity('delete_deal', 'customers.deals.delete')]),
      },
    })

    const result = await service.validateDraftDefinition(payload, SCOPE)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(issueCodes(result.issues)).toEqual([
      'must_be_disabled',
      'must_be_draft',
      'kind_not_allowed',
      'grant_not_allowed',
      'credential_activity',
      'command_not_workflow_safe',
    ])
  })

  test('reports schema failures as invalid_definition without applying the draft policy', async () => {
    const { countMock, rootEm } = buildEntityManagers(0)
    const service = buildService(rootEm)
    const payload = withoutKey(
      buildDraftPayload({
        enabled: true,
        definition: { steps: [{ stepId: 'start', stepName: 'Start', stepType: 'START' }], transitions: buildTransitions() },
      }),
      'workflowName',
    )

    const result = await service.validateDraftDefinition(payload, SCOPE)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues.length).toBeGreaterThan(0)
    expect(new Set(issueCodes(result.issues))).toEqual(new Set(['invalid_definition']))
    const paths = result.issues.map((issue) => issue.path)
    expect(paths).toContain('workflowName')
    expect(paths).toContain('definition.steps')
    expect(countMock).not.toHaveBeenCalled()
  })

  test('reports a non-object payload as invalid_definition', async () => {
    const { rootEm } = buildEntityManagers(0)
    const service = buildService(rootEm)

    const result = await service.validateDraftDefinition(null, SCOPE)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues).toEqual([{ path: '', code: 'invalid_definition', message: expect.any(String) }])
  })

  test('reports a component that declares triggers as invalid_definition from the checked schema', async () => {
    const { rootEm } = buildEntityManagers(0)
    const service = buildService(rootEm)
    const payload = buildDraftPayload({
      kind: 'component',
      definition: {
        steps: buildSteps(),
        transitions: buildTransitions(),
        triggers: [{ triggerId: 'on_deal', name: 'On deal', eventPattern: 'customers.deals.updated' }],
      },
    })

    const result = await service.validateDraftDefinition(payload, SCOPE)

    expect(result).toEqual({
      ok: false,
      issues: [{ path: 'definition.triggers', code: 'invalid_definition', message: expect.any(String) }],
    })
  })
})

describe('workflowDraftService credential detection for extension activity types', () => {
  const makeEntry = (id: string): ActivityTypeEntry => ({
    id,
    icon: 'Zap',
    i18nKey: `workflows.activities.types.${id}`,
    configSchema: z.object({}),
    form: [],
    execute: async () => ({ ok: true }),
    async: { capable: true },
  })

  test('rejects CALL_OPEN_MERCATO and any activity type containing WEBHOOK', async () => {
    const loaded: { service: WorkflowDraftService | null } = { service: null }
    const { rootEm } = buildEntityManagers(0)
    jest.isolateModules(() => {
      const registry = require('../activity-registry') as typeof import('../activity-registry')
      registry.registerActivityType(makeEntry('CALL_OPEN_MERCATO'))
      registry.registerActivityType(makeEntry('NOTIFY_WEBHOOK'))
      registry.registerActivityType(makeEntry('SLACK_WebHook_POST'))
      const isolated = require('../draft-service') as typeof import('../draft-service')
      const container: AwilixContainer = createContainer()
      container.register({ em: asValue(rootEm as unknown as EntityManager) })
      loaded.service = isolated.createWorkflowDraftService(container)
    })
    const service = loaded.service
    if (!service) throw new Error('[internal] failed to load draft-service in isolation')
    const extensionActivity = (activityId: string, activityType: string) => ({
      activityId,
      activityName: activityId,
      activityType,
      config: {},
    })
    const payload = buildDraftPayload({
      definition: {
        steps: buildSteps([
          extensionActivity('call_platform', 'CALL_OPEN_MERCATO'),
          extensionActivity('notify', 'NOTIFY_WEBHOOK'),
        ]),
        transitions: buildTransitions([extensionActivity('post_slack', 'SLACK_WebHook_POST')]),
      },
    })

    const result = await service.validateDraftDefinition(payload, SCOPE)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues.map((issue) => [issue.code, issue.path])).toEqual([
      ['credential_activity', 'definition.steps.1.activities.0.activityType'],
      ['credential_activity', 'definition.steps.1.activities.1.activityType'],
      ['credential_activity', 'definition.transitions.0.activities.0.activityType'],
    ])
  })
})

describe('workflowDraftService.getDefinitionForScope', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('reads the definition scoped to tenant and organization and returns only its structure', async () => {
    const { forkMock, forkedEm, rootEm } = buildEntityManagers(0)
    const service = buildService(rootEm)
    findOneWithDecryptionMock.mockResolvedValueOnce(buildStoredDefinition())

    const result = await service.getDefinitionForScope(DEFINITION_ID, SCOPE)

    expect(forkMock).toHaveBeenCalledTimes(1)
    expect(findOneWithDecryptionMock).toHaveBeenCalledTimes(1)
    expect(findOneWithDecryptionMock).toHaveBeenCalledWith(
      forkedEm,
      WorkflowDefinition,
      { id: DEFINITION_ID, tenantId: TENANT_ID, organizationId: ORG_A, deletedAt: null },
      undefined,
      { tenantId: TENANT_ID, organizationId: ORG_A },
    )
    expect(result).toStrictEqual({
      id: DEFINITION_ID,
      workflowId: 'sales.deal-pipeline',
      version: 3,
      enabled: true,
      steps: [
        { stepId: 'start', stepType: 'START' },
        { stepId: 'qualify', stepType: 'USER_TASK' },
        { stepId: 'end', stepType: 'END' },
      ],
      transitions: [
        { fromStepId: 'start', toStepId: 'qualify', kind: null },
        { fromStepId: 'qualify', toStepId: 'end', kind: null },
        { fromStepId: 'qualify', toStepId: 'end', kind: 'error' },
      ],
    })
    expect(JSON.stringify(result)).not.toMatch(/config|activities|metadata|grantedFeatures|leak|hooks\.example/)
  })

  test('returns null when no definition matches the scope', async () => {
    const { rootEm } = buildEntityManagers(0)
    const service = buildService(rootEm)
    findOneWithDecryptionMock.mockResolvedValueOnce(null)

    await expect(service.getDefinitionForScope(DEFINITION_ID, SCOPE)).resolves.toBeNull()
  })

  test.each([
    ['another organization', { organizationId: ORG_B }],
    ['another tenant', { tenantId: OTHER_TENANT_ID }],
    ['a soft-deleted row', { deletedAt: new Date('2026-01-01T00:00:00.000Z') }],
  ])('never returns a row from %s even if the lookup yields one', async (_label, overrides) => {
    const { rootEm } = buildEntityManagers(0)
    const service = buildService(rootEm)
    findOneWithDecryptionMock.mockResolvedValueOnce(buildStoredDefinition(overrides))

    await expect(service.getDefinitionForScope(DEFINITION_ID, SCOPE)).resolves.toBeNull()
  })

  test('returns empty structure lists for a stored definition without steps or transitions', async () => {
    const { rootEm } = buildEntityManagers(0)
    const service = buildService(rootEm)
    const record = buildStoredDefinition()
    record.definition = { steps: [], transitions: [] }
    findOneWithDecryptionMock.mockResolvedValueOnce(record)

    const result = await service.getDefinitionForScope(DEFINITION_ID, SCOPE)

    expect(result?.steps).toEqual([])
    expect(result?.transitions).toEqual([])
  })

  test.each([
    ['a non-uuid id', 'not-a-uuid', SCOPE],
    ['an empty id', '', SCOPE],
    ['a non-uuid tenant', DEFINITION_ID, { tenantId: 'tenant-1', organizationId: ORG_A }],
    ['a non-uuid organization', DEFINITION_ID, { tenantId: TENANT_ID, organizationId: 'org-1' }],
  ])('returns null for %s without querying', async (_label, id, scope) => {
    const { forkMock, rootEm } = buildEntityManagers(0)
    const service = buildService(rootEm)

    await expect(service.getDefinitionForScope(id, scope)).resolves.toBeNull()
    expect(forkMock).not.toHaveBeenCalled()
    expect(findOneWithDecryptionMock).not.toHaveBeenCalled()
  })
})
