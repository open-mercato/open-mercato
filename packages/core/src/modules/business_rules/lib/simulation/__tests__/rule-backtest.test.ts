import fs from 'node:fs'
import path from 'node:path'

const readObservedRuleLogs = jest.fn()
const findObservedCoverage = jest.fn()
const findWithDecryption = jest.fn()
const findOneWithDecryption = jest.fn()
const executeActions = jest.fn()
const executeRules = jest.fn()
const executeSingleRule = jest.fn()
const logRuleExecution = jest.fn()

jest.mock('../observed', () => {
  const actual = jest.requireActual('../observed')
  return {
    ...actual,
    readObservedRuleLogs: (...args: unknown[]) => readObservedRuleLogs(...args),
    findObservedCoverage: (...args: unknown[]) => findObservedCoverage(...args),
  }
})
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => findWithDecryption(...args),
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryption(...args),
}))
jest.mock('../../action-executor', () => ({ executeActions: (...args: unknown[]) => executeActions(...args) }))
jest.mock('../../rule-engine', () => {
  const actual = jest.requireActual('../../rule-engine')
  return {
    ...actual,
    executeRules: (...args: unknown[]) => executeRules(...args),
    executeSingleRule: (...args: unknown[]) => executeSingleRule(...args),
    logRuleExecution: (...args: unknown[]) => logRuleExecution(...args),
  }
})

import { createCrudEventAdapters, type RegisteredSimulationEventAdapter, type SimulationAuditEntry, type SimulationRunContext } from '@open-mercato/shared/modules/insights/simulate'
import { businessRuleDefinitionSchema, type BusinessRuleDefinitionInput } from '../../../data/validators'
import { computeRuleDefinitionHash } from '../../definition-hash'
import { CRUD_RULE_TRIGGER_SUBSCRIBER_ID } from '../observed'
import {
  RULE_LIMIT_EXCEEDED_FLAG,
  evaluateBacktestEvent,
  fingerprintRuleProposal,
  isProposalDiscovered,
  resolveSampleRecordId,
  ruleBacktestKind,
  runRuleBacktestSlice,
  type RuleBacktestState,
} from '../rule-backtest'

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const SCOPE = { tenantId: TENANT, organizationId: ORG }
const ARTIFACT = '33333333-3333-4333-8333-333333333333'
const NOW = Date.parse('2026-10-10T12:00:00Z')
const WINDOW = { from: new Date('2026-07-01T00:00:00Z'), to: new Date('2026-10-01T00:00:00Z') }

function proposal(overrides: Record<string, unknown> = {}): BusinessRuleDefinitionInput {
  return businessRuleDefinitionSchema.parse({
    ruleId: 'DEAL_WON',
    ruleName: 'Deal won',
    ruleType: 'ACTION',
    entityType: 'customers.deal',
    eventType: 'updated',
    conditionExpression: { field: 'status', operator: '=', value: 'won' },
    successActions: [{ type: 'LOG', config: { message: 'won' } }],
    failureActions: [{ type: 'LOG', config: { message: 'not won' } }],
    ...overrides,
  })
}

function observedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '1',
    entityId: 'deal-1',
    entityType: 'customers.deal',
    eventType: 'updated',
    executedAt: '2026-08-01T10:00:00.000000Z',
    data: { id: 'deal-1', organizationId: ORG, tenantId: TENANT },
    dataHash: 'hash-1',
    innermostFrameKind: 'subscriber',
    innermostFrameId: CRUD_RULE_TRIGGER_SUBSCRIBER_ID,
    correlationId: 'corr-1',
    causedByLogId: null,
    payloadBytes: 10,
    ...overrides,
  }
}

function auditEntry(overrides: Partial<SimulationAuditEntry> = {}): SimulationAuditEntry {
  return {
    logId: '44444444-4444-4444-8444-444444444444',
    at: '2026-08-02T10:00:00.000Z',
    commandId: 'customers.deals.update',
    actionType: 'edit',
    executionState: 'done',
    actorUserId: null,
    resourceKind: 'customers.deal',
    resourceId: 'deal-2',
    snapshotBefore: null,
    snapshotAfter: null,
    changes: null,
    causeKind: 'user',
    organizationId: ORG,
    correlationId: 'corr-2',
    causedByLogId: null,
    actorKind: 'user',
    ...overrides,
  }
}

