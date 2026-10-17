import type { AnalyticsEventRow } from '../../analytics/trace'
import type { XraySettingsSnapshot } from '../../projection/settings'
import type { XrayWorkflowDraftService } from '../../workflowsBridge'

const assertXrayScope = jest.fn(async () => undefined)
const loadXraySettings = jest.fn(async (): Promise<XraySettingsSnapshot> => settings())
const isXrayIngestEnabled = jest.fn(async () => true)
const listSuggestionPasses = jest.fn(async (): Promise<Map<string, string>> => new Map())
const markSuggestionPass = jest.fn(async () => undefined)
const clearSuggestionRequest = jest.fn(async (_db: unknown, _scope: unknown, _through: string) => undefined)
const setXrayWriteTimeouts = jest.fn(async (_trx: unknown, _timeouts: unknown) => undefined)
const readCursor = jest.fn(async (): Promise<unknown> => completeCursor())
const lockXrayCursorState = jest.fn(async (): Promise<unknown> => completeCursor())
const loadCaseEvents = jest.fn(async (_trx: unknown, _query: { processKey: string; from: string; to: string }): Promise<unknown[]> => [])
const runAnalyticsQuery = jest.fn(async (db: unknown, run: (trx: unknown) => Promise<unknown>, _options?: unknown) => run(db))
const upsertSuggestions = jest.fn(async (_db: unknown, _scope: unknown, rows: unknown[]) => rows.length)
const supersedeMissingSuggestions = jest.fn(async (_db: unknown, _scope: unknown, _keys: string[], _signatures: string[]) => 0)
let workflowService: XrayWorkflowDraftService | null = null
const transactionDb = { kind: 'trx' }
const database = { kind: 'db', transaction: () => ({ execute: async (run: (trx: unknown) => Promise<unknown>) => run(transactionDb) }) }

jest.mock('../../projection/payloads', () => {
  const actual = jest.requireActual('../../projection/payloads')
  return { ...actual, assertXrayScope: (...args: unknown[]) => assertXrayScope(...(args as [])) }
})
jest.mock('../../projection/settings', () => {
  const actual = jest.requireActual('../../projection/settings')
  return { ...actual, loadXraySettings: (...args: unknown[]) => loadXraySettings(...(args as [])) }
})
jest.mock('../../projection/killSwitch', () => ({ isXrayIngestEnabled: (...args: unknown[]) => isXrayIngestEnabled(...(args as [])) }))
jest.mock('../../projection/runtime', () => {
  const actual = jest.requireActual('../../projection/runtime')
  return {
    ...actual,
    createXrayDatabase: () => database,
    createXrayStore: () => ({ now: async () => '2026-10-10T12:00:00.000000Z', readCursor: (...args: unknown[]) => readCursor(...(args as [])) }),
  }
})
jest.mock('../../projection/completeness', () => {
  const actual = jest.requireActual('../../projection/completeness')
  return {
    ...actual,
    lockXrayCursorState: (...args: unknown[]) => lockXrayCursorState(...(args as [])),
    setXrayWriteTimeouts: (...args: unknown[]) => setXrayWriteTimeouts(...(args as [unknown, unknown])),
  }
})
jest.mock('../passes', () => {
  const actual = jest.requireActual('../passes')
  return {
    ...actual,
    listSuggestionPasses: (...args: unknown[]) => listSuggestionPasses(...(args as [])),
    markSuggestionPass: (...args: unknown[]) => markSuggestionPass(...(args as [])),
    clearSuggestionRequest: (...args: unknown[]) => clearSuggestionRequest(...(args as [unknown, unknown, string])),
  }
})
jest.mock('../../analytics/query', () => ({
  runAnalyticsQuery: (...args: unknown[]) => runAnalyticsQuery(...(args as [unknown, (trx: unknown) => Promise<unknown>, unknown])),
  loadCaseEvents: (...args: unknown[]) => loadCaseEvents(...(args as [unknown, { processKey: string; from: string; to: string }])),
}))
jest.mock('../store', () => ({
  upsertSuggestions: (...args: unknown[]) => upsertSuggestions(...(args as [unknown, unknown, unknown[]])),
  supersedeMissingSuggestions: (...args: unknown[]) => supersedeMissingSuggestions(...(args as [unknown, unknown, string[], string[]])),
}))
jest.mock('../../workflowsBridge', () => {
  const actual = jest.requireActual('../../workflowsBridge')
  return { ...actual, resolveWorkflowDraftService: () => workflowService }
})
jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({ getTelemetryRuntime: () => ({ reportError: (...args: unknown[]) => reportErrorMock(...args) }) }))
jest.mock('@open-mercato/shared/lib/logger', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/logger')
  const silent = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn(), trace: jest.fn(), child: () => silent }
  return { ...actual, createLogger: () => silent }
})

