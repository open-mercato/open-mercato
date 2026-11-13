/** @jest-environment node */

import type { ProgressService } from '../../../progress/lib/progressService'
import type { DataSyncAdapter } from '../adapter'
import type { SyncRunService } from '../sync-run-service'

const mockGetIntegration = jest.fn()
const mockEnqueue = jest.fn(async () => 'job-1')
const mockReportError = jest.fn()

jest.mock('@open-mercato/shared/modules/integrations/types', () => ({
  getIntegration: (...args: unknown[]) => mockGetIntegration(...args),
}))

jest.mock('../queue', () => ({
  getSyncQueue: () => ({ enqueue: mockEnqueue }),
}))

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: mockReportError }),
}))

import { registerDataSyncAdapter } from '../adapter-registry'
import { startDataSyncRun, type StartDataSyncRunInput } from '../start-run'

const REGISTRY_KEY = Symbol.for('@open-mercato/data-sync/adapter-registry')
const SCOPE = { organizationId: 'org-1', tenantId: 'tenant-1', userId: 'user-1' }

function clearGlobalRegistry(): void {
  delete (globalThis as Record<symbol, unknown>)[REGISTRY_KEY]
}

function buildAdapter(overrides: Partial<DataSyncAdapter> = {}): DataSyncAdapter {
  return {
    providerKey: 'feed-provider',
    direction: 'import',
    supportedEntities: ['catalog.product', 'sales.order'],
    getMapping: async ({ entityType }) => ({ entityType, matchStrategy: 'externalId' as const, fields: [] }),
    ...overrides,
  }
}

function buildServices() {
  const createJob = jest.fn(async () => ({ id: 'progress-1' }))
  const createRun = jest.fn(async () => ({ id: 'run-1' }))
  return {
    createJob,
    createRun,
    progressService: { createJob } as unknown as ProgressService,
    syncRunService: { createRun } as unknown as SyncRunService,
  }
}

async function start(input: Partial<StartDataSyncRunInput> = {}) {
  const services = buildServices()
  await startDataSyncRun({
    syncRunService: services.syncRunService,
    progressService: services.progressService,
    scope: SCOPE,
    input: { integrationId: 'sync_feed', entityType: 'sales.order', direction: 'import', ...input },
  })
  return services
}

function createdJob(createJob: jest.Mock): Record<string, unknown> {
  expect(createJob).toHaveBeenCalledTimes(1)
  return createJob.mock.calls[0][0] as Record<string, unknown>
}

const DEFAULT_JOB = {
  jobType: 'data_sync:import',
  name: 'Data sync sync_feed — sales.order',
  description: 'sales.order import',
  cancellable: true,
  meta: { integrationId: 'sync_feed', entityType: 'sales.order', direction: 'import' },
}

