import type { EntityManager } from '@mikro-orm/postgresql'
import { asValue, createContainer } from 'awilix'
import { createModuleEvents } from '@open-mercato/shared/modules/events'
import { createWorkflowDraftService } from '@open-mercato/core/modules/workflows/lib/draft-service'
import { clearWorkflowSafeCommandsForTests, registerWorkflowSafeCommands } from '@open-mercato/core/modules/workflows/lib/workflow-safe-commands'
import { buildVariantWorkflowDraft } from '../../analytics/variantDraft'
import { testProcessConfig, testRegistry } from '../../process/__tests__/processTestSupport'
import type { XrayWorkflowDraftService } from '../../workflowsBridge'
import {
  assessSuggestionTrigger,
  buildSuggestionWorkflowDraft,
  candidateTriggerEvents,
  createDeclaredEventCatalog,
  isAlreadyAutomated,
  reasonOfDraftIssues,
  suggestionWorkflowId,
  type SuggestionEventCatalog,
  type SuggestionRule,
} from '../draft'
import { neutralSuggestionDraftLabels, prepareSuggestionDraft } from '../draftability'
import { automatedDealProcess, plainDealProcess } from './suggestionsTestSupport'

const SCOPE = { tenantId: '11111111-0000-4000-8000-000000000001', organizationId: '22222222-0000-4000-8000-000000000001' }

const CRUD_PAYLOAD = new Set(['id', 'organizationId', 'tenantId', 'syncOrigin'])

function catalog(entries: Record<string, ReadonlySet<string>>): SuggestionEventCatalog {
  return { payloadPaths: (eventId) => entries[eventId] ?? null }
}

const crudCatalog = catalog({ 'test.deal.created': CRUD_PAYLOAD, 'test.deal.updated': CRUD_PAYLOAD })

function rule(overrides: Partial<SuggestionRule> = {}): SuggestionRule {
  return {
    processKey: 'test.deal',
    signatureHash: 'a'.repeat(64),
    trigger: { activityKey: 'created', activityKind: 'lifecycle', field: null, value: null },
    condition: null,
    followups: [{ field: 'status', value: 'qa_review' }],
    ...overrides,
  }
}

const labels = neutralSuggestionDraftLabels(rule())

