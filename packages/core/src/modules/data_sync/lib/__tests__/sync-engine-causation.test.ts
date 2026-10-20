import type { EntityManager } from '@mikro-orm/postgresql'
import {
  getAmbientCausation,
  runEntryWithCausation,
  type CausationEnvelope,
} from '@open-mercato/shared/lib/causation/server'
import type { CredentialsService } from '../../../integrations/lib/credentials-service'
import type { IntegrationLogService } from '../../../integrations/lib/log-service'
import type { IntegrationStateService } from '../../../integrations/lib/state-service'
import type { ProgressService } from '../../../progress/lib/progressService'
import type { DataSyncAdapter } from '../adapter'
import type { SyncRunService } from '../sync-run-service'

const mockGetDataSyncAdapter = jest.fn()
const mockGetIntegration = jest.fn()
const observedEvents: Array<{ eventId: string; causation: CausationEnvelope | null }> = []
const mockEmitDataSyncEvent = jest.fn(async (eventId: string) => {
  observedEvents.push({ eventId, causation: getAmbientCausation() })
})

jest.mock('../adapter-registry', () => ({
  ...jest.requireActual('../adapter-registry'),
  getDataSyncAdapter: (...args: unknown[]) => mockGetDataSyncAdapter(...args),
}))

jest.mock('@open-mercato/shared/modules/integrations/types', () => ({
  getIntegration: (...args: unknown[]) => mockGetIntegration(...args),
}))

jest.mock('../../events', () => ({
  emitDataSyncEvent: (...args: unknown[]) => mockEmitDataSyncEvent(...(args as [string])),
}))

jest.mock('../../../query_index/lib/coverage', () => ({
  refreshCoverageSnapshot: jest.fn(async () => undefined),
}))

import { buildSyncRunCausationFrame, createSyncEngine } from '../sync-engine'

const scope = { organizationId: 'org-1', tenantId: 'tenant-1', userId: 'user-1' }

function createProgressService(): ProgressService {
  return {
    startJob: jest.fn(async () => undefined),
    isCancellationRequested: jest.fn(async () => false),
    getJob: jest.fn(async () => null),
    updateProgress: jest.fn(async () => undefined),
    completeJob: jest.fn(async () => undefined),
    failJob: jest.fn(async () => undefined),
    markCancelled: jest.fn(async () => undefined),
  } as unknown as ProgressService
}

function createHarness(run: Record<string, unknown>, observedCommits: Array<CausationEnvelope | null>) {
  const syncRunService = {
    getRun: jest.fn(async () => run),
    markStatus: jest.fn(async (_id: string, status: string) => ({ ...run, status })),
    updateCounts: jest.fn(async () => undefined),
    updateCursor: jest.fn(async () => undefined),
    commitBatchProgress: jest.fn(async () => {
      observedCommits.push(getAmbientCausation())
    }),
  } as unknown as SyncRunService
  const engine = createSyncEngine({
    em: {} as EntityManager,
    syncRunService,
    integrationCredentialsService: {
      resolve: jest.fn(async () => ({ token: 'secret' })),
    } as unknown as CredentialsService,
    integrationLogService: { write: jest.fn(async () => undefined) } as unknown as IntegrationLogService,
    integrationStateService: { upsert: jest.fn(async () => undefined) } as unknown as IntegrationStateService,
    progressService: createProgressService(),
  })
  return { engine, syncRunService }
}

function importAdapter(observedInAdapter: Array<CausationEnvelope | null>): DataSyncAdapter {
  return {
    providerKey: 'excel',
    direction: 'import',
    supportedEntities: ['customers.person'],
    getMapping: jest.fn(async () => ({ entityType: 'customers.person', matchStrategy: 'externalId', fields: [] })),
    streamImport: async function* () {
      observedInAdapter.push(getAmbientCausation())
      await Promise.resolve()
      observedInAdapter.push(getAmbientCausation())
      yield {
        items: [{ externalId: 'ext-1', action: 'create', data: {} }],
        cursor: 'cursor-1',
        hasMore: false,
        batchIndex: 0,
      }
    },
  } as DataSyncAdapter
}

function exportAdapter(observedInAdapter: Array<CausationEnvelope | null>): DataSyncAdapter {
  return {
    providerKey: 'excel',
    direction: 'export',
    supportedEntities: ['customers.person'],
    getMapping: jest.fn(async () => ({ entityType: 'customers.person', matchStrategy: 'externalId', fields: [] })),
    streamExport: async function* () {
      observedInAdapter.push(getAmbientCausation())
      await Promise.resolve()
      observedInAdapter.push(getAmbientCausation())
      yield {
        results: [{ localId: 'person-1', status: 'success', externalId: 'ext-1' }],
        cursor: 'cursor-1',
        hasMore: false,
        batchIndex: 0,
      }
    },
  } as DataSyncAdapter
}

function runRecord(id: string, direction: 'import' | 'export') {
  return {
    id,
    integrationId: 'sync_excel',
    entityType: 'customers.person',
    direction,
    status: 'pending',
    cursor: null,
    progressJobId: null,
  }
}

