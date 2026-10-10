import type { XraySettingsSnapshot } from '../../projection/settings'

const assertXrayScope = jest.fn(async () => undefined)
const loadXraySettings = jest.fn(async (): Promise<XraySettingsSnapshot> => settings())
const isXrayIngestEnabled = jest.fn(async () => true)
const readCursor = jest.fn(async (): Promise<unknown> => completeCursor())
const claimSuggestionRequest = jest.fn(async (_db: unknown, _scope: unknown): Promise<string | null> => CLAIMED_AT)
const clearSuggestionRequest = jest.fn(async (_db: unknown, _scope: unknown, _through: string) => undefined)
const enqueueXraySuggestionMining = jest.fn(async (_scope: unknown, _options: unknown) => undefined)
const readXraySuggestionsBacklog = jest.fn(async (): Promise<number | null> => 0)
const reportErrorMock = jest.fn()
const database = { kind: 'db' }

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
    createXrayStore: () => ({ readCursor: (...args: unknown[]) => readCursor(...(args as [])) }),
  }
})
jest.mock('../../projection/queue', () => {
  const actual = jest.requireActual('../../projection/queue')
  return {
    ...actual,
    enqueueXraySuggestionMining: (...args: unknown[]) => enqueueXraySuggestionMining(...(args as [unknown, unknown])),
    readXraySuggestionsBacklog: (...args: unknown[]) => readXraySuggestionsBacklog(...(args as [])),
  }
})
jest.mock('../passes', () => {
  const actual = jest.requireActual('../passes')
  return {
    ...actual,
    claimSuggestionRequest: (...args: unknown[]) => claimSuggestionRequest(...(args as [unknown, unknown])),
    clearSuggestionRequest: (...args: unknown[]) => clearSuggestionRequest(...(args as [unknown, unknown, string])),
  }
})
jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({ getTelemetryRuntime: () => ({ reportError: (...args: unknown[]) => reportErrorMock(...args) }) }))
jest.mock('@open-mercato/shared/lib/logger', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/logger')
  const silent = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn(), trace: jest.fn(), child: () => silent }
  return { ...actual, createLogger: () => silent }
})

import { buildProcessRegistrySnapshot } from '../../process/registry'
import { testRegistry } from '../../process/__tests__/processTestSupport'
import { requestXraySuggestionMining } from '../request'

const CLAIMED_AT = '2026-10-10T12:00:00.000123Z'
const SCOPE = { tenantId: '11111111-0000-4000-8000-000000000001', organizationId: '22222222-0000-4000-8000-000000000001' }
const container = { resolve: (name: string) => (name === 'em' ? { fork: () => ({}) } : undefined) }

function settings(overrides: Partial<XraySettingsSnapshot> = {}): XraySettingsSnapshot {
  return {
    id: null,
    updatedAt: null,
    enabled: true,
    retentionDays: 365,
    kAnonymity: 10,
    debounceSeconds: 120,
    individualsEnabled: false,
    timeZone: 'UTC',
    suggestionMinSupport: null,
    conformanceWorkflowId: null,
    activityStepMap: null,
    ...overrides,
  }
}

function completeCursor(overrides: Record<string, unknown> = {}) {
  return { status: 'idle', scanId: null, pendingRebuildKeys: [], lastCreatedAt: '2026-10-10T11:59:00.000000Z', contractHashes: {}, ...overrides }
}

beforeEach(() => {
  jest.clearAllMocks()
  loadXraySettings.mockResolvedValue(settings())
  isXrayIngestEnabled.mockResolvedValue(true)
  readCursor.mockResolvedValue(completeCursor())
  claimSuggestionRequest.mockResolvedValue(CLAIMED_AT)
  readXraySuggestionsBacklog.mockResolvedValue(0)
  enqueueXraySuggestionMining.mockResolvedValue(undefined)
})