const DEAL_ADAPTERS: RegisteredSimulationEventAdapter[] = createCrudEventAdapters({
  eventPrefix: 'customers.deal',
  logResourceKinds: ['customers.deal'],
  requiredFeatures: ['customers.deals.view'],
  syncOrigin: false,
}).map((adapter) => ({ ...adapter, moduleId: 'customers' }))

function context(overrides: Partial<SimulationRunContext<RuleBacktestState>> = {}): SimulationRunContext<RuleBacktestState> {
  return {
    em: { getKysely: () => ({}) } as never,
    scope: SCOPE,
    requesterUserId: '55555555-5555-4555-8555-555555555555',
    artifactId: ARTIFACT,
    window: WINDOW,
    budget: { recordsRemaining: 1000, sliceDeadlineAt: NOW + 10_000, runDeadlineAt: NOW + 60_000, maxBatchRows: 500, maxBatchBytes: 1_000_000 },
    state: null,
    now: () => NOW,
    hasFeatures: async () => true,
    eventAdapters: DEAL_ADAPTERS,
    scanAuditLog: jest.fn(async () => ({ entries: [], lastCursor: null, exhausted: true, payloadBytes: 0, undecryptable: 0 })),
    ...overrides,
  }
}

function cellsOf(result: { groups: Array<{ key: string; cells: Array<{ key: string; count: number }> }> }, key: string): Record<string, number> {
  const group = result.groups.find((entry) => entry.key === key)
  return Object.fromEntries((group?.cells ?? []).map((cell) => [cell.key, cell.count]))
}

beforeEach(() => {
  jest.clearAllMocks()
  findWithDecryption.mockResolvedValue([])
  findObservedCoverage.mockResolvedValue([])
  readObservedRuleLogs.mockResolvedValue({ rows: [], lastCursor: null, exhausted: true, payloadBytes: 0 })
})

describe('rule backtest discovery semantics (S5, S6)', () => {
  const at = new Date('2026-08-01T00:00:00Z')

  it('matches the event type by equality: a null event type never runs on CRUD events', () => {
    expect(isProposalDiscovered(proposal(), 'customers.deal', 'updated', at)).toBe(true)
    expect(isProposalDiscovered(proposal({ eventType: null }), 'customers.deal', 'updated', at)).toBe(false)
    expect(isProposalDiscovered(proposal({ eventType: '' }), 'customers.deal', 'updated', at)).toBe(false)
    expect(isProposalDiscovered(proposal(), 'customers.deal', 'created', at)).toBe(false)
    expect(isProposalDiscovered(proposal(), 'customers.person', 'updated', at)).toBe(false)
    expect(isProposalDiscovered(proposal({ enabled: false }), 'customers.deal', 'updated', at)).toBe(false)
  })

  it('applies effective windows at the event time, not now', () => {
    const windowed = proposal({ effectiveFrom: '2026-07-15T00:00:00Z', effectiveTo: '2026-07-31T00:00:00Z' })
    expect(isProposalDiscovered(windowed, 'customers.deal', 'updated', new Date('2026-07-20T00:00:00Z'))).toBe(true)
    expect(isProposalDiscovered(windowed, 'customers.deal', 'updated', at)).toBe(false)
  })

  it('evaluates absent payload fields exactly as production: a status condition on a CRUD payload fails', () => {
    const event = { eventId: 'customers.deal.updated', eventType: 'updated', entityId: 'deal-1', sampleId: 'deal-1', at, payload: { id: 'deal-1' }, unknownPaths: [] }
    expect(evaluateBacktestEvent(proposal(), 'customers.deal', event, [])).toEqual({ cell: 'runs_failure_actions', discovered: true, ruleLimitExceeded: false })
    expect(evaluateBacktestEvent(proposal({ failureActions: null }), 'customers.deal', event, []).cell).toBe('does_not_fire')
    expect(evaluateBacktestEvent(proposal({ conditionExpression: { field: 'status', operator: 'IS_EMPTY', value: null } }), 'customers.deal', event, []).cell).toBe('fires')
    expect(evaluateBacktestEvent(proposal({ conditionExpression: null }), 'customers.deal', event, []).cell).toBe('fires')
    expect(evaluateBacktestEvent(proposal(), 'customers.deal', { ...event, unknownPaths: ['status'] }, []).cell).toBe('cannot_tell')
    expect(evaluateBacktestEvent(proposal(), 'customers.deal', { ...event, payload: { status: '[REDACTED]' } }, []).cell).toBe('cannot_tell')
  })

  it('resolves {{now}} from the event time', () => {
    const event = { eventId: 'customers.deal.updated', eventType: 'updated', entityId: 'deal-1', sampleId: 'deal-1', at, payload: { closedAt: '2026-07-31T00:00:00.000Z' }, unknownPaths: [] }
    const beforeNow = proposal({ conditionExpression: { field: 'closedAt', operator: '<', value: '{{now}}' } })
    expect(evaluateBacktestEvent(beforeNow, 'customers.deal', event, []).cell).toBe('fires')
    expect(evaluateBacktestEvent(beforeNow, 'customers.deal', { ...event, at: new Date('2026-07-30T00:00:00Z') }, []).cell).toBe('runs_failure_actions')
  })

  it('stops every rule when the proposal makes more than 100 rules match, counting only rules effective at that time', () => {
    const event = { eventId: 'customers.deal.updated', eventType: 'updated', entityId: 'deal-1', sampleId: 'deal-1', at, payload: { status: 'won' }, unknownPaths: [] }
    const effective = Array.from({ length: 100 }, (_value, index) => ({ id: `rule-${index}`, eventType: 'updated', effectiveFrom: null, effectiveTo: null }))
    expect(evaluateBacktestEvent(proposal(), 'customers.deal', event, effective)).toEqual({ cell: 'does_not_fire', discovered: true, ruleLimitExceeded: true })
    const expired = effective.map((rule, index) => (index === 0 ? { ...rule, effectiveTo: new Date('2026-07-01T00:00:00Z') } : rule))
    expect(evaluateBacktestEvent(proposal(), 'customers.deal', event, expired).cell).toBe('fires')
    const otherEvent = effective.map((rule, index) => (index === 0 ? { ...rule, eventType: 'created' } : rule))
    expect(evaluateBacktestEvent(proposal(), 'customers.deal', event, otherEvent).cell).toBe('fires')
  })
})