describe('startDataSyncRun — adapter-described progress job', () => {
  beforeEach(() => {
    clearGlobalRegistry()
    jest.clearAllMocks()
    mockGetIntegration.mockReturnValue({ providerKey: 'feed-provider' })
  })

  afterEach(clearGlobalRegistry)

  it('keeps the core defaults when the adapter declares no hook', async () => {
    registerDataSyncAdapter(buildAdapter())

    const { createJob } = await start()

    expect(createdJob(createJob)).toEqual(DEFAULT_JOB)
  })

  it('keeps the core defaults when no adapter is registered for the integration', async () => {
    const { createJob, createRun } = await start()

    expect(createdJob(createJob)).toEqual(DEFAULT_JOB)
    expect(createRun).toHaveBeenCalledWith(expect.objectContaining({ progressJobId: 'progress-1' }), expect.anything())
  })

  it('keeps the core defaults when the hook answers undefined', async () => {
    registerDataSyncAdapter(buildAdapter({ describeProgressJob: () => undefined }))

    const { createJob } = await start()

    expect(createdJob(createJob)).toEqual(DEFAULT_JOB)
  })

  it('asks the hook with the run entity type and direction and merges its answer over the defaults', async () => {
    const describeProgressJob = jest.fn((input: { entityType: string; direction: 'import' | 'export' }) =>
      input.entityType === 'sales.order'
        ? { name: 'Order feed', description: 'Live order feed', meta: { hiddenFromTopBar: true } }
        : undefined,
    )
    registerDataSyncAdapter(buildAdapter({ describeProgressJob }))

    const { createJob } = await start()

    expect(describeProgressJob).toHaveBeenCalledTimes(1)
    expect(describeProgressJob).toHaveBeenCalledWith({ entityType: 'sales.order', direction: 'import' })
    expect(createdJob(createJob)).toEqual({
      ...DEFAULT_JOB,
      name: 'Order feed',
      description: 'Live order feed',
      meta: { ...DEFAULT_JOB.meta, hiddenFromTopBar: true },
    })
  })

  it('lets the caller progressJob override the adapter key by key', async () => {
    registerDataSyncAdapter(buildAdapter({
      describeProgressJob: () => ({
        name: 'Order feed',
        description: 'Live order feed',
        meta: { hiddenFromTopBar: true, source: 'adapter' },
      }),
    }))

    const { createJob } = await start({
      progressJob: { name: 'Caller name', meta: { hiddenFromTopBar: false, uploadId: 'upload-1' } },
    })

    expect(createdJob(createJob)).toEqual({
      ...DEFAULT_JOB,
      name: 'Caller name',
      description: 'Live order feed',
      meta: { ...DEFAULT_JOB.meta, hiddenFromTopBar: false, source: 'adapter', uploadId: 'upload-1' },
    })
  })

  it('does not let adapter meta overwrite the keys that identify the run', async () => {
    registerDataSyncAdapter(buildAdapter({
      describeProgressJob: () => ({
        meta: { integrationId: 'other', entityType: 'other.entity', direction: 'export', hiddenFromTopBar: true },
      }),
    }))

    const { createJob } = await start()

    expect(createdJob(createJob)).toEqual({ ...DEFAULT_JOB, meta: { ...DEFAULT_JOB.meta, hiddenFromTopBar: true } })
  })

  it('falls back to the defaults and reports the error when the hook throws', async () => {
    const failure = new Error('describe exploded')
    registerDataSyncAdapter(buildAdapter({
      describeProgressJob: () => {
        throw failure
      },
    }))

    const { createJob, createRun } = await start()

    expect(createdJob(createJob)).toEqual(DEFAULT_JOB)
    expect(createRun).toHaveBeenCalledTimes(1)
    expect(mockEnqueue).toHaveBeenCalledTimes(1)
    expect(mockReportError).toHaveBeenCalledWith(failure, expect.objectContaining({
      module: 'data_sync',
      code: 'data_sync.progress_job_description_failed',
    }))
  })

  it('still starts the run when reporting the hook failure to telemetry throws too', async () => {
    mockReportError.mockImplementationOnce(() => {
      throw new Error('telemetry sink down')
    })
    registerDataSyncAdapter(buildAdapter({
      describeProgressJob: () => {
        throw new Error('describe exploded')
      },
    }))

    const { createJob, createRun } = await start()

    expect(createdJob(createJob)).toEqual(DEFAULT_JOB)
    expect(createRun).toHaveBeenCalledTimes(1)
    expect(mockEnqueue).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['a non-object answer', 'hidden'],
    ['an array', [{ meta: { hiddenFromTopBar: true } }]],
    ['a meta that is not a record', { meta: ['hiddenFromTopBar'] }],
    ['a non-string name', { name: 42, meta: { hiddenFromTopBar: true } }],
    ['an empty name', { name: '' }],
  ])('drops %s whole and keeps the defaults', async (_label, answer) => {
    registerDataSyncAdapter(buildAdapter({
      describeProgressJob: (() => answer) as unknown as DataSyncAdapter['describeProgressJob'],
    }))

    const { createJob } = await start()

    expect(createdJob(createJob)).toEqual(DEFAULT_JOB)
  })

  it('ignores keys outside the description, so an adapter cannot change the job type or cancellability', async () => {
    registerDataSyncAdapter(buildAdapter({
      describeProgressJob: (() => ({
        jobType: 'something-else',
        cancellable: false,
        meta: { hiddenFromTopBar: true },
      })) as unknown as DataSyncAdapter['describeProgressJob'],
    }))

    const { createJob } = await start()

    expect(createdJob(createJob)).toEqual({ ...DEFAULT_JOB, meta: { ...DEFAULT_JOB.meta, hiddenFromTopBar: true } })
  })

  it('does not consult the hook when no progress job is created', async () => {
    const describeProgressJob = jest.fn(() => ({ meta: { hiddenFromTopBar: true } }))
    registerDataSyncAdapter(buildAdapter({ describeProgressJob }))

    const { createJob, createRun } = await start({ createProgressJob: false })

    expect(describeProgressJob).not.toHaveBeenCalled()
    expect(createJob).not.toHaveBeenCalled()
    expect(createRun).toHaveBeenCalledWith(expect.objectContaining({ progressJobId: null }), expect.anything())
  })
})