describe('assessSuggestionTrigger — what a workflow event trigger can express', () => {
  const process = automatedDealProcess()

  it('expresses the creation of the case root through its declared created event carrying the record id', () => {
    expect(assessSuggestionTrigger(process, rule(), crudCatalog)).toEqual({
      ok: true,
      expression: { eventId: 'test.deal.created', filterConditions: [], recordIdPath: 'id' },
    })
  })

  it.each([
    ['a stage change (events carry no transition, CRUD payloads ids only)', { activityKey: 'status:won', activityKind: 'stage', field: 'status', value: 'won' }],
    ['a follow-up change', { activityKey: 'ownerUserId:changed', activityKind: 'followup', field: 'ownerUserId', value: null }],
    ['a milestone', { activityKey: 'payment.created', activityKind: 'milestone', field: null, value: null }],
    ['a deletion or exit', { activityKey: 'deleted', activityKind: 'lifecycle', field: null, value: null }],
  ])('refuses %s as trigger_not_expressible', (_label, trigger) => {
    expect(assessSuggestionTrigger(process, rule({ trigger }), crudCatalog)).toEqual({ ok: false, reason: 'trigger_not_expressible' })
  })

  it('refuses an undeclared created event or one without the record id', () => {
    expect(assessSuggestionTrigger(process, rule(), catalog({}))).toEqual({ ok: false, reason: 'trigger_not_expressible' })
    expect(assessSuggestionTrigger(process, rule(), catalog({ 'test.deal.created': new Set(['tenantId']) }))).toEqual({ ok: false, reason: 'trigger_not_expressible' })
  })

  it('refuses a condition the ids-only CRUD payload cannot carry, and filters on one the event declares', () => {
    const conditioned = rule({ condition: { field: 'stageId', value: '55555555-0000-4000-8000-00000000000a' }, followups: [{ field: 'status', value: 'won' }] })
    expect(assessSuggestionTrigger(process, conditioned, crudCatalog)).toEqual({ ok: false, reason: 'condition_not_expressible' })
    const rich = catalog({ 'test.deal.created': new Set([...CRUD_PAYLOAD, 'stageId']) })
    expect(assessSuggestionTrigger(process, conditioned, rich)).toEqual({
      ok: true,
      expression: { eventId: 'test.deal.created', filterConditions: [{ field: 'stageId', operator: 'eq', value: '55555555-0000-4000-8000-00000000000a' }], recordIdPath: 'id' },
    })
  })

  it('reads declared events and their payload fields from the shared event registry (CRUD events get the generated id payload)', () => {
    createModuleEvents({
      moduleId: 'suggestiontest',
      events: [
        { id: 'suggestiontest.thing.created', label: 'Created', entity: 'thing', category: 'crud' },
        { id: 'suggestiontest.thing.hidden', label: 'Hidden', entity: 'thing', category: 'lifecycle', excludeFromTriggers: true },
      ],
    })
    const declared = createDeclaredEventCatalog()
    expect(declared.payloadPaths('suggestiontest.thing.created')).toEqual(CRUD_PAYLOAD)
    expect(declared.payloadPaths('suggestiontest.thing.hidden')).toBeNull()
    expect(declared.payloadPaths('suggestiontest.thing.unknown')).toBeNull()
    expect(declared.payloadPaths('othermodule.thing.created')).toEqual(CRUD_PAYLOAD)
  })

  it('applies the CRUD convention only to modules without known events in a partially loaded registry (worker processes)', () => {
    let partial: SuggestionEventCatalog | null = null
    jest.isolateModules(() => {
      const actual = jest.requireActual('@open-mercato/shared/modules/events')
      jest.doMock('@open-mercato/shared/modules/events', () => ({
        ...actual,
        getDeclaredEvents: () => [{ id: 'workflows.instance.started', label: 'Started', module: 'workflows', category: 'lifecycle' }],
      }))
      const isolated = require('../draft') as typeof import('../draft')
      partial = isolated.createDeclaredEventCatalog()
    })
    const catalogPartial = partial as SuggestionEventCatalog | null
    if (!catalogPartial) throw new Error('[internal] catalog not created')
    expect(catalogPartial.payloadPaths('customers.deal.created')).toEqual(CRUD_PAYLOAD)
    expect(catalogPartial.payloadPaths('workflows.instance.created')).toBeNull()
    expect(catalogPartial.payloadPaths('workflows.instance.started')).toEqual(new Set())
  })

  it('falls back to the platform CRUD convention in a process without the event registry (CLI / workers)', () => {
    let fallback: SuggestionEventCatalog | null = null
    jest.isolateModules(() => {
      const actual = jest.requireActual('@open-mercato/shared/modules/events')
      jest.doMock('@open-mercato/shared/modules/events', () => ({ ...actual, getDeclaredEvents: () => [] }))
      const isolated = require('../draft') as typeof import('../draft')
      fallback = isolated.createDeclaredEventCatalog()
    })
    const catalogWithoutRegistry = fallback as SuggestionEventCatalog | null
    if (!catalogWithoutRegistry) throw new Error('[internal] catalog not created')
    expect(catalogWithoutRegistry.payloadPaths('test.deal.created')).toEqual(CRUD_PAYLOAD)
    expect(catalogWithoutRegistry.payloadPaths('test.deal.won')).toBeNull()
    expect(assessSuggestionTrigger(automatedDealProcess(), rule({ condition: { field: 'status', value: 'open' } }), catalogWithoutRegistry))
      .toEqual({ ok: false, reason: 'condition_not_expressible' })
  })
})

