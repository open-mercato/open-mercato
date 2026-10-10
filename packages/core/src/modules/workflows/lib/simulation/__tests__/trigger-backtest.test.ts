import fs from 'node:fs'
import path from 'node:path'

const findWithDecryption = jest.fn()
const findOneWithDecryption = jest.fn()
const declaredEventIds: string[] = []
const startWorkflow = jest.fn()
const executeWorkflow = jest.fn()
const processEventTriggers = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => findWithDecryption(...args),
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryption(...args),
}))
jest.mock('@open-mercato/shared/modules/events', () => {
  const actual = jest.requireActual('@open-mercato/shared/modules/events')
  return { ...actual, getAllDeclaredEventIds: () => [...declaredEventIds] }
})
jest.mock('../../workflow-executor', () => ({
  startWorkflow: (...args: unknown[]) => startWorkflow(...args),
  executeWorkflow: (...args: unknown[]) => executeWorkflow(...args),
}))
jest.mock('../../event-trigger-service', () => ({
  processEventTriggers: (...args: unknown[]) => processEventTriggers(...args),
}))

import {
  createCrudEventAdapters,
  type RegisteredSimulationEventAdapter,
  type SimulationAuditEntry,
  type SimulationRunContext,
} from '@open-mercato/shared/modules/insights/simulate'
import { clearCodeWorkflowRegistry, registerCodeWorkflowEntries } from '@open-mercato/shared/modules/workflows/code-registry'
import { workflowTriggerBacktestProposalSchema, type WorkflowTriggerBacktestProposal } from '../../../data/validators'
import { WORKFLOW_TRIGGER_EXCLUDED_EVENT_PREFIXES } from '../../../subscribers/event-trigger'
import { codeWorkflowUuid } from '../../find-definition'
import {
  TRIGGER_BACKTEST_CELLS,
  classifyCodeArtifactId,
  evaluateTriggerEvent,
  seedTriggerDebounceState,
  triggerDebounceWildcardKey,
  triggerDebounceWindowKey,
  triggerEventCompleteness,
  fingerprintTriggerProposal,
  fingerprintWorkflowDefinition,
  matchedTriggerAdapters,
  resolveProposalLiveness,
  runTriggerBacktestSlice,
  triggerBacktestKind,
  triggerDebounceBucket,
  triggerSampleRecordId,
  type TriggerBacktestState,
  type TriggerDebounceState,
} from '../trigger-backtest'

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const SCOPE = { tenantId: TENANT, organizationId: ORG }
const ARTIFACT = '33333333-3333-4333-8333-333333333333'
const NOW = Date.parse('2026-10-10T12:00:00Z')
const WINDOW = { from: new Date('2026-07-01T00:00:00Z'), to: new Date('2026-10-01T00:00:00Z') }
const HOUR = 60 * 60 * 1000

function trigger(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    triggerId: 'deal_events',
    name: 'Deal events',
    eventPattern: 'customers.deal.*',
    config: null,
    enabled: true,
    priority: 0,
    ...overrides,
  }
}

function proposal(overrides: Record<string, unknown> = {}): WorkflowTriggerBacktestProposal {
  return workflowTriggerBacktestProposalSchema.parse({
    workflowId: 'deal_followup',
    version: 1,
    enabled: true,
    triggers: [trigger()],
    ...overrides,
  })
}

function parsedTrigger(overrides: Record<string, unknown> = {}) {
  return proposal({ triggers: [trigger(overrides)] }).triggers[0]
}

let logSequence = 0

function auditEntry(overrides: Partial<SimulationAuditEntry> = {}): SimulationAuditEntry {
  logSequence += 1
  return {
    logId: `44444444-4444-4444-8444-${String(logSequence).padStart(12, '0')}`,
    at: '2026-08-02T10:00:00.000Z',
    commandId: 'customers.deals.update',
    actionType: 'edit',
    executionState: 'done',
    actorUserId: null,
    resourceKind: 'customers.deal',
    resourceId: 'deal-1',
    snapshotBefore: null,
    snapshotAfter: null,
    changes: null,
    causeKind: 'user',
    organizationId: ORG,
    correlationId: null,
    causedByLogId: null,
    actorKind: 'user',
    ...overrides,
  }
}

function created(resourceId: string, at: string): SimulationAuditEntry {
  return auditEntry({ resourceId, at, commandId: 'customers.deals.create', actionType: 'create' })
}

function updated(resourceId: string, at: string): SimulationAuditEntry {
  return auditEntry({ resourceId, at })
}

const DEAL_ADAPTERS: RegisteredSimulationEventAdapter[] = createCrudEventAdapters({
  eventPrefix: 'customers.deal',
  logResourceKinds: ['customers.deal'],
  requiredFeatures: ['customers.deals.view'],
  syncOrigin: false,
}).map((adapter) => ({ ...adapter, moduleId: 'customers' }))

const PERSON_ADAPTER: RegisteredSimulationEventAdapter = {
  eventId: 'customers.person.updated',
  logResourceKinds: ['customers.person'],
  actionTypes: ['edit'],
  requiredFeatures: ['customers.people.view'],
  moduleId: 'customers',
  payloadFrom(entry) {
    return { payload: { entityId: entry.resourceId, organizationId: ORG, tenantId: TENANT }, unknownPaths: ['id'] }
  },
}

const EXCLUDED_ADAPTER: RegisteredSimulationEventAdapter = {
  eventId: 'workflows.instance.completed',
  logResourceKinds: ['workflows.instance'],
  actionTypes: ['edit'],
  requiredFeatures: ['workflows.instances.view'],
  moduleId: 'test',
  payloadFrom: () => ({ payload: { id: 'instance-1' } }),
}

const ADAPTERS = [...DEAL_ADAPTERS, PERSON_ADAPTER, EXCLUDED_ADAPTER]