describe('data sync engine causation frames', () => {
  const originalCausationFlag = process.env.OM_CAUSATION

  beforeEach(() => {
    jest.clearAllMocks()
    observedEvents.length = 0
    mockGetIntegration.mockReturnValue({ providerKey: 'excel' })
  })

  afterEach(() => {
    if (originalCausationFlag === undefined) delete process.env.OM_CAUSATION
    else process.env.OM_CAUSATION = originalCausationFlag
  })

  it('installs no envelope when causation is disabled', async () => {
    process.env.OM_CAUSATION = 'off'
    const observedInAdapter: Array<CausationEnvelope | null> = []
    const observedCommits: Array<CausationEnvelope | null> = []
    mockGetDataSyncAdapter.mockReturnValue(importAdapter(observedInAdapter))
    const { engine } = createHarness(runRecord('run-import-off', 'import'), observedCommits)

    await engine.runImport('run-import-off', 50, scope)

    expect(observedInAdapter).toEqual([null, null])
    expect(observedCommits).toEqual([null])
    expect(observedEvents.map((entry) => entry.causation)).toEqual([null, null])
  })

  it('builds a sync_run frame keyed by run id with the direction only', () => {
    expect(buildSyncRunCausationFrame('run-1', 'import')).toEqual({
      kind: 'sync_run',
      id: 'run-1',
      meta: { direction: 'import' },
    })
  })

  it('runs an import run inside a sync_run frame across adapter streaming, batch commits and lifecycle events', async () => {
    const observedInAdapter: Array<CausationEnvelope | null> = []
    const observedCommits: Array<CausationEnvelope | null> = []
    mockGetDataSyncAdapter.mockReturnValue(importAdapter(observedInAdapter))
    const { engine } = createHarness(runRecord('run-import-1', 'import'), observedCommits)

    await engine.runImport('run-import-1', 50, scope)

    const expectedFrames = [{ kind: 'sync_run', id: 'run-import-1', meta: { direction: 'import' } }]
    expect(observedInAdapter).toHaveLength(2)
    expect(observedCommits).toHaveLength(1)
    for (const envelope of [...observedInAdapter, ...observedCommits]) {
      expect(envelope!.frames).toEqual(expectedFrames)
    }
    expect(observedEvents.map((entry) => entry.eventId)).toEqual(['data_sync.run.started', 'data_sync.run.completed'])
    for (const entry of observedEvents) {
      expect(entry.causation!.frames).toEqual(expectedFrames)
    }
    expect(getAmbientCausation()).toBeNull()
  })

  it('runs an export run inside a sync_run frame with the export direction', async () => {
    const observedInAdapter: Array<CausationEnvelope | null> = []
    const observedCommits: Array<CausationEnvelope | null> = []
    mockGetDataSyncAdapter.mockReturnValue(exportAdapter(observedInAdapter))
    const { engine } = createHarness(runRecord('run-export-1', 'export'), observedCommits)

    await engine.runExport('run-export-1', 50, scope)

    const expectedFrames = [{ kind: 'sync_run', id: 'run-export-1', meta: { direction: 'export' } }]
    expect(observedInAdapter).toHaveLength(2)
    expect(observedCommits).toHaveLength(1)
    for (const envelope of [...observedInAdapter, ...observedCommits]) {
      expect(envelope!.frames).toEqual(expectedFrames)
    }
    expect(getAmbientCausation()).toBeNull()
  })

  it('stacks the sync_run frame on the causation restored for the job and keeps its correlation', async () => {
    const observedInAdapter: Array<CausationEnvelope | null> = []
    const observedCommits: Array<CausationEnvelope | null> = []
    mockGetDataSyncAdapter.mockReturnValue(importAdapter(observedInAdapter))
    const { engine } = createHarness(runRecord('run-import-2', 'import'), observedCommits)

    const entry = await runEntryWithCausation({ kind: 'schedule', id: 'schedule-1' }, async () => {
      await engine.runImport('run-import-2', 50, scope)
      return getAmbientCausation()
    })

    expect(observedCommits[0]!.frames).toEqual([
      { kind: 'schedule', id: 'schedule-1' },
      { kind: 'sync_run', id: 'run-import-2', meta: { direction: 'import' } },
    ])
    expect(observedCommits[0]!.correlationId).toBe(entry!.correlationId)
    expect(entry!.frames).toEqual([{ kind: 'schedule', id: 'schedule-1' }])
  })

  it('propagates import failures unchanged', async () => {
    mockGetDataSyncAdapter.mockReturnValue(null)
    const { engine } = createHarness(runRecord('run-import-3', 'import'), [])

    await expect(engine.runImport('run-import-3', 50, scope)).rejects.toThrow(
      'No import adapter registered for provider excel',
    )
    expect(getAmbientCausation()).toBeNull()
  })

  it('propagates export failures with the original error instance', async () => {
    const failure = new Error('run lookup failed')
    const { engine, syncRunService } = createHarness(runRecord('run-export-2', 'export'), [])
    ;(syncRunService.getRun as jest.Mock).mockRejectedValueOnce(failure)

    await expect(engine.runExport('run-export-2', 50, scope)).rejects.toBe(failure)
    expect(getAmbientCausation()).toBeNull()
  })
})