describe('isAlreadyAutomated', () => {
  const process = automatedDealProcess()
  const automated = (eventPattern: string, commandId = 'test.deals.update', inputKeys = ['id', 'status']) => [{ eventPattern, commandId, inputKeys }]

  it('matches an enabled trigger on the same event (exact or wildcard) running the same command on the same field', () => {
    expect(isAlreadyAutomated(process, rule(), automated('test.deal.created'))).toBe(true)
    expect(isAlreadyAutomated(process, rule(), automated('test.deal.*'))).toBe(true)
    expect(isAlreadyAutomated(process, rule(), automated('*'))).toBe(true)
  })

  it('does not match another event, another command or another field', () => {
    expect(isAlreadyAutomated(process, rule(), automated('test.deal.updated'))).toBe(false)
    expect(isAlreadyAutomated(process, rule(), automated('test.deal.created', 'test.deals.archive'))).toBe(false)
    expect(isAlreadyAutomated(process, rule(), automated('test.deal.created', 'test.deals.update', ['id', 'stageId']))).toBe(false)
    expect(isAlreadyAutomated(process, rule(), [])).toBe(false)
  })

  it('matches a stage trigger on the root update event and never without declared automation hints', () => {
    const stage = rule({ trigger: { activityKey: 'status:won', activityKind: 'stage', field: 'status', value: 'won' }, followups: [{ field: 'stageId', value: 'x' }] })
    expect(isAlreadyAutomated(process, stage, automated('test.deal.updated', 'test.deals.update', ['id', 'stageId']))).toBe(true)
    expect(isAlreadyAutomated(plainDealProcess(), rule(), automated('test.deal.created'))).toBe(false)
  })

  it('maps milestone triggers to the milestone resource events', () => {
    expect(candidateTriggerEvents(process, { activityKey: 'payment.created', activityKind: 'milestone', field: null, value: null })).toEqual(['test.payment.created'])
    expect(candidateTriggerEvents(process, { activityKey: 'payment.status:paid', activityKind: 'milestone', field: 'payment.status', value: 'paid' })).toEqual(['test.payment.updated'])
    expect(candidateTriggerEvents(process, { activityKey: 'deleted', activityKind: 'lifecycle', field: null, value: null })).toEqual([])
  })
})

describe('buildSuggestionWorkflowDraft', () => {
  it('builds a disabled draft: created trigger with the record id mapping, one UPDATE_ENTITY step of the declared command', () => {
    const expression = { eventId: 'test.deal.created', filterConditions: [], recordIdPath: 'id' }
    const payload = buildSuggestionWorkflowDraft({ process: automatedDealProcess(), rule: rule(), expression, labels }) as Record<string, unknown>
    expect(payload).toEqual(expect.objectContaining({ workflowId: `xray.s.test.deal.${'a'.repeat(12)}`, enabled: false, lifecycle: 'draft', kind: 'workflow', version: 1 }))
    const definition = payload.definition as { steps: Array<Record<string, unknown>>; triggers: Array<Record<string, unknown>>; transitions: unknown[] }
    expect(definition.steps.map((step) => step.stepType)).toEqual(['START', 'AUTOMATED', 'END'])
    expect(definition.steps[1].activities).toEqual([expect.objectContaining({
      activityType: 'UPDATE_ENTITY',
      config: { commandId: 'test.deals.update', input: { id: '{{context.recordId}}', status: 'qa_review' } },
    })])
    expect(definition.triggers).toEqual([expect.objectContaining({
      triggerId: 'xray_suggestion',
      eventPattern: 'test.deal.created',
      enabled: true,
      config: { contextMapping: [{ targetKey: 'recordId', sourceExpression: 'id' }] },
    })])
    expect(definition.transitions).toHaveLength(2)
  })

  it('uses the declared input keys and carries the condition as an eq filter', () => {
    const config = testProcessConfig()
    const processes = (config.processes ?? []).map((process) => ({
      ...process,
      automation: { updateCommandId: 'test.deals.update', recordIdInputKey: 'dealId', fieldInputKeys: { status: 'statusValue' } },
    }))
    const process = testRegistry({ ...config, processes }).processes[0]
    const expression = { eventId: 'test.deal.created', filterConditions: [{ field: 'stageId', operator: 'eq' as const, value: 'x' }], recordIdPath: 'id' }
    const payload = buildSuggestionWorkflowDraft({ process, rule: rule(), expression, labels }) as { definition: { steps: Array<{ activities?: Array<{ config: unknown }> }>; triggers: Array<{ config: unknown }> } }
    expect(payload.definition.steps[1].activities?.[0].config).toEqual({ commandId: 'test.deals.update', input: { dealId: '{{context.recordId}}', statusValue: 'qa_review' } })
    expect(payload.definition.triggers[0].config).toEqual({
      contextMapping: [{ targetKey: 'recordId', sourceExpression: 'id' }],
      filterConditions: [{ field: 'stageId', operator: 'eq', value: 'x' }],
    })
  })

  it('returns null without a declared update command', () => {
    expect(buildSuggestionWorkflowDraft({ process: plainDealProcess(), rule: rule(), expression: { eventId: 'test.deal.created', filterConditions: [], recordIdPath: 'id' }, labels })).toBeNull()
  })

  it('bounds the workflow id to 100 characters', () => {
    expect(suggestionWorkflowId('test.deal', 'b'.repeat(64))).toBe(`xray.s.test.deal.${'b'.repeat(12)}`)
    const long = `${'p'.repeat(60)}.${'q'.repeat(60)}`
    expect(suggestionWorkflowId(long, 'b'.repeat(64)).length).toBeLessThanOrEqual(100)
  })
})