const emWrites = { persist: jest.fn(), flush: jest.fn(), nativeUpdate: jest.fn(), nativeDelete: jest.fn(), insert: jest.fn(), create: jest.fn(), remove: jest.fn() }
const emCount = jest.fn(async () => 0)

function context(overrides: Partial<SimulationRunContext<TriggerBacktestState>> = {}): SimulationRunContext<TriggerBacktestState> {
  return {
    em: { count: emCount, ...emWrites } as never,
    scope: SCOPE,
    requesterUserId: '55555555-5555-4555-8555-555555555555',
    artifactId: ARTIFACT,
    window: WINDOW,
    budget: { recordsRemaining: 1000, sliceDeadlineAt: NOW + 10_000, runDeadlineAt: NOW + 60_000, maxBatchRows: 500, maxBatchBytes: 1_000_000 },
    state: null,
    now: () => NOW,
    hasFeatures: async () => true,
    eventAdapters: ADAPTERS,
    scanAuditLog: jest.fn(async () => ({ entries: [], lastCursor: null, exhausted: true, payloadBytes: 0, undecryptable: 0 })),
    ...overrides,
  }
}

function scanOf(...pages: SimulationAuditEntry[][]) {
  let index = 0
  return jest.fn(async () => {
    const entries = pages[index] ?? []
    index += 1
    const last = entries[entries.length - 1]
    return {
      entries,
      lastCursor: last ? { createdAt: last.at, id: last.logId } : null,
      exhausted: index >= pages.length,
      payloadBytes: 0,
      undecryptable: 0,
    }
  })
}

function cellsOf(result: { groups: Array<{ key: string; cells: Array<{ key: string; count: number }> }> }, key: string): Record<string, number> {
  const group = result.groups.find((entry) => entry.key === key)
  expect(group).toBeTruthy()
  return Object.fromEntries((group?.cells ?? []).map((cell) => [cell.key, cell.count]))
}

function groupOf(result: { groups: Array<{ key: string }> }, key: string) {
  const group = result.groups.find((entry) => entry.key === key)
  expect(group).toBeTruthy()
  return group as { key: string; warnings?: string[]; dataWarnings?: string[]; sampleResourceKind?: string | null; cells: Array<{ key: string; count: number; sampleIds?: string[] }> }
}

async function runDone(input: WorkflowTriggerBacktestProposal, overrides: Partial<SimulationRunContext<TriggerBacktestState>> = {}) {
  const result = await runTriggerBacktestSlice(input, context(overrides))
  if (result.status !== 'done') throw new Error('[internal] expected a finished slice')
  return result
}

function artifactRow(overrides: Record<string, unknown> = {}) {
  return { id: ARTIFACT, workflowId: 'deal_followup', version: 1, enabled: false, lifecycle: 'published', kind: 'workflow', updatedAt: new Date('2026-10-09T10:00:00.000Z'), definition: { steps: [], transitions: [], triggers: [] }, ...overrides }
}

const BASE_CATALOG = ['customers.deal.created', 'customers.deal.updated', 'customers.deal.deleted', 'customers.person.updated', 'workflows.instance.completed']

beforeEach(() => {
  jest.clearAllMocks()
  declaredEventIds.splice(0, declaredEventIds.length, ...BASE_CATALOG)
  logSequence = 0
  clearCodeWorkflowRegistry()
  findOneWithDecryption.mockResolvedValue(artifactRow())
  findWithDecryption.mockResolvedValue([artifactRow()])
  emCount.mockResolvedValue(0)
})

describe('trigger matching mirrors the trigger subscriber', () => {
  it('skips exactly the subscriber\'s excluded prefixes and matches patterns like findMatchingTriggers', () => {
    expect(WORKFLOW_TRIGGER_EXCLUDED_EVENT_PREFIXES).toEqual(['query_index.', 'search.', 'workflows.', 'cache.', 'queue.'])
    expect(matchedTriggerAdapters([{ eventPattern: '*' }], ADAPTERS).map((adapter) => adapter.eventId)).not.toContain('workflows.instance.completed')
    expect(matchedTriggerAdapters([{ eventPattern: 'workflows.*.*' }], ADAPTERS)).toEqual([])
    expect(matchedTriggerAdapters([{ eventPattern: 'customers.*' }], ADAPTERS)).toEqual([])
    expect(matchedTriggerAdapters([{ eventPattern: 'customers.deal.*' }], ADAPTERS).map((adapter) => adapter.eventId)).toEqual(['customers.deal.created', 'customers.deal.updated', 'customers.deal.deleted'])
    expect(matchedTriggerAdapters([{ eventPattern: 'customers.*.updated' }], ADAPTERS).map((adapter) => adapter.eventId)).toEqual(['customers.deal.updated', 'customers.person.updated'])
  })
})