describe('requestXraySuggestionMining', () => {
  it('claims the organization request, then enqueues one forced pass', async () => {
    expect(await requestXraySuggestionMining(container, SCOPE, { registry: testRegistry() })).toEqual({ status: 'enqueued' })
    expect(assertXrayScope).toHaveBeenCalled()
    expect(claimSuggestionRequest).toHaveBeenCalledWith(database, SCOPE)
    expect(enqueueXraySuggestionMining).toHaveBeenCalledWith(SCOPE, { force: true })
    expect(claimSuggestionRequest.mock.invocationCallOrder[0]).toBeLessThan(enqueueXraySuggestionMining.mock.invocationCallOrder[0])
  })

  it('answers pending without a second job while an earlier request is still pending', async () => {
    claimSuggestionRequest.mockResolvedValue(null)
    expect(await requestXraySuggestionMining(container, SCOPE, { registry: testRegistry() })).toEqual({ status: 'pending' })
    expect(enqueueXraySuggestionMining).not.toHaveBeenCalled()
  })

  it.each([
    ['disabled settings', () => loadXraySettings.mockResolvedValue(settings({ enabled: false })), 'disabled'],
    ['the kill switch', () => isXrayIngestEnabled.mockResolvedValue(false), 'disabled'],
    ['a running backfill', () => readCursor.mockResolvedValue(completeCursor({ status: 'backfilling' })), 'projection_incomplete'],
    ['a range scan', () => readCursor.mockResolvedValue(completeCursor({ scanId: 'eeeeeeee-0000-4000-8000-000000000001' })), 'projection_incomplete'],
    ['a pending rebuild', () => readCursor.mockResolvedValue(completeCursor({ pendingRebuildKeys: ['test.deal'] })), 'projection_incomplete'],
    ['an unpositioned cursor', () => readCursor.mockResolvedValue(completeCursor({ lastCreatedAt: null })), 'projection_incomplete'],
    ['no cursor', () => readCursor.mockResolvedValue(null), 'projection_incomplete'],
    ['a backlogged queue', () => readXraySuggestionsBacklog.mockResolvedValue(1000), 'busy'],
  ])('refuses %s before claiming or enqueueing', async (_label, arrange, status) => {
    arrange()
    expect(await requestXraySuggestionMining(container, SCOPE, { registry: testRegistry() })).toEqual({ status })
    expect(claimSuggestionRequest).not.toHaveBeenCalled()
    expect(enqueueXraySuggestionMining).not.toHaveBeenCalled()
  })

  it('refuses when no module declares a process', async () => {
    expect(await requestXraySuggestionMining(container, SCOPE, { registry: buildProcessRegistrySnapshot([], []) })).toEqual({ status: 'no_processes' })
    expect(loadXraySettings).not.toHaveBeenCalled()
    expect(enqueueXraySuggestionMining).not.toHaveBeenCalled()
  })

  it('proceeds when the queue cannot tell its backlog', async () => {
    readXraySuggestionsBacklog.mockResolvedValue(null)
    expect(await requestXraySuggestionMining(container, SCOPE, { registry: testRegistry() })).toEqual({ status: 'enqueued' })
  })

  it('releases its claim when the enqueue fails, so the next request can enqueue again', async () => {
    enqueueXraySuggestionMining.mockRejectedValueOnce(new Error('queue down'))
    await expect(requestXraySuggestionMining(container, SCOPE, { registry: testRegistry() })).rejects.toThrow('queue down')
    expect(clearSuggestionRequest).toHaveBeenCalledWith(database, SCOPE, CLAIMED_AT)
  })

  it('reports a failed release and still surfaces the enqueue failure', async () => {
    const releaseFailure = new Error('connection reset')
    enqueueXraySuggestionMining.mockRejectedValueOnce(new Error('queue down'))
    clearSuggestionRequest.mockRejectedValueOnce(releaseFailure)
    await expect(requestXraySuggestionMining(container, SCOPE, { registry: testRegistry() })).rejects.toThrow('queue down')
    expect(reportErrorMock).toHaveBeenCalledWith(releaseFailure, expect.objectContaining({ code: 'insights.xray_suggestion_request_clear_failed' }))
  })

  it('refuses an organization of another tenant before reading anything', async () => {
    assertXrayScope.mockRejectedValueOnce(new Error('scope mismatch'))
    await expect(requestXraySuggestionMining(container, SCOPE, { registry: testRegistry() })).rejects.toThrow('scope mismatch')
    expect(loadXraySettings).not.toHaveBeenCalled()
    expect(claimSuggestionRequest).not.toHaveBeenCalled()
  })
})