const reportErrorMock = jest.fn()

import { AnalyticsTimeoutError } from '../../analytics/errors'
import { buildProcessRegistrySnapshot } from '../../process/registry'
import { testProcessConfig, testRegistry } from '../../process/__tests__/processTestSupport'
import { runXraySuggestionJob, suggestionThresholds } from '../job'
import { XRAY_SUGGESTION_THRESHOLDS } from '../constants'
import { ANALYTICS_ORG, caseIdOf, dealRows } from './suggestionsTestSupport'

const TENANT = '11111111-0000-4000-8000-000000000001'
const SCOPE = { tenantId: TENANT, organizationId: ANALYTICS_ORG }
const container = { resolve: (name: string) => (name === 'em' ? { fork: () => ({}) } : undefined) }
const crudCatalog = { payloadPaths: (eventId: string) => (eventId.endsWith('.created') ? new Set(['id', 'tenantId', 'organizationId']) : null) }

function settings(overrides: Partial<XraySettingsSnapshot> = {}): XraySettingsSnapshot {
  return {
    id: null,
    updatedAt: null,
    enabled: true,
    retentionDays: 365,
    kAnonymity: 5,
    debounceSeconds: 0,
    individualsEnabled: false,
    timeZone: 'UTC',
    suggestionMinSupport: 5,
    conformanceWorkflowId: null,
    activityStepMap: null,
    ...overrides,
  }
}

function completeCursor(overrides: Record<string, unknown> = {}) {
  return { status: 'idle', scanId: null, pendingRebuildKeys: [], lastCreatedAt: '2026-10-10T11:59:00.000000Z', contractHashes: {}, ...overrides }
}

function automatedRegistry() {
  const config = testProcessConfig()
  return testRegistry({ ...config, processes: (config.processes ?? []).map((process) => ({ ...process, automation: { updateCommandId: 'test.deals.update' } })) })
}

function groups(count: number) {
  const now = Date.parse('2026-10-10T12:00:00.000Z')
  return Array.from({ length: count }, (_, position) => {
    const index = position + 1
    const rows: AnalyticsEventRow[] = dealRows(index, { startMs: now - 10 * 86_400_000 + index * 3_600_000, followup: { key: 'status:qa_review', delayMs: 300_000 } })
    return { organizationId: ANALYTICS_ORG, caseId: caseIdOf(index), rows, caseRow: null }
  })
}

function service(overrides: Partial<XrayWorkflowDraftService> = {}): XrayWorkflowDraftService {
  return {
    validateDraftDefinition: async (payload) => ({ ok: true, payload, commands: [{ commandId: 'test.deals.update', requiredFeatures: ['test.deals.manage'] }], workflowIdAvailable: true }),
    getDefinitionForScope: async () => null,
    listAutomatedUpdates: async () => [],
    ...overrides,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  workflowService = service()
  loadXraySettings.mockResolvedValue(settings())
  isXrayIngestEnabled.mockResolvedValue(true)
  listSuggestionPasses.mockResolvedValue(new Map())
  readCursor.mockResolvedValue(completeCursor())
  lockXrayCursorState.mockResolvedValue(completeCursor())
  loadCaseEvents.mockResolvedValue(groups(8))
})