describe('debounce, concurrency and start certainty (S7)', () => {
  const base = { active: true, startCertain: true, windowsComplete: true, unknownPaths: [] as string[] }

  it('debounces leading-edge per trigger and payload id', () => {
    const debounce: TriggerDebounceState = { windows: {}, wildcard: {} }
    const debounced = parsedTrigger({ config: { debounceMs: HOUR } })
    const at = Date.parse('2026-08-01T10:00:00Z')
    const run = (payloadId: unknown, offset: number) => evaluateTriggerEvent({ ...base, trigger: debounced, payload: { id: payloadId }, at: at + offset }, debounce).cell
    expect(run('deal-1', 0)).toBe('would_start')
    expect(run('deal-1', 1000)).toBe('debounced')
    expect(run('deal-2', 1000)).toBe('would_start')
    expect(run('deal-1', HOUR - 1)).toBe('debounced')
    expect(run('deal-1', HOUR)).toBe('would_start')
    expect(run(7, HOUR)).toBe('would_start')
    expect(run('7', HOUR + 1)).toBe('debounced')
    expect(run(undefined, HOUR)).toBe('would_start')
    expect(run(null, HOUR + 1)).toBe('debounced')
  })

  it('keeps triggers apart and leaves a window untouched when the filter fails', () => {
    const debounce: TriggerDebounceState = { windows: {}, wildcard: {} }
    const first = parsedTrigger({ triggerId: 'first', config: { debounceMs: HOUR, filterConditions: [{ field: 'id', operator: 'eq', value: 'deal-1' }] } })
    const second = parsedTrigger({ triggerId: 'second', config: { debounceMs: HOUR } })
    const at = Date.parse('2026-08-01T10:00:00Z')
    expect(evaluateTriggerEvent({ ...base, trigger: first, payload: { id: 'deal-2' }, at }, debounce).cell).toBe('would_not_start')
    expect(evaluateTriggerEvent({ ...base, trigger: first, payload: { id: 'deal-1' }, at }, debounce).cell).toBe('would_start')
    expect(evaluateTriggerEvent({ ...base, trigger: second, payload: { id: 'deal-1' }, at }, debounce).cell).toBe('would_start')
    expect(evaluateTriggerEvent({ ...base, trigger: first, payload: { id: 'deal-1' }, at: at + 10 }, debounce).cell).toBe('debounced')
  })

  it('reports cannot_tell for every matched event of a trigger with maxConcurrentInstances, and the window it may open', () => {
    const debounce: TriggerDebounceState = { windows: {}, wildcard: {} }
    const limited = parsedTrigger({ config: { maxConcurrentInstances: 1, debounceMs: HOUR, filterConditions: [{ field: 'id', operator: 'neq', value: 'deal-9' }] } })
    const at = Date.parse('2026-08-01T10:00:00Z')
    const input = { ...base, startCertain: false, trigger: limited }
    expect(evaluateTriggerEvent({ ...input, payload: { id: 'deal-1' }, at }, debounce).cell).toBe('cannot_tell')
    expect(evaluateTriggerEvent({ ...input, payload: { id: 'deal-1' }, at: at + 10 }, debounce).cell).toBe('cannot_tell')
    expect(evaluateTriggerEvent({ ...input, payload: { id: 'deal-9' }, at: at + 10 }, debounce).cell).toBe('would_not_start')
    expect(evaluateTriggerEvent({ ...input, payload: { id: 'deal-2' }, at }, { windows: {}, wildcard: {} }).cell).toBe('cannot_tell')
  })

  it('turns an uncertain start into an uncertain window, and resolves again once it closed', () => {
    const debounce: TriggerDebounceState = { windows: {}, wildcard: {} }
    const filtered = parsedTrigger({ config: { debounceMs: HOUR, filterConditions: [{ field: 'valueAmount', operator: 'gt', value: 100 }] } })
    const at = Date.parse('2026-08-01T10:00:00Z')
    expect(evaluateTriggerEvent({ ...base, trigger: filtered, payload: { id: 'deal-1' }, unknownPaths: ['valueAmount'], at }, debounce).cell).toBe('cannot_tell')
    expect(evaluateTriggerEvent({ ...base, trigger: filtered, payload: { id: 'deal-1', valueAmount: 500 }, at: at + 1000 }, debounce).cell).toBe('cannot_tell')
    expect(evaluateTriggerEvent({ ...base, trigger: filtered, payload: { id: 'deal-1', valueAmount: 50 }, at: at + 2000 }, debounce).cell).toBe('would_not_start')
    expect(evaluateTriggerEvent({ ...base, trigger: filtered, payload: { id: 'deal-1', valueAmount: 500 }, at: at + 1000 + HOUR }, debounce).cell).toBe('would_start')
    expect(evaluateTriggerEvent({ ...base, trigger: filtered, payload: { id: 'deal-1' }, unknownPaths: ['valueAmount'], at: at + 2000 + HOUR }, debounce).cell).toBe('cannot_tell')
  })

  it('treats an event without a known payload id as possibly sharing any window', () => {
    const debounce: TriggerDebounceState = { windows: {}, wildcard: {} }
    const debounced = parsedTrigger({ config: { debounceMs: HOUR } })
    const at = Date.parse('2026-08-01T10:00:00Z')
    expect(triggerDebounceBucket({ entityId: 'person-1' }, ['id'])).toBeNull()
    expect(evaluateTriggerEvent({ ...base, trigger: debounced, payload: { entityId: 'person-1' }, unknownPaths: ['id'], at }, debounce).cell).toBe('cannot_tell')
    expect(evaluateTriggerEvent({ ...base, trigger: debounced, payload: { id: 'deal-1' }, at: at + 10 }, debounce).cell).toBe('cannot_tell')
    expect(evaluateTriggerEvent({ ...base, trigger: debounced, payload: { id: 'deal-1' }, at: at + HOUR + 10 }, debounce).cell).toBe('would_start')
  })

  it('is cannot_tell for a debounced trigger whose windows unreplayed events may share, and only then', () => {
    const debounce: TriggerDebounceState = { windows: {}, wildcard: {} }
    const debounced = parsedTrigger({ config: { debounceMs: HOUR, filterConditions: [{ field: 'id', operator: 'neq', value: 'deal-9' }] } })
    const plain = parsedTrigger({ triggerId: 'plain' })
    const input = { ...base, windowsComplete: false }
    expect(evaluateTriggerEvent({ ...input, trigger: debounced, payload: { id: 'deal-1' }, at: 1 }, debounce).cell).toBe('cannot_tell')
    expect(evaluateTriggerEvent({ ...input, trigger: debounced, payload: { id: 'deal-9' }, at: 2 }, debounce).cell).toBe('would_not_start')
    expect(evaluateTriggerEvent({ ...input, trigger: plain, payload: { id: 'deal-1' }, at: 3 }, debounce).cell).toBe('would_start')
  })

  it('keys windows by JSON tuples: no NUL in the persisted state, and prototype member names are plain ids', () => {
    const debounce: TriggerDebounceState = { windows: {}, wildcard: {} }
    const at = Date.parse('2026-08-01T10:00:00Z')
    for (const triggerId of ['constructor', '__proto__', 'tostring']) {
      const trigger = parsedTrigger({ triggerId, config: { debounceMs: HOUR } })
      expect(evaluateTriggerEvent({ ...base, trigger, payload: { entityId: 'person-1' }, unknownPaths: ['id'], at }, debounce).cell).toBe('cannot_tell')
      expect(evaluateTriggerEvent({ ...base, trigger, payload: { id: 'deal-1' }, at: at + 10 }, debounce).cell).toBe('cannot_tell')
      expect(evaluateTriggerEvent({ ...base, trigger, payload: { id: 'deal-1' }, at: at + HOUR + 10 }, debounce).cell).toBe('would_start')
      expect(evaluateTriggerEvent({ ...base, trigger, payload: { id: 'deal-1' }, at: at + HOUR + 20 }, debounce).cell).toBe('debounced')
    }
    expect(Object.keys(debounce.windows)).toContain(triggerDebounceWindowKey('__proto__', 'deal-1'))
    expect(debounce.wildcard[triggerDebounceWildcardKey('constructor')]).toBe(at + HOUR)
    const serialized = JSON.stringify(debounce)
    expect(serialized).not.toContain('\\u0000')
    expect(serialized.includes(String.fromCharCode(0))).toBe(false)
    expect(Object.getPrototypeOf(JSON.parse(serialized).windows)).toBe(Object.prototype)
  })

  it('treats windows that may predate the run window as uncertain for the first debounce period', () => {
    const debounce: TriggerDebounceState = { windows: {}, wildcard: {} }
    const from = Date.parse('2026-07-01T00:00:00Z')
    const debounced = parsedTrigger({ config: { debounceMs: HOUR } })
    seedTriggerDebounceState(debounce, [debounced, parsedTrigger({ triggerId: 'plain' })], from)
    expect(debounce.wildcard).toEqual({ [triggerDebounceWildcardKey('deal_events')]: from + HOUR })
    expect(evaluateTriggerEvent({ ...base, trigger: debounced, payload: { id: 'deal-1' }, at: from + 1000 }, debounce).cell).toBe('cannot_tell')
    expect(evaluateTriggerEvent({ ...base, trigger: debounced, payload: { id: 'deal-2' }, at: from + HOUR }, debounce).cell).toBe('would_start')
    expect(evaluateTriggerEvent({ ...base, trigger: debounced, payload: { id: 'deal-1' }, at: from + HOUR + 10 }, debounce).cell).toBe('cannot_tell')
  })

  it('never starts an inactive trigger and starts without debounce on every matched event', () => {
    const plain = parsedTrigger()
    const debounce: TriggerDebounceState = { windows: {}, wildcard: {} }
    expect(evaluateTriggerEvent({ ...base, active: false, trigger: plain, payload: { id: 'deal-1' }, at: 1 }, debounce).cell).toBe('would_not_start')
    expect(evaluateTriggerEvent({ ...base, trigger: plain, payload: { id: 'deal-1' }, at: 1 }, debounce).cell).toBe('would_start')
    expect(evaluateTriggerEvent({ ...base, trigger: plain, payload: { id: 'deal-1' }, at: 2 }, debounce).cell).toBe('would_start')
    expect(debounce).toEqual({ windows: {}, wildcard: {} })
  })
})