describe('runRuleBacktestSlice', () => {
  it('counts observed CRUD-trigger events once, excludes other sources and uses executed_at as the clock', async () => {
    readObservedRuleLogs.mockResolvedValueOnce({
      rows: [
        observedRow(),
        observedRow({ id: '2' }),
        observedRow({ id: '3', innermostFrameKind: 'user', innermostFrameId: null }),
        observedRow({ id: '4', eventType: null }),
        observedRow({ id: '5', entityId: 'deal-5', data: { id: 'deal-5', status: 'won' }, dataHash: 'hash-5', correlationId: 'corr-5' }),
      ],
      lastCursor: { executedAt: '2026-08-01T10:00:00.000000Z', id: '5' },
      exhausted: true,
      payloadBytes: 50,
    })
    const ctx = context({ eventAdapters: [] })
    const result = await runRuleBacktestSlice(proposal(), ctx)
    expect(result.status).toBe('done')
    if (result.status !== 'done') return
    expect(cellsOf(result.result, 'customers.deal.updated')).toEqual({ fires: 1, does_not_fire: 0, runs_failure_actions: 1, cannot_tell: 0 })
    expect(result.result.coverage).toEqual(expect.objectContaining({ observed_rows: 5, observed_excluded_rows: 1, observed_rows_without_event_type: 1, observed_duplicate_rows: 1, observed_events: 2, reconstructed_events: 0 }))
    expect(result.result.fidelity).toBe('observed')
    expect(result.recordsProcessed).toBe(2)
    expect(readObservedRuleLogs).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ tenantId: TENANT, organizationId: ORG, entityType: 'customers.deal', from: WINDOW.from, to: WINDOW.to, after: null }))
    const group = result.result.groups[0]
    expect(group.cells.find((cell) => cell.key === 'fires')?.sampleIds).toEqual(['deal-5'])
    expect(group.sampleResourceKind).toBe('customers.deal')
  })

  it('dedupes observed rows by time, not by page: a repeat within 10 minutes is a duplicate, a later one counts again', async () => {
    const rows = [
      observedRow({ id: '1', executedAt: '2026-08-01T10:00:00.000000Z' }),
      observedRow({ id: '2', executedAt: '2026-08-01T10:05:00.000000Z' }),
      observedRow({ id: '3', executedAt: '2026-08-01T10:20:00.000000Z' }),
      observedRow({ id: '4', executedAt: '2026-08-01T10:29:00.000000Z' }),
      observedRow({ id: '5', executedAt: '2026-08-01T11:00:00.000000Z' }),
    ]
    const countWithPageSize = async (size: number) => {
      readObservedRuleLogs.mockReset()
      for (let start = 0; start < rows.length; start += size) {
        const page = rows.slice(start, start + size)
        const last = page[page.length - 1]
        readObservedRuleLogs.mockResolvedValueOnce({ rows: page, lastCursor: { executedAt: last.executedAt, id: last.id }, exhausted: start + size >= rows.length, payloadBytes: 10 })
      }
      const result = await runRuleBacktestSlice(proposal(), context({ eventAdapters: [] }))
      expect(result.status).toBe('done')
      if (result.status !== 'done') throw new Error('[internal] expected a finished backtest')
      return { events: result.result.coverage.observed_events, duplicates: result.result.coverage.observed_duplicate_rows }
    }
    const expected = { events: 3, duplicates: 2 }
    expect(await countWithPageSize(5)).toEqual(expected)
    expect(await countWithPageSize(2)).toEqual(expected)
    expect(await countWithPageSize(1)).toEqual(expected)
  })

  it('rebuilds events from audit history, skipping events the observed tier already covered', async () => {
    readObservedRuleLogs.mockResolvedValueOnce({ rows: [observedRow()], lastCursor: { executedAt: '2026-08-01T10:00:00.000000Z', id: '1' }, exhausted: true, payloadBytes: 10 })
    findObservedCoverage.mockResolvedValueOnce([
      { eventType: 'updated', entityId: 'deal-1', correlationId: 'corr-1', causedByLogId: null, innermostFrameKind: 'subscriber', innermostFrameId: CRUD_RULE_TRIGGER_SUBSCRIBER_ID },
    ])
    const scanAuditLog = jest.fn(async () => ({
      entries: [
        auditEntry({ resourceId: 'deal-1', correlationId: 'corr-1' }),
        auditEntry({ logId: '66666666-6666-4666-8666-666666666666', resourceId: 'deal-2', correlationId: 'corr-2' }),
        auditEntry({ logId: '77777777-7777-4777-8777-777777777777', resourceId: 'deal-3', actionType: 'create', commandId: 'customers.deals.create' }),
        auditEntry({ logId: '88888888-8888-4888-8888-888888888888', resourceId: 'deal-4', actionType: 'system' }),
      ],
      lastCursor: { createdAt: '2026-08-02T10:00:00.000000Z', id: '88888888-8888-4888-8888-888888888888' },
      exhausted: true,
      payloadBytes: 100,
      undecryptable: 1,
    }))
    const result = await runRuleBacktestSlice(proposal(), context({ scanAuditLog }))
    expect(result.status).toBe('done')
    if (result.status !== 'done') return
    expect(scanAuditLog).toHaveBeenCalledWith({ resourceKinds: ['customers.deal'], after: null, limit: 500 })
    expect(cellsOf(result.result, 'customers.deal.updated')).toEqual({ fires: 0, does_not_fire: 0, runs_failure_actions: 2, cannot_tell: 0 })
    expect(cellsOf(result.result, 'customers.deal.created')).toEqual({ fires: 0, does_not_fire: 1, runs_failure_actions: 0, cannot_tell: 0 })
    expect(result.result.coverage).toEqual(expect.objectContaining({
      reconstructed_entries: 4,
      reconstructed_covered_by_observed: 1,
      reconstructed_entries_without_event: 1,
      undecryptable_entries: 1,
      observed_events: 1,
      reconstructed_events: 2,
    }))
    expect(result.result.fidelity).toBe('mixed')
    const created = result.result.groups.find((group) => group.key === 'customers.deal.created')
    expect(created?.warnings).toEqual(['business_rules.simulation.warnings.eventTypeMismatch'])
    const updated = result.result.groups.find((group) => group.key === 'customers.deal.updated')
    expect(updated?.dataWarnings).toEqual(['business_rules.simulation.warnings.neverFires', 'business_rules.simulation.warnings.failureActionsEveryEvent'])
    expect(result.result.caveats).toEqual(expect.arrayContaining(['business_rules.simulation.caveats.firstOrder', 'business_rules.simulation.caveats.reconstructed', 'business_rules.simulation.caveats.observedSanitized']))
  })

  it('treats adapter-declared unknown paths as cannot_tell and narrows adapters by command id', async () => {
    const adapters: RegisteredSimulationEventAdapter[] = [{
      moduleId: 'customers',
      eventId: 'customers.deal.won',
      logResourceKinds: ['customers.deal'],
      actionTypes: ['edit'],
      requiredFeatures: ['customers.deals.view'],
      commandIds: ['customers.deals.update'],
      payloadFrom: (entry) => ({ payload: { id: entry.resourceId }, unknownPaths: ['status'] }),
    }]
    const scanAuditLog = jest.fn(async () => ({
      entries: [auditEntry(), auditEntry({ resourceId: 'deal-9', commandId: 'customers.deals.other' })],
      lastCursor: null,
      exhausted: true,
      payloadBytes: 0,
      undecryptable: 0,
    }))
    const result = await runRuleBacktestSlice(proposal({ eventType: 'won' }), context({ eventAdapters: adapters, scanAuditLog }))
    expect(result.status).toBe('done')
    if (result.status !== 'done') return
    expect(cellsOf(result.result, 'customers.deal.won')).toEqual({ fires: 0, does_not_fire: 0, runs_failure_actions: 0, cannot_tell: 1 })
    expect(result.result.coverage.reconstructed_entries_without_event).toBe(1)
  })

  it('hands back a continuation at the slice deadline and resumes from it', async () => {
    let clock = NOW
    readObservedRuleLogs.mockImplementationOnce(async () => {
      clock = NOW + 20_000
      return { rows: [observedRow()], lastCursor: { executedAt: '2026-08-01T10:00:00.000000Z', id: '1' }, exhausted: false, payloadBytes: 10 }
    })
    const first = await runRuleBacktestSlice(proposal(), context({ now: () => clock, eventAdapters: [] }))
    expect(first.status).toBe('continue')
    if (first.status !== 'continue') return
    expect(first.state.observedCursor).toEqual({ executedAt: '2026-08-01T10:00:00.000000Z', id: '1' })
    expect(first.progress).toBeGreaterThan(0)
    expect(first.progress).toBeLessThanOrEqual(0.5)
    const resumed = JSON.parse(JSON.stringify(first.state)) as RuleBacktestState
    readObservedRuleLogs.mockResolvedValueOnce({ rows: [observedRow({ id: '2', dataHash: 'hash-1' }), observedRow({ id: '3', entityId: 'deal-3', dataHash: 'hash-3' })], lastCursor: { executedAt: '2026-08-01T10:00:01.000000Z', id: '3' }, exhausted: true, payloadBytes: 10 })
    const second = await runRuleBacktestSlice(proposal(), context({ state: resumed, eventAdapters: [] }))
    expect(second.status).toBe('done')
    if (second.status !== 'done') return
    expect(readObservedRuleLogs).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ after: { executedAt: '2026-08-01T10:00:00.000000Z', id: '1' } }))
    expect(cellsOf(second.result, 'customers.deal.updated').runs_failure_actions).toBe(2)
    expect(second.result.coverage.observed_duplicate_rows).toBe(1)
  })

  it('ends the run truncated when the record budget or the run deadline is reached', async () => {
    readObservedRuleLogs.mockResolvedValue({ rows: [observedRow(), observedRow({ id: '2', entityId: 'deal-2', dataHash: 'hash-2' })], lastCursor: { executedAt: '2026-08-01T10:00:00.000000Z', id: '2' }, exhausted: false, payloadBytes: 10 })
    const budgeted = await runRuleBacktestSlice(proposal(), context({ budget: { recordsRemaining: 2, sliceDeadlineAt: NOW + 10_000, runDeadlineAt: NOW + 60_000, maxBatchRows: 500, maxBatchBytes: 1000 } }))
    expect(budgeted.status).toBe('done')
    if (budgeted.status !== 'done') return
    expect(budgeted.result.truncated).toBe(true)
    expect(budgeted.result.caveats).toContain('business_rules.simulation.caveats.truncated')
    const late = await runRuleBacktestSlice(proposal(), context({ budget: { recordsRemaining: 100, sliceDeadlineAt: NOW, runDeadlineAt: NOW, maxBatchRows: 500, maxBatchBytes: 1000 } }))
    expect(late.status).toBe('done')
    if (late.status === 'done') expect(late.result.truncated).toBe(true)
  })

  it('flags rule-limit crossings and evaluates the proposal among the current rules except the artifact', async () => {
    findWithDecryption.mockResolvedValue([
      { id: ARTIFACT, eventType: 'updated', effectiveFrom: null, effectiveTo: null },
      ...Array.from({ length: 100 }, (_value, index) => ({ id: `rule-${index}`, eventType: 'updated', effectiveFrom: null, effectiveTo: null })),
    ])
    readObservedRuleLogs.mockResolvedValueOnce({ rows: [observedRow()], lastCursor: null, exhausted: true, payloadBytes: 10 })
    const result = await runRuleBacktestSlice(proposal(), context({ eventAdapters: [] }))
    expect(result.status).toBe('done')
    if (result.status !== 'done') return
    expect(result.result.groups[0].flags).toEqual([RULE_LIMIT_EXCEEDED_FLAG])
    expect(result.result.groups[0].warnings).toContain('business_rules.simulation.warnings.ruleLimitExceeded')
    expect(findWithDecryption).toHaveBeenCalledWith(expect.anything(), expect.anything(), { tenantId: TENANT, organizationId: ORG, entityType: 'customers.deal', enabled: true, deletedAt: null }, expect.anything(), SCOPE)
  })

  it('reports structural warnings for a proposal that can never run', async () => {
    readObservedRuleLogs.mockResolvedValueOnce({ rows: [observedRow()], lastCursor: null, exhausted: true, payloadBytes: 10 })
    const result = await runRuleBacktestSlice(proposal({ eventType: null, enabled: false, effectiveTo: '2026-01-01T00:00:00Z' }), context({ eventAdapters: [] }))
    expect(result.status).toBe('done')
    if (result.status !== 'done') return
    expect(result.result.groups[0].warnings).toEqual([
      'business_rules.simulation.warnings.nullEventType',
      'business_rules.simulation.warnings.disabled',
      'business_rules.simulation.warnings.notEffective',
    ])
    expect(cellsOf(result.result, 'customers.deal.updated').does_not_fire).toBe(1)
  })

  it('has no side effects: no rule execution, no actions, no log writes, no events', async () => {
    readObservedRuleLogs.mockResolvedValueOnce({ rows: [observedRow({ data: { id: 'deal-1', status: 'won' } })], lastCursor: null, exhausted: true, payloadBytes: 10 })
    const scanAuditLog = jest.fn(async () => ({ entries: [auditEntry()], lastCursor: null, exhausted: true, payloadBytes: 0, undecryptable: 0 }))
    const writes = { persist: jest.fn(), flush: jest.fn(), nativeUpdate: jest.fn(), nativeDelete: jest.fn(), insert: jest.fn(), create: jest.fn() }
    await runRuleBacktestSlice(proposal(), context({ em: { getKysely: () => ({}), ...writes } as never, scanAuditLog }))
    expect(executeRules).not.toHaveBeenCalled()
    expect(executeSingleRule).not.toHaveBeenCalled()
    expect(executeActions).not.toHaveBeenCalled()
    expect(logRuleExecution).not.toHaveBeenCalled()
    for (const write of Object.values(writes)) expect(write).not.toHaveBeenCalled()
    const source = fs.readFileSync(path.join(__dirname, '..', 'rule-backtest.ts'), 'utf8')
    expect(source).not.toMatch(/executeRules\(|executeSingleRule\(|executeActions\(|action-executor'|emitEvent\(|eventBus\.|commandBus|logRuleExecution\(|\.persist\(|\.flush\(|nativeUpdate|nativeDelete/)
  })
})

describe('sample record ids', () => {
  it('prefer the payload entityId (customers profile payloads) over the payload id', () => {
    expect(resolveSampleRecordId({ id: 'profile-1', entityId: 'entity-1' }, 'profile-1')).toBe('entity-1')
    expect(resolveSampleRecordId({ id: 'deal-1' }, 'deal-1')).toBe('deal-1')
    expect(resolveSampleRecordId(null, null)).toBeNull()
  })
})

describe('ruleBacktestKind contract', () => {
  it('requires the rule and log features, the targeted record type\'s view features and the four cells', () => {
    expect(ruleBacktestKind.requiredFeatures).toEqual(['business_rules.view', 'business_rules.view_logs'])
    expect(ruleBacktestKind.inputFeatures!(proposal(), { eventAdapters: DEAL_ADAPTERS })).toEqual(['customers.deals.view'])
    expect(ruleBacktestKind.inputFeatures!(proposal({ entityType: 'customers.person' }), { eventAdapters: DEAL_ADAPTERS })).toEqual([])
    expect(ruleBacktestKind.cellKeys).toEqual(['fires', 'does_not_fire', 'runs_failure_actions', 'cannot_tell'])
    expect(ruleBacktestKind.inputSchema.safeParse({ ruleId: '' }).success).toBe(false)
  })

  it('answers 422 unsupported_event_payload only when no adapter matches the proposal', async () => {
    const validate = ruleBacktestKind.validate!
    const ctx = { em: {} as never, scope: SCOPE, eventAdapters: DEAL_ADAPTERS }
    await expect(validate(proposal(), ctx)).resolves.toEqual({ ok: true })
    await expect(validate(proposal({ eventType: null }), ctx)).resolves.toEqual({ ok: true })
    await expect(validate(proposal({ eventType: 'beforeSave' }), ctx)).resolves.toEqual({ ok: false, code: 'unsupported_event_payload' })
    await expect(validate(proposal({ entityType: 'Deal' }), ctx)).resolves.toEqual({ ok: false, code: 'unsupported_event_payload' })
  })

  it('reads the artifact version by id or by business key, scoped, with the definition hash as fingerprint', async () => {
    const saved = { id: ARTIFACT, updatedAt: new Date('2026-10-09T10:00:00.000Z'), ...proposal() }
    findOneWithDecryption.mockResolvedValueOnce(saved)
    const byId = await ruleBacktestKind.readArtifactVersion({ em: {} as never, scope: SCOPE }, { artifactId: ARTIFACT, input: proposal() })
    expect(byId).toEqual({ artifactId: ARTIFACT, updatedAt: '2026-10-09T10:00:00.000Z', fingerprint: computeRuleDefinitionHash(saved) })
    expect(findOneWithDecryption).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), { id: ARTIFACT, tenantId: TENANT, organizationId: ORG, deletedAt: null }, undefined, SCOPE)
    expect(await ruleBacktestKind.readArtifactVersion({ em: {} as never, scope: SCOPE }, { artifactId: 'not-a-uuid', input: proposal() })).toBeNull()
    findOneWithDecryption.mockResolvedValueOnce(null)
    expect(await ruleBacktestKind.readArtifactVersion({ em: {} as never, scope: SCOPE }, { artifactId: null, input: proposal() })).toBeNull()
    expect(findOneWithDecryption).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), { ruleId: 'DEAL_WON', tenantId: TENANT, organizationId: ORG, deletedAt: null }, undefined, SCOPE)
  })

  it('fingerprints the proposal exactly like the saved rule it becomes', () => {
    const input = proposal({ effectiveFrom: '2026-01-01', conditionExpression: { operator: 'AND', rules: [{ value: 'won', operator: '=', field: 'status' }] } })
    const savedRule = { ...input, conditionExpression: { rules: [{ field: 'status', operator: '=', value: 'won' }], operator: 'AND' }, updatedAt: new Date(), version: 3 }
    expect(fingerprintRuleProposal(input)).toBe(computeRuleDefinitionHash(savedRule))
    expect(fingerprintRuleProposal(proposal({ enabled: false }))).not.toBe(fingerprintRuleProposal(proposal()))
  })

  it('links back to the rule editor with the run id', () => {
    expect(ruleBacktestKind.applyHref!({ artifactId: ARTIFACT, runId: 'run-1' })).toBe(`/backend/rules/${ARTIFACT}?simulationRunId=run-1`)
    expect(ruleBacktestKind.applyHref!({ artifactId: null, runId: 'run-1' })).toBe('/backend/rules/create?simulationRunId=run-1')
  })
})