describe('prepareSuggestionDraft — draftable reasons', () => {
  const okService = (): XrayWorkflowDraftService & { validateDraftDefinition: jest.Mock } => ({
    validateDraftDefinition: jest.fn(async (payload: unknown) => ({ ok: true as const, payload, commands: [{ commandId: 'test.deals.update', requiredFeatures: ['test.deals.manage'] }], workflowIdAvailable: true })),
    getDefinitionForScope: jest.fn(async () => null),
  })

  it('is draftable when the trigger is expressible, the command declared and the workflows draft valid', async () => {
    const service = okService()
    const outcome = await prepareSuggestionDraft({ process: automatedDealProcess(), rule: rule(), catalog: crudCatalog, service, scope: SCOPE, labels })
    expect(outcome).toEqual(expect.objectContaining({ draftable: true, eventId: 'test.deal.created', workflowIdAvailable: true }))
    expect(service.validateDraftDefinition).toHaveBeenCalledWith(expect.objectContaining({ enabled: false, lifecycle: 'draft' }), SCOPE)
  })

  it.each([
    ['trigger_not_expressible', { rule: rule({ trigger: { activityKey: 'status:won', activityKind: 'stage', field: 'status', value: 'won' } }) }],
    ['condition_not_expressible', { rule: rule({ condition: { field: 'stageId', value: 'x' } }) }],
    ['no_command', { process: plainDealProcess() }],
    ['workflows_unavailable', { service: null }],
  ])('reports %s', async (reason, overrides) => {
    const outcome = await prepareSuggestionDraft({
      process: automatedDealProcess(),
      rule: rule(),
      catalog: crudCatalog,
      service: okService(),
      scope: SCOPE,
      labels,
      ...overrides,
    })
    expect(outcome).toEqual(expect.objectContaining({ draftable: false, reason }))
  })

  it('reports command_not_workflow_safe and draft_invalid from the workflows validation', async () => {
    const failing = (codes: string[]): XrayWorkflowDraftService => ({
      validateDraftDefinition: async () => ({ ok: false, issues: codes.map((code) => ({ path: 'definition', code, message: code })) }),
      getDefinitionForScope: async () => null,
    })
    expect(await prepareSuggestionDraft({ process: automatedDealProcess(), rule: rule(), catalog: crudCatalog, service: failing(['command_not_workflow_safe']), scope: SCOPE, labels }))
      .toEqual(expect.objectContaining({ draftable: false, reason: 'command_not_workflow_safe' }))
    expect(await prepareSuggestionDraft({ process: automatedDealProcess(), rule: rule(), catalog: crudCatalog, service: failing(['invalid_definition', 'command_not_workflow_safe']), scope: SCOPE, labels }))
      .toEqual(expect.objectContaining({ draftable: false, reason: 'draft_invalid' }))
    expect(reasonOfDraftIssues([])).toBe('draft_invalid')
  })
})

