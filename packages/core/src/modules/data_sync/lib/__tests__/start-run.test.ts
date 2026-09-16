/** @jest-environment node */

import type { DataSyncAdapter } from '../adapter'
import { getSyncQueue } from '../queue'
import { resolveAdapterForIntegration } from '../adapter-registry'
import { startDataSyncRun, type StartDataSyncRunInput } from '../start-run'

jest.mock('../queue', () => ({
  getSyncQueue: jest.fn(),
}))

jest.mock('../adapter-registry', () => ({
  resolveAdapterForIntegration: jest.fn(),
}))

const getSyncQueueMock = getSyncQueue as jest.MockedFunction<typeof getSyncQueue>
const resolveAdapterMock = resolveAdapterForIntegration as jest.MockedFunction<typeof resolveAdapterForIntegration>

const SCOPE = { organizationId: 'org-1', tenantId: 'tenant-1', userId: 'user-1' }

function buildAdapter(overrides: Partial<DataSyncAdapter> = {}): DataSyncAdapter {
  return {
    providerKey: 'mixed-provider',
    direction: 'import',
    supportedEntities: ['orders.feed', 'orders.backfill'],
    getMapping: async ({ entityType }) => ({ entityType, matchStrategy: 'externalId' as const, fields: [] }),
    ...overrides,
  }
}

async function start(input: Partial<StartDataSyncRunInput> = {}) {
  const enqueue = jest.fn(async () => undefined)
  getSyncQueueMock.mockReturnValue({ enqueue } as unknown as ReturnType<typeof getSyncQueue>)

  await startDataSyncRun({
    syncRunService: {
      createRun: jest.fn(async () => ({ id: 'run-1' })),
    } as unknown as Parameters<typeof startDataSyncRun>[0]['syncRunService'],
    progressService: {
      createJob: jest.fn(async () => ({ id: 'job-1' })),
    } as unknown as Parameters<typeof startDataSyncRun>[0]['progressService'],
    scope: SCOPE,
    input: {
      integrationId: 'generic_sync',
      entityType: 'orders.backfill',
      direction: 'import',
      ...input,
    },
  })

  return enqueue.mock.calls[0]?.[0] as { batchSize: number }
}

beforeEach(() => {
  jest.clearAllMocks()
  resolveAdapterMock.mockReturnValue(null)
})

describe('startDataSyncRun — page size', () => {
  it('enqueues core’s default when neither the caller nor an adapter names one', async () => {
    expect((await start()).batchSize).toBe(100)
  })

  it('enqueues the adapter’s declared default for the entity type', async () => {
    resolveAdapterMock.mockReturnValue(buildAdapter({
      defaultBatchSize: (entityType) => (entityType === 'orders.backfill' ? 500 : undefined),
    }))

    expect((await start()).batchSize).toBe(500)
    expect((await start({ entityType: 'orders.feed' })).batchSize).toBe(100)
  })

  // The declaration is a default, not a ceiling: whoever starts the run still wins.
  it('prefers an explicit page size over the declaration', async () => {
    resolveAdapterMock.mockReturnValue(buildAdapter({ defaultBatchSize: () => 500 }))

    expect((await start({ batchSize: 25 })).batchSize).toBe(25)
  })

  it('falls back to core’s default when the declaration is unusable', async () => {
    resolveAdapterMock.mockReturnValue(buildAdapter({
      defaultBatchSize: () => {
        throw new Error('[internal] adapter hook blew up')
      },
    }))

    expect((await start()).batchSize).toBe(100)
  })
})