describe('event completeness of a pattern', () => {
  it('is proven by the declared catalog only for adapted events of a declared module', () => {
    expect(triggerEventCompleteness('customers.deal.*', ADAPTERS)).toEqual({ complete: true, unreplayed: [] })
    expect(triggerEventCompleteness('customers.deal.*', ADAPTERS, [...BASE_CATALOG, 'customers.deal.won', 'customers.dealer.created'])).toEqual({ complete: false, unreplayed: ['customers.deal.won'] })
    expect(triggerEventCompleteness('customers.deal.created', ADAPTERS, [...BASE_CATALOG, 'customers.deal.won'])).toEqual({ complete: true, unreplayed: [] })
    expect(triggerEventCompleteness('*', ADAPTERS)).toEqual({ complete: false, unreplayed: [] })
    expect(triggerEventCompleteness('customers.deal.*', ADAPTERS, [])).toEqual({ complete: false, unreplayed: [] })
    expect(triggerEventCompleteness('catalog.product.*', ADAPTERS, [])).toEqual({ complete: true, unreplayed: [] })
    expect(triggerEventCompleteness('workflows.*.*', ADAPTERS)).toEqual({ complete: true, unreplayed: [] })
  })
})

describe('version resolution', () => {
  const row = (version: number, enabled = true, lifecycle = 'published') => ({ id: `row-${version}`, version, enabled, lifecycle })

  it('is live only as the highest enabled, published version of the workflow', () => {
    expect(resolveProposalLiveness({ enabled: true, version: 2 }, 'published', [row(1)])).toEqual({ live: true, warnings: [] })
    expect(resolveProposalLiveness({ enabled: true, version: 2 }, 'published', [row(3, false), row(4, true, 'draft'), row(5, true, 'archived')])).toEqual({ live: true, warnings: [] })
    expect(resolveProposalLiveness({ enabled: true, version: 2 }, 'published', [row(3)])).toEqual({ live: false, warnings: ['workflows.simulation.warnings.notLiveVersion'] })
    expect(resolveProposalLiveness({ enabled: true, version: 2 }, 'published', [row(2)]).live).toBe(false)
    expect(resolveProposalLiveness({ enabled: false, version: 2 }, 'draft', [])).toEqual({
      live: false,
      warnings: ['workflows.simulation.warnings.definitionDisabled', 'workflows.simulation.warnings.notPublished'],
    })
  })

  it('reads the versions of the edited row\'s workflow once, scoped, and evaluates nothing for a superseded proposal', async () => {
    findOneWithDecryption.mockResolvedValue(artifactRow({ workflowId: 'stored_id' }))
    findWithDecryption.mockResolvedValue([artifactRow({ workflowId: 'stored_id' }), { id: 'newer', workflowId: 'stored_id', version: 5, enabled: true, lifecycle: 'published' }])
    const scanAuditLog = scanOf([created('deal-1', '2026-08-01T10:00:00.000Z')])
    const result = await runDone(proposal({ workflowId: 'renamed_in_form' }), { scanAuditLog })
    expect(findOneWithDecryption).toHaveBeenCalledWith(expect.anything(), expect.anything(), { id: ARTIFACT, tenantId: TENANT, organizationId: ORG, deletedAt: null }, undefined, SCOPE)
    expect(findWithDecryption).toHaveBeenCalledWith(expect.anything(), expect.anything(), { workflowId: 'stored_id', tenantId: TENANT, organizationId: ORG, deletedAt: null }, expect.objectContaining({ fields: expect.arrayContaining(['version', 'enabled', 'lifecycle']) }), SCOPE)
    expect(cellsOf(result.result, 'deal_events:customers.deal.created')).toEqual({ would_start: 0, would_not_start: 1, debounced: 0, cannot_tell: 0 })
    expect(groupOf(result.result, 'deal_events:customers.deal.created').warnings).toEqual(['workflows.simulation.warnings.notLiveVersion'])
    expect(groupOf(result.result, 'deal_events:customers.deal.created').dataWarnings).toEqual([])
  })
})