describe('the generated draft against the real workflows draft policy', () => {
  beforeEach(() => {
    clearWorkflowSafeCommandsForTests()
    registerWorkflowSafeCommands([{ commandId: 'test.deals.update', requiredFeatures: ['test.deals.manage'] }])
  })

  afterAll(() => clearWorkflowSafeCommandsForTests())

  function realService(): XrayWorkflowDraftService {
    const container = createContainer()
    container.register({ em: asValue({ fork: () => ({ count: async () => 0 }) } as unknown as EntityManager) })
    return createWorkflowDraftService(container)
  }

  it('accepts the suggestion draft (event trigger, context mapping, UPDATE_ENTITY of a workflow-safe command)', async () => {
    const outcome = await prepareSuggestionDraft({ process: automatedDealProcess(), rule: rule(), catalog: crudCatalog, service: realService(), scope: SCOPE, labels })
    expect(outcome).toEqual(expect.objectContaining({ draftable: true, commands: [{ commandId: 'test.deals.update', requiredFeatures: ['test.deals.manage'], enabled: false }] }))
  })

  it('generates only allowlisted step types, and the variant draft passes the same policy', async () => {
    const outcome = await prepareSuggestionDraft({ process: automatedDealProcess(), rule: rule(), catalog: crudCatalog, service: realService(), scope: SCOPE, labels })
    const suggestionSteps = outcome.draftable ? (outcome.payload as { definition: { steps: Array<{ stepType: string }> } }).definition.steps : []
    expect(suggestionSteps.map((step) => step.stepType)).toEqual(['START', 'AUTOMATED', 'END'])
    const variant = buildVariantWorkflowDraft({
      process: automatedDealProcess(),
      variantHash: 'b'.repeat(64),
      activityKeys: ['created', 'status:open', 'status:qa_review'],
      commandId: 'test.deals.update',
      labels: { workflowName: 'Variant', description: 'Generated', start: 'Start', end: 'End', recordId: 'Record', stepName: (field, value) => `${field} ${value}` },
    })
    if (!variant) throw new Error('[internal] expected a variant draft')
    const validated = await realService().validateDraftDefinition(variant.payload, SCOPE)
    expect(validated.ok).toBe(true)
  })

  it('accepts a conditioned draft and refuses a command outside the catalogue', async () => {
    const rich = catalog({ 'test.deal.created': new Set([...CRUD_PAYLOAD, 'stageId']) })
    const conditioned = await prepareSuggestionDraft({ process: automatedDealProcess(), rule: rule({ condition: { field: 'stageId', value: 'x' } }), catalog: rich, service: realService(), scope: SCOPE, labels })
    expect(conditioned.draftable).toBe(true)
    clearWorkflowSafeCommandsForTests()
    const unsafe = await prepareSuggestionDraft({ process: automatedDealProcess(), rule: rule(), catalog: crudCatalog, service: realService(), scope: SCOPE, labels })
    expect(unsafe).toEqual(expect.objectContaining({ draftable: false, reason: 'command_not_workflow_safe' }))
  })
})

describe('process automation hints (registry)', () => {
  function registryWith(automation: unknown) {
    const config = testProcessConfig()
    const processes = (config.processes ?? []).map((process) => ({ ...process, automation: automation as never }))
    return testRegistry({ ...config, processes })
  }

  it('defaults the record id and maps every settable root field to its own key (never a user-valued follow-up)', () => {
    expect(registryWith({ updateCommandId: 'test.deals.update' }).processes[0].automation).toEqual({
      updateCommandId: 'test.deals.update',
      recordIdInputKey: 'id',
      fieldInputKeys: { priority: 'priority', stageId: 'stageId', status: 'status' },
    })
    expect(plainDealProcess().automation).toBeNull()
  })

  it.each([
    ['an invalid command id', { updateCommandId: 'Not A Command' }],
    ['an invalid record id key', { updateCommandId: 'test.deals.update', recordIdInputKey: '1bad' }],
    ['a user-valued field', { updateCommandId: 'test.deals.update', fieldInputKeys: { ownerUserId: 'owner' } }],
    ['an undeclared field', { updateCommandId: 'test.deals.update', fieldInputKeys: { unknown: 'x' } }],
    ['two fields on one input key', { updateCommandId: 'test.deals.update', fieldInputKeys: { status: 'stageId' } }],
    ['a field on the record id key', { updateCommandId: 'test.deals.update', fieldInputKeys: { status: 'id' } }],
  ])('rejects the declaration with %s', (_label, automation) => {
    const registry = registryWith(automation)
    expect(registry.processes).toEqual([])
    expect(registry.rejected[0]?.reason).toMatch(/automation/)
  })

  it('keeps automation hints out of the process contract hash (no re-projection)', () => {
    expect(registryWith({ updateCommandId: 'test.deals.update' }).processContractHashes.get('test.deal')).toBe(testRegistry().processContractHashes.get('test.deal'))
  })
})