describe('runXraySuggestionJob', () => {
  it('mines the last 30 days (database clock), stores draftable suggestions, supersedes the rest of the evaluated processes and records the pass', async () => {
    const result = await runXraySuggestionJob(container, SCOPE, { registry: automatedRegistry(), catalog: crudCatalog })
    expect(result).toEqual({ status: 'done', processes: 1, skippedProcesses: [], found: 1, alreadyAutomated: 0, written: 1, superseded: 0 })
    expect(loadCaseEvents).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      processKey: 'test.deal',
      from: '2026-09-10T12:00:00.000Z',
      to: '2026-10-10T12:00:00.000Z',
      scope: { tenantId: TENANT, organizationIds: [ANALYTICS_ORG] },
    }))
    expect(runAnalyticsQuery).toHaveBeenCalledWith(database, expect.any(Function), { timeoutMs: 30_000 })
    const [, , rows] = upsertSuggestions.mock.calls[0] as [unknown, unknown, Array<Record<string, unknown>>]
    expect(upsertSuggestions.mock.calls[0][0]).toBe(transactionDb)
    expect(rows).toEqual([expect.objectContaining({ draftable: true, notDraftableReason: null, triggerEventId: 'test.deal.created', commandId: 'test.deals.update' })])
    expect(supersedeMissingSuggestions).toHaveBeenCalledWith(transactionDb, SCOPE, ['test.deal'], [rows[0].signatureHash])
    expect(markSuggestionPass).toHaveBeenCalledWith(transactionDb, SCOPE)
    expect(lockXrayCursorState).toHaveBeenCalledWith(transactionDb, SCOPE)
    expect(assertXrayScope).toHaveBeenCalled()
  })

  it('stores a rule of a process without automation hints as not draftable (no_command)', async () => {
    await runXraySuggestionJob(container, SCOPE, { registry: testRegistry(), catalog: crudCatalog })
    const [, , rows] = upsertSuggestions.mock.calls[0] as [unknown, unknown, Array<Record<string, unknown>>]
    expect(rows).toEqual([expect.objectContaining({ draftable: false, notDraftableReason: 'no_command', commandId: null })])
  })

  it('stores workflows_unavailable without the workflows module and treats nothing as automated', async () => {
    workflowService = null
    await runXraySuggestionJob(container, SCOPE, { registry: automatedRegistry(), catalog: crudCatalog })
    const [, , rows] = upsertSuggestions.mock.calls[0] as [unknown, unknown, Array<Record<string, unknown>>]
    expect(rows).toEqual([expect.objectContaining({ draftable: false, notDraftableReason: 'workflows_unavailable' })])
  })

  it('drops a rule an enabled workflow trigger already automates, so its open suggestion is superseded', async () => {
    workflowService = service({ listAutomatedUpdates: async () => [{ workflowDefinitionId: 'w', workflowId: 'w', eventPattern: 'test.deal.*', commandId: 'test.deals.update', inputKeys: ['id', 'status'] }] })
    const result = await runXraySuggestionJob(container, SCOPE, { registry: automatedRegistry(), catalog: crudCatalog })
    expect(result).toEqual(expect.objectContaining({ found: 1, alreadyAutomated: 1, written: 0 }))
    expect(supersedeMissingSuggestions).toHaveBeenCalledWith(transactionDb, SCOPE, ['test.deal'], [])
  })

  it('applies the organization support override (never below 5) and its k', () => {
    expect(suggestionThresholds({ suggestionMinSupport: null, kAnonymity: 10 })).toEqual({
      minSupport: XRAY_SUGGESTION_THRESHOLDS.minSupport,
      minConfidenceLowerBound: 0.6,
      minLift: 2,
      minDistinctActors: 3,
      minCases: 10,
    })
    expect(suggestionThresholds({ suggestionMinSupport: 2, kAnonymity: 1 })).toEqual(expect.objectContaining({ minSupport: 5, minCases: 5 }))
    loadXraySettings.mockResolvedValue(settings({ suggestionMinSupport: null }))
    return runXraySuggestionJob(container, SCOPE, { registry: automatedRegistry(), catalog: crudCatalog }).then((result) => {
      expect(result).toEqual(expect.objectContaining({ found: 0, written: 0 }))
    })
  })

  it('skips a process over its analytics budget without superseding its suggestions, reports it and still records the pass', async () => {
    loadCaseEvents.mockRejectedValueOnce(new AnalyticsTimeoutError())
    const result = await runXraySuggestionJob(container, SCOPE, { registry: automatedRegistry(), catalog: crudCatalog })
    expect(result).toEqual(expect.objectContaining({ status: 'done', processes: 0, skippedProcesses: ['test.deal'], written: 0 }))
    expect(supersedeMissingSuggestions).toHaveBeenCalledWith(transactionDb, SCOPE, [], [])
    expect(reportErrorMock).toHaveBeenCalledWith(expect.any(AnalyticsTimeoutError), expect.objectContaining({ code: 'insights.xray_suggestions_budget_exceeded' }))
    expect(markSuggestionPass).toHaveBeenCalled()
  })

  it('rethrows other failures (the queue retries) without recording the pass', async () => {
    loadCaseEvents.mockRejectedValueOnce(new Error('connection reset'))
    await expect(runXraySuggestionJob(container, SCOPE, { registry: automatedRegistry(), catalog: crudCatalog })).rejects.toThrow('connection reset')
    expect(markSuggestionPass).not.toHaveBeenCalled()
    expect(upsertSuggestions).not.toHaveBeenCalled()
  })

  it.each([
    ['disabled settings', () => loadXraySettings.mockResolvedValue(settings({ enabled: false })), 'disabled'],
    ['the kill switch', () => isXrayIngestEnabled.mockResolvedValue(false), 'disabled'],
    ['a fresh pass', () => listSuggestionPasses.mockResolvedValue(new Map([[`${TENANT}|${ANALYTICS_ORG}`, '2026-10-09T12:00:01.000000Z']])), 'not_due'],
    ['a running backfill', () => readCursor.mockResolvedValue(completeCursor({ status: 'backfilling' })), 'incomplete'],
    ['a range scan', () => readCursor.mockResolvedValue(completeCursor({ scanId: 'eeeeeeee-0000-4000-8000-000000000001' })), 'incomplete'],
    ['a pending rebuild', () => readCursor.mockResolvedValue(completeCursor({ pendingRebuildKeys: ['test.deal'] })), 'incomplete'],
    ['no cursor', () => readCursor.mockResolvedValue(null), 'incomplete'],
  ])('skips on %s without mining or recording a pass', async (_label, arrange, status) => {
    arrange()
    expect(await runXraySuggestionJob(container, SCOPE, { registry: automatedRegistry(), catalog: crudCatalog })).toEqual({ status })
    expect(loadCaseEvents).not.toHaveBeenCalled()
    expect(markSuggestionPass).not.toHaveBeenCalled()
  })

  it('runs a forced (on-demand) pass even when the last one is fresh, but at most one per 15 minutes', async () => {
    listSuggestionPasses.mockResolvedValue(new Map([[`${TENANT}|${ANALYTICS_ORG}`, '2026-10-10T11:45:00.000000Z']]))
    expect(await runXraySuggestionJob(container, SCOPE, { registry: automatedRegistry(), catalog: crudCatalog, force: true })).toEqual(expect.objectContaining({ status: 'done' }))
    listSuggestionPasses.mockResolvedValue(new Map([[`${TENANT}|${ANALYTICS_ORG}`, '2026-10-10T11:45:01.000000Z']]))
    expect(await runXraySuggestionJob(container, SCOPE, { registry: automatedRegistry(), catalog: crudCatalog, force: true })).toEqual({ status: 'not_due' })
    expect(loadCaseEvents).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['a stored pass', () => undefined, 'done'],
    ['a coalesced request', () => listSuggestionPasses.mockResolvedValue(new Map([[`${TENANT}|${ANALYTICS_ORG}`, '2026-10-10T11:59:00.000000Z']])), 'not_due'],
    ['a disabled organization', () => loadXraySettings.mockResolvedValue(settings({ enabled: false })), 'disabled'],
    ['an incomplete projection', () => readCursor.mockResolvedValue(completeCursor({ status: 'backfilling' })), 'incomplete'],
  ])('clears the on-demand request it served (up to its start, database clock) after %s', async (_label, arrange, status) => {
    arrange()
    expect(await runXraySuggestionJob(container, SCOPE, { registry: automatedRegistry(), catalog: crudCatalog, force: true })).toEqual(expect.objectContaining({ status }))
    expect(clearSuggestionRequest).toHaveBeenCalledTimes(1)
    expect(clearSuggestionRequest).toHaveBeenCalledWith(database, SCOPE, '2026-10-10T12:00:00.000000Z')
  })

  it('leaves the on-demand request to the forced job when a scheduled pass runs', async () => {
    expect(await runXraySuggestionJob(container, SCOPE, { registry: automatedRegistry(), catalog: crudCatalog })).toEqual(expect.objectContaining({ status: 'done' }))
    expect(clearSuggestionRequest).not.toHaveBeenCalled()
  })

  it('keeps the request of a forced pass that failed (the queue retries it; the request expires on its own)', async () => {
    loadCaseEvents.mockRejectedValueOnce(new Error('connection reset'))
    await expect(runXraySuggestionJob(container, SCOPE, { registry: automatedRegistry(), catalog: crudCatalog, force: true })).rejects.toThrow('connection reset')
    expect(clearSuggestionRequest).not.toHaveBeenCalled()
  })

  it('never fails a stored pass when clearing the request fails (logged and reported)', async () => {
    const failure = new Error('connection reset')
    clearSuggestionRequest.mockRejectedValueOnce(failure)
    expect(await runXraySuggestionJob(container, SCOPE, { registry: automatedRegistry(), catalog: crudCatalog, force: true })).toEqual(expect.objectContaining({ status: 'done' }))
    expect(reportErrorMock).toHaveBeenCalledWith(failure, expect.objectContaining({ code: 'insights.xray_suggestion_request_clear_failed' }))
  })

  it('bounds the final write transaction with the projection write timeouts', async () => {
    await runXraySuggestionJob(container, SCOPE, { registry: automatedRegistry(), catalog: crudCatalog })
    expect(setXrayWriteTimeouts).toHaveBeenCalledWith(transactionDb, { lockTimeoutMs: 5000, statementTimeoutMs: 30_000 })
    expect(setXrayWriteTimeouts.mock.invocationCallOrder[0]).toBeLessThan(lockXrayCursorState.mock.invocationCallOrder[0])
  })

  it('stores nothing and answers incomplete (the next tick retries) when the write transaction hits its lock timeout', async () => {
    lockXrayCursorState.mockRejectedValueOnce(Object.assign(new Error('canceling statement due to lock timeout'), { code: '55P03' }))
    expect(await runXraySuggestionJob(container, SCOPE, { registry: automatedRegistry(), catalog: crudCatalog })).toEqual({ status: 'incomplete' })
    expect(upsertSuggestions).not.toHaveBeenCalled()
    expect(markSuggestionPass).not.toHaveBeenCalled()
  })

  it('rethrows a statement timeout of the write transaction (the queue retries)', async () => {
    upsertSuggestions.mockRejectedValueOnce(Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' }))
    await expect(runXraySuggestionJob(container, SCOPE, { registry: automatedRegistry(), catalog: crudCatalog })).rejects.toThrow('statement timeout')
    expect(markSuggestionPass).not.toHaveBeenCalled()
  })

  it.each([
    ['a rebuild started meanwhile (contracts emptied)', () => lockXrayCursorState.mockResolvedValueOnce(completeCursor({ contractHashes: {} }))],
    ['a contract change queued a rebuild meanwhile', () => lockXrayCursorState.mockResolvedValueOnce(completeCursor({ pendingRebuildKeys: ['test.deal'] }))],
    ['a backfill started meanwhile', () => lockXrayCursorState.mockResolvedValueOnce(completeCursor({ status: 'backfilling' }))],
    ['the cursor vanished', () => lockXrayCursorState.mockResolvedValueOnce(null)],
  ])('stores nothing and records no pass when %s (re-checked under the cursor lock)', async (_label, arrange) => {
    readCursor.mockResolvedValue(completeCursor({ contractHashes: { 'test.deal': 'hash-1' } }))
    lockXrayCursorState.mockResolvedValue(completeCursor({ contractHashes: { 'test.deal': 'hash-1' } }))
    arrange()
    expect(await runXraySuggestionJob(container, SCOPE, { registry: automatedRegistry(), catalog: crudCatalog })).toEqual({ status: 'incomplete' })
    expect(upsertSuggestions).not.toHaveBeenCalled()
    expect(supersedeMissingSuggestions).not.toHaveBeenCalled()
    expect(markSuggestionPass).not.toHaveBeenCalled()
  })

  it('answers no_processes without declarations and refuses an organization of another tenant before reading', async () => {
    expect(await runXraySuggestionJob(container, SCOPE, { registry: buildProcessRegistrySnapshot([], []) })).toEqual({ status: 'no_processes' })
    assertXrayScope.mockRejectedValueOnce(new Error('scope mismatch'))
    await expect(runXraySuggestionJob(container, SCOPE, { registry: automatedRegistry() })).rejects.toThrow('scope mismatch')
    expect(loadXraySettings).not.toHaveBeenCalled()
  })
})