describe('runTriggerBacktestSlice', () => {
  it('replays audit events in time order through every matching trigger, with debounce and samples', async () => {
    const input = proposal({
      triggers: [
        trigger({ config: { debounceMs: HOUR } }),
        trigger({ triggerId: 'big_updates', eventPattern: 'customers.deal.updated', config: { filterConditions: [{ field: 'id', operator: 'in', value: ['deal-1'] }] } }),
      ],
    })
    const scanAuditLog = scanOf(
      [created('deal-1', '2026-08-01T10:00:00.000Z'), updated('deal-1', '2026-08-01T10:05:00.000Z'), created('deal-2', '2026-08-01T10:06:00.000Z')],
      [updated('deal-2', '2026-08-01T12:00:00.000Z'), updated('deal-1', '2026-08-01T12:00:00.000Z')],
    )
    const result = await runDone(input, { scanAuditLog })
    expect(scanAuditLog).toHaveBeenCalledWith({ resourceKinds: ['customers.deal'], after: null, limit: 500 })
    expect(cellsOf(result.result, 'deal_events:customers.deal.created')).toEqual({ would_start: 2, would_not_start: 0, debounced: 0, cannot_tell: 0 })
    expect(cellsOf(result.result, 'deal_events:customers.deal.updated')).toEqual({ would_start: 2, would_not_start: 0, debounced: 1, cannot_tell: 0 })
    expect(cellsOf(result.result, 'big_updates:customers.deal.updated')).toEqual({ would_start: 2, would_not_start: 1, debounced: 0, cannot_tell: 0 })
    const createdGroup = groupOf(result.result, 'deal_events:customers.deal.created')
    expect(createdGroup.sampleResourceKind).toBe('customers.deal')
    expect(createdGroup.cells.find((cell) => cell.key === 'would_start')?.sampleIds).toEqual(['deal-1', 'deal-2'])
    expect(result.result.fidelity).toBe('reconstructed')
    expect(result.result.coverage).toEqual(expect.objectContaining({ reconstructed_entries: 5, reconstructed_events: 5 }))
    expect(result.result.caveats).toEqual([
      'workflows.simulation.caveats.firstOrder',
      'workflows.simulation.caveats.queueClock',
      'workflows.simulation.caveats.debounceProcess',
      'workflows.simulation.caveats.reconstructed',
    ])
    expect(result.recordsProcessed).toBe(5)
    expect(result.result.groups.map((group) => group.key)).toEqual([
      'deal_events:customers.deal.created',
      'deal_events:customers.deal.updated',
      'big_updates:customers.deal.updated',
    ])
  })

  it('keeps debounce windows across slices and resumes from the cursor', async () => {
    const input = proposal({ triggers: [trigger({ config: { debounceMs: HOUR } })] })
    let now = NOW
    const scanAuditLog = jest.fn()
      .mockImplementationOnce(async () => {
        now = NOW + 20_000
        return { entries: [created('deal-1', '2026-08-01T10:00:00.000Z')], lastCursor: { createdAt: '2026-08-01T10:00:00.000Z', id: 'c1' }, exhausted: false, payloadBytes: 0, undecryptable: 0 }
      })
      .mockImplementationOnce(async () => ({ entries: [updated('deal-1', '2026-08-01T10:30:00.000Z')], lastCursor: { createdAt: '2026-08-01T10:30:00.000Z', id: 'c2' }, exhausted: true, payloadBytes: 0, undecryptable: 0 }))
    const first = await runTriggerBacktestSlice(input, context({ scanAuditLog, now: () => now }))
    expect(first.status).toBe('continue')
    if (first.status !== 'continue') return
    const persisted = JSON.parse(JSON.stringify(first.state)) as TriggerBacktestState
    expect(persisted.auditCursor).toEqual({ createdAt: '2026-08-01T10:00:00.000Z', id: 'c1' })
    expect(Object.keys(persisted.debounce.windows)).toHaveLength(1)
    findOneWithDecryption.mockClear()
    const second = await runTriggerBacktestSlice(input, context({ scanAuditLog, state: persisted, now: () => now, budget: { recordsRemaining: 999, sliceDeadlineAt: now + 10_000, runDeadlineAt: now + 60_000, maxBatchRows: 500, maxBatchBytes: 1_000_000 } }))
    expect(second.status).toBe('done')
    if (second.status !== 'done') return
    expect(findOneWithDecryption).not.toHaveBeenCalled()
    expect(scanAuditLog).toHaveBeenLastCalledWith({ resourceKinds: ['customers.deal'], after: { createdAt: '2026-08-01T10:00:00.000Z', id: 'c1' }, limit: 500 })
    expect(cellsOf(second.result, 'deal_events:customers.deal.updated')).toEqual({ would_start: 0, would_not_start: 0, debounced: 1, cannot_tell: 0 })
  })

  it('ends truncated when the record budget or the run deadline is reached', async () => {
    const scanAuditLog = scanOf([created('deal-1', '2026-08-01T10:00:00.000Z'), created('deal-2', '2026-08-01T10:01:00.000Z'), created('deal-3', '2026-08-01T10:02:00.000Z')])
    const result = await runDone(proposal(), { scanAuditLog, budget: { recordsRemaining: 2, sliceDeadlineAt: NOW + 10_000, runDeadlineAt: NOW + 60_000, maxBatchRows: 500, maxBatchBytes: 1_000_000 } })
    expect(scanAuditLog).toHaveBeenCalledWith(expect.objectContaining({ limit: 2 }))
    expect(result.result.truncated).toBe(true)
    expect(result.result.caveats).toContain('workflows.simulation.caveats.truncated')
    expect(result.recordsProcessed).toBe(2)
    const late = await runDone(proposal(), { scanAuditLog: scanOf([created('deal-1', '2026-08-01T10:00:00.000Z')]), now: () => NOW + 100_000 })
    expect(late.result.truncated).toBe(true)
  })

  it('reports cannot_tell for maxConcurrentInstances and blocking START pre-conditions, with warnings', async () => {
    const entries = [created('deal-1', '2026-08-01T10:00:00.000Z'), created('deal-2', '2026-08-01T10:01:00.000Z')]
    const limited = await runDone(proposal({ triggers: [trigger({ config: { maxConcurrentInstances: 3 } })] }), { scanAuditLog: scanOf(entries) })
    expect(cellsOf(limited.result, 'deal_events:customers.deal.created')).toEqual({ would_start: 0, would_not_start: 0, debounced: 0, cannot_tell: 2 })
    expect(groupOf(limited.result, 'deal_events:customers.deal.created').warnings).toEqual(['workflows.simulation.warnings.maxConcurrentInstances'])
    const guarded = await runDone(proposal({ startPreConditions: [{ ruleId: 'deal_check' }] }), { scanAuditLog: scanOf(entries) })
    expect(cellsOf(guarded.result, 'deal_events:customers.deal.created').cannot_tell).toBe(2)
    expect(groupOf(guarded.result, 'deal_events:customers.deal.created').warnings).toEqual(['workflows.simulation.warnings.startPreConditions'])
    const optional = await runDone(proposal({ startPreConditions: [{ ruleId: 'deal_check', required: false }] }), { scanAuditLog: scanOf(entries) })
    expect(cellsOf(optional.result, 'deal_events:customers.deal.created').would_start).toBe(2)
  })

  it('warns about triggers that never match, listen to excluded or unrebuildable events, or saw no events', async () => {
    const input = proposal({
      triggers: [
        trigger({ triggerId: 'never', eventPattern: 'customers.deal.created', config: { filterConditions: [{ field: 'status', operator: 'eq', value: 'won' }] } }),
        trigger({ triggerId: 'internal', eventPattern: 'workflows.*.*' }),
        trigger({ triggerId: 'unknown', eventPattern: 'catalog.product.created' }),
        trigger({ triggerId: 'quiet', eventPattern: 'customers.deal.deleted' }),
        trigger({ triggerId: 'off', eventPattern: 'customers.deal.created', enabled: false }),
        trigger({ triggerId: 'proto', eventPattern: 'customers.deal.created', config: { filterConditions: [{ field: 'constructor', operator: 'exists', value: null }] } }),
      ],
    })
    const result = await runDone(input, { scanAuditLog: scanOf([created('deal-1', '2026-08-01T10:00:00.000Z')]) })
    expect(groupOf(result.result, 'never:customers.deal.created').dataWarnings).toEqual(['workflows.simulation.warnings.neverMatches'])
    expect(groupOf(result.result, 'internal').warnings).toEqual(['workflows.simulation.warnings.excludedEvents'])
    expect(groupOf(result.result, 'unknown').warnings).toEqual(['workflows.simulation.warnings.noAdapter'])
    expect(groupOf(result.result, 'quiet').dataWarnings).toEqual(['workflows.simulation.warnings.noEvents'])
    expect(groupOf(result.result, 'quiet').cells.every((cell) => cell.count === 0)).toBe(true)
    expect(groupOf(result.result, 'off:customers.deal.created').warnings).toEqual(['workflows.simulation.warnings.triggerDisabled'])
    expect(cellsOf(result.result, 'off:customers.deal.created').would_not_start).toBe(1)
    expect(cellsOf(result.result, 'proto:customers.deal.created').cannot_tell).toBe(1)
    expect(groupOf(result.result, 'proto:customers.deal.created').dataWarnings).toEqual(['workflows.simulation.warnings.prototypePath'])
  })

  it('warns and stops claiming debounce outcomes when a pattern selects events the replay cannot rebuild', async () => {
    declaredEventIds.push('customers.deal.won')
    const input = proposal({
      triggers: [
        trigger({ config: { debounceMs: HOUR } }),
        trigger({ triggerId: 'plain', eventPattern: 'customers.deal.*' }),
        trigger({ triggerId: 'exact', eventPattern: 'customers.deal.created', config: { debounceMs: HOUR } }),
      ],
    })
    const result = await runDone(input, { scanAuditLog: scanOf([created('deal-1', '2026-08-01T10:00:00.000Z'), updated('deal-1', '2026-08-01T10:01:00.000Z')]) })
    expect(cellsOf(result.result, 'deal_events:customers.deal.created')).toEqual({ would_start: 0, would_not_start: 0, debounced: 0, cannot_tell: 1 })
    expect(cellsOf(result.result, 'deal_events:customers.deal.updated').cannot_tell).toBe(1)
    expect(groupOf(result.result, 'deal_events:customers.deal.created').warnings).toEqual(['workflows.simulation.warnings.partialEvents'])
    expect(cellsOf(result.result, 'plain:customers.deal.updated').would_start).toBe(1)
    expect(groupOf(result.result, 'plain:customers.deal.updated').warnings).toEqual(['workflows.simulation.warnings.partialEvents'])
    expect(cellsOf(result.result, 'exact:customers.deal.created').would_start).toBe(1)
    expect(groupOf(result.result, 'exact:customers.deal.created').warnings).toEqual([])
    expect(result.result.caveats).toContain('workflows.simulation.caveats.partialEvents')
    expect(result.result.coverage).toEqual(expect.objectContaining({ unreplayed_event_types: 1 }))
  })

  it('reads person events with an unknown payload id as cannot_tell under debounce and samples the record id', async () => {
    const input = proposal({ triggers: [trigger({ triggerId: 'people', eventPattern: 'customers.person.updated', config: { debounceMs: HOUR } })] })
    const scanAuditLog = scanOf([auditEntry({ resourceKind: 'customers.person', resourceId: 'person-1', commandId: 'customers.people.update' })])
    const result = await runDone(input, { scanAuditLog })
    expect(scanAuditLog).toHaveBeenCalledWith(expect.objectContaining({ resourceKinds: ['customers.person'] }))
    const group = groupOf(result.result, 'people:customers.person.updated')
    expect(group.cells.find((cell) => cell.key === 'cannot_tell')).toEqual({ key: 'cannot_tell', count: 1, sampleIds: ['person-1'] })
    expect(triggerSampleRecordId({ id: 'profile-1', entityId: 'entity-1' }, [])).toBe('entity-1')
    expect(triggerSampleRecordId({ id: 'deal-1' }, [])).toBe('deal-1')
    expect(triggerSampleRecordId({ id: 'profile-1' }, ['id'])).toBeNull()
  })

  it('names legacy trigger rows and a shadowed code workflow in the caveats', async () => {
    emCount.mockResolvedValueOnce(2)
    const legacy = await runDone(proposal(), { scanAuditLog: scanOf([]) })
    expect(emCount).toHaveBeenCalledWith(expect.anything(), { workflowDefinitionId: { $in: [ARTIFACT] }, tenantId: TENANT, organizationId: ORG, enabled: true, deletedAt: null })
    expect(legacy.result.caveats).toContain('workflows.simulation.caveats.legacyTriggers')
    registerCodeWorkflowEntries([{ workflowId: 'deal_followup', workflowName: 'Code', description: null, version: 1, enabled: true, metadata: null, moduleId: 'test', definition: { steps: [], transitions: [], triggers: [{ triggerId: 'code_trigger', name: 'Code', eventPattern: 'customers.deal.created', enabled: true, priority: 0 }] } as never }])
    findWithDecryption.mockResolvedValueOnce([])
    const shadowing = await runDone(proposal(), { scanAuditLog: scanOf([]), artifactId: null })
    expect(shadowing.result.caveats).toContain('workflows.simulation.caveats.shadowsCodeTriggers')
  })

  it('has no side effects: no instance started, no event emitted, no write', async () => {
    const scanAuditLog = scanOf([created('deal-1', '2026-08-01T10:00:00.000Z')])
    await runTriggerBacktestSlice(proposal({ triggers: [trigger({ config: { debounceMs: HOUR } })] }), context({ scanAuditLog }))
    expect(startWorkflow).not.toHaveBeenCalled()
    expect(executeWorkflow).not.toHaveBeenCalled()
    expect(processEventTriggers).not.toHaveBeenCalled()
    for (const write of Object.values(emWrites)) expect(write).not.toHaveBeenCalled()
    for (const file of ['trigger-backtest.ts', 'trigger-filter-tri.ts']) {
      const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
      expect(source).not.toMatch(/startWorkflow\(|executeWorkflow\(|processEventTriggers\(|from '[^']*workflow-executor'|from '[^']*event-trigger-service'|emitEvent\(|eventBus|commandBus|\.persist\(|\.flush\(|nativeUpdate|nativeDelete|\.insert\(|\.remove\(/)
    }
  })
})

describe('triggerBacktestKind contract', () => {
  it('requires the definitions view feature, the listened record types\' view features and the four cells', () => {
    expect(triggerBacktestKind.requiredFeatures).toEqual(['workflows.definitions.view'])
    expect(triggerBacktestKind.cellKeys).toEqual([...TRIGGER_BACKTEST_CELLS])
    expect(triggerBacktestKind.inputFeatures!(proposal(), { eventAdapters: ADAPTERS })).toEqual(['customers.deals.view'])
    expect(triggerBacktestKind.inputFeatures!(proposal({ triggers: [trigger({ eventPattern: '*' })] }), { eventAdapters: ADAPTERS }).sort()).toEqual(['customers.deals.view', 'customers.people.view'])
    expect(triggerBacktestKind.inputSchema.safeParse({ workflowId: 'x', version: 1, triggers: [trigger(), trigger()] }).success).toBe(false)
    expect(triggerBacktestKind.inputSchema.safeParse({ workflowId: 'x', version: 1, triggers: [trigger({ eventPattern: 'bad pattern' })] }).success).toBe(false)
  })

  it('answers 422 not_customized for code definitions and unsupported_event_payload when no trigger has an adapter', async () => {
    registerCodeWorkflowEntries([{ workflowId: 'code_flow', workflowName: 'Code', description: null, version: 1, enabled: true, metadata: null, moduleId: 'test', definition: { steps: [], transitions: [] } as never }])
    const validate = triggerBacktestKind.validate!
    const ctx = { em: {} as never, scope: SCOPE, eventAdapters: ADAPTERS }
    expect(classifyCodeArtifactId('code:code_flow')).toBe('not_customized')
    expect(classifyCodeArtifactId('code:gone')).toBe('artifact_not_found')
    expect(classifyCodeArtifactId(codeWorkflowUuid('code_flow'))).toBe('not_customized')
    expect(classifyCodeArtifactId(ARTIFACT)).toBeNull()
    await expect(validate(proposal(), { ...ctx, artifactId: 'code:code_flow' })).resolves.toEqual({ ok: false, code: 'not_customized' })
    await expect(validate(proposal(), { ...ctx, artifactId: codeWorkflowUuid('code_flow') })).resolves.toEqual({ ok: false, code: 'not_customized' })
    await expect(validate(proposal(), { ...ctx, artifactId: null })).resolves.toEqual({ ok: true })
    await expect(validate(proposal({ triggers: [trigger({ eventPattern: 'catalog.product.created' })] }), { ...ctx, artifactId: null })).resolves.toEqual({ ok: false, code: 'unsupported_event_payload' })
    await expect(validate(proposal({ triggers: [] }), { ...ctx, artifactId: null })).resolves.toEqual({ ok: false, code: 'unsupported_event_payload' })
    findOneWithDecryption.mockResolvedValueOnce(artifactRow({ kind: 'component' }))
    await expect(validate(proposal(), { ...ctx, artifactId: ARTIFACT })).resolves.toEqual({ ok: false, code: 'invalid_proposal' })
    await expect(validate(proposal(), { ...ctx, artifactId: ARTIFACT })).resolves.toEqual({ ok: true })
  })

  it('reads the artifact version by id or by workflow id + version, scoped, fingerprinting the saved triggers', async () => {
    const saved = artifactRow({
      version: 2,
      enabled: true,
      definition: {
        steps: [{ stepId: 'start', stepType: 'START', preConditions: [{ ruleId: 'deal_check', required: true, validationMessage: { en: 'No' } }] }],
        transitions: [],
        triggers: [{ ...trigger({ config: { debounceMs: HOUR, contextMapping: [{ targetKey: 'dealId', sourceExpression: 'id' }] } }), name: 'Renamed', description: 'Changed' }],
      },
    })
    const input = proposal({ version: 2, triggers: [trigger({ config: { debounceMs: HOUR } })], startPreConditions: [{ ruleId: 'deal_check' }] })
    findOneWithDecryption.mockResolvedValueOnce(saved)
    const byId = await triggerBacktestKind.readArtifactVersion({ em: {} as never, scope: SCOPE }, { artifactId: ARTIFACT, input })
    expect(byId).toEqual({ artifactId: ARTIFACT, updatedAt: '2026-10-09T10:00:00.000Z', fingerprint: fingerprintWorkflowDefinition(saved as never) })
    expect(byId?.fingerprint).toBe(fingerprintTriggerProposal(input))
    expect(await triggerBacktestKind.readArtifactVersion({ em: {} as never, scope: SCOPE }, { artifactId: 'code:x', input })).toBeNull()
    findOneWithDecryption.mockResolvedValueOnce(null)
    expect(await triggerBacktestKind.readArtifactVersion({ em: {} as never, scope: SCOPE }, { artifactId: null, input })).toBeNull()
    expect(findOneWithDecryption).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), { workflowId: 'deal_followup', version: 2, tenantId: TENANT, organizationId: ORG, deletedAt: null }, undefined, SCOPE)
  })

  it('fingerprints what decides a start, not names or mappings', () => {
    const input = proposal()
    expect(fingerprintTriggerProposal(proposal({ triggers: [trigger({ name: 'Other name', description: 'x', priority: 9 })] }))).toBe(fingerprintTriggerProposal(input))
    expect(fingerprintTriggerProposal(proposal({ triggers: [trigger({ config: { debounceMs: 0 } })] }))).toBe(fingerprintTriggerProposal(input))
    for (const changed of [
      proposal({ enabled: false }),
      proposal({ version: 2 }),
      proposal({ triggers: [trigger({ enabled: false })] }),
      proposal({ triggers: [trigger({ eventPattern: 'customers.deal.created' })] }),
      proposal({ triggers: [trigger({ config: { debounceMs: 10 } })] }),
      proposal({ triggers: [trigger({ config: { maxConcurrentInstances: 1 } })] }),
      proposal({ triggers: [trigger({ config: { filterConditions: [{ field: 'id', operator: 'eq', value: 'x' }] } })] }),
      proposal({ startPreConditions: [{ ruleId: 'deal_check' }] }),
    ]) {
      expect(fingerprintTriggerProposal(changed)).not.toBe(fingerprintTriggerProposal(input))
    }
  })

  it('links back to the workflow editor of a saved definition only', () => {
    expect(triggerBacktestKind.applyHref!({ artifactId: ARTIFACT, runId: 'run-1' })).toBe(`/backend/definitions/visual-editor?id=${ARTIFACT}&simulationRunId=run-1`)
    expect(triggerBacktestKind.applyHref!({ artifactId: null, runId: 'run-1' })).toBeNull()
  })
})
