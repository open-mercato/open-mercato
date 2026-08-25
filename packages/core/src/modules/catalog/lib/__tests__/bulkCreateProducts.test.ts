jest.mock('@open-mercato/queue', () => ({
  createModuleQueue: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/redis/connection', () => ({
  getRedisUrl: jest.fn(),
}))

import type { AwilixContainer } from 'awilix'
import { createCatalogProductsWithProgress } from '../bulkCreateProducts'
import type { ProductBulkCreateRow } from '../../data/validators'

const ORG = 'org-1'
const TENANT = 'tenant-1'

type Row = ProductBulkCreateRow

function row(title: string, overrides: Partial<Row> = {}): Row {
  return { title, ...overrides } as Row
}

function buildContainer(opts: {
  existingJobMeta?: Record<string, unknown> | null
  existingSkus?: string[]
  existingHandles?: string[]
  alreadyCreatedByNaturalKey?: Array<{ sku?: string; handle?: string; title?: string; id: string }>
  execute?: jest.Mock
  isCancellationRequested?: jest.Mock
}) {
  const execute = opts.execute ?? jest.fn().mockImplementation(async (_id: string, { input }: { input: Record<string, unknown> }) => ({
    result: { productId: `created-${input.title}` },
  }))

  const findCalls: unknown[] = []
  const find = jest.fn().mockImplementation(async (_entity: unknown, filter: Record<string, unknown>) => {
    findCalls.push(filter)
    if (Array.isArray((filter.sku as { $in?: string[] })?.$in)) {
      const skus = (filter.sku as { $in: string[] }).$in
      return (opts.existingSkus ?? []).filter((s) => skus.includes(s)).map((s) => ({ sku: s, id: `existing-${s}` }))
    }
    if (Array.isArray((filter.handle as { $in?: string[] })?.$in)) {
      const handles = (filter.handle as { $in: string[] }).$in
      return (opts.existingHandles ?? []).filter((h) => handles.includes(h)).map((h) => ({ handle: h, id: `existing-${h}` }))
    }
    return []
  })

  const findOne = jest.fn().mockImplementation(async (_entity: unknown, filter: Record<string, unknown>) => {
    const rows = opts.alreadyCreatedByNaturalKey ?? []
    const match = rows.find((r) => {
      if (filter.sku) return r.sku === filter.sku
      if (filter.handle) return r.handle === filter.handle
      return r.title === filter.title
    })
    return match ? { id: match.id, sku: match.sku ?? null, handle: match.handle ?? null } : null
  })

  const isCancellationRequested = opts.isCancellationRequested ?? jest.fn().mockResolvedValue(false)
  const updateProgress = jest.fn().mockResolvedValue(undefined)
  const startJob = jest.fn().mockResolvedValue(undefined)
  const completeJob = jest.fn().mockResolvedValue(undefined)
  const markCancelled = jest.fn().mockResolvedValue(undefined)
  const getJob = jest.fn().mockResolvedValue(
    opts.existingJobMeta === undefined ? { meta: null } : { meta: opts.existingJobMeta },
  )

  const container = {
    resolve: jest.fn((name: string) => {
      if (name === 'commandBus') return { execute }
      if (name === 'progressService') {
        return { getJob, startJob, updateProgress, isCancellationRequested, markCancelled, completeJob }
      }
      if (name === 'em') return { find, findOne }
      return undefined
    }),
  } as unknown as AwilixContainer

  return { container, execute, find, findOne, updateProgress, startJob, completeJob, markCancelled, getJob, isCancellationRequested }
}

describe('createCatalogProductsWithProgress', () => {
  it('creates every row and reports the summary on completion', async () => {
    const items: Row[] = [row('Alpha'), row('Beta')]
    const mocks = buildContainer({})

    const summary = await createCatalogProductsWithProgress({
      container: mocks.container,
      progressJobId: 'job-1',
      items,
      scope: { organizationId: ORG, tenantId: TENANT, userId: 'user-1' },
    })

    expect(mocks.execute).toHaveBeenCalledTimes(2)
    expect(summary).toEqual({
      createdCount: 2,
      failedCount: 0,
      createdIds: ['created-Alpha', 'created-Beta'],
      failedItems: [],
    })
    expect(mocks.completeJob).toHaveBeenCalledWith('job-1', { resultSummary: summary }, expect.objectContaining({ tenantId: TENANT, organizationId: ORG }))
  })

  it('fails a row whose sku already exists without calling the command', async () => {
    const items: Row[] = [row('Alpha', { sku: 'sku-1' })]
    const mocks = buildContainer({ existingSkus: ['sku-1'] })

    const summary = await createCatalogProductsWithProgress({
      container: mocks.container,
      progressJobId: 'job-1',
      items,
      scope: { organizationId: ORG, tenantId: TENANT },
    })

    expect(mocks.execute).not.toHaveBeenCalled()
    expect(summary.failedItems).toEqual([
      { index: 0, title: 'Alpha', message: 'Product SKU already exists for this organization.' },
    ])
  })

  it('fails a row whose handle already exists without calling the command', async () => {
    const items: Row[] = [row('Alpha', { handle: 'alpha-handle' })]
    const mocks = buildContainer({ existingHandles: ['alpha-handle'] })

    const summary = await createCatalogProductsWithProgress({
      container: mocks.container,
      progressJobId: 'job-1',
      items,
      scope: { organizationId: ORG, tenantId: TENANT },
    })

    expect(mocks.execute).not.toHaveBeenCalled()
    expect(summary.failedItems).toEqual([
      { index: 0, title: 'Alpha', message: 'Product handle already exists for this organization.' },
    ])
  })

  it('fails a row whose sku collides with an earlier row in the same batch', async () => {
    const items: Row[] = [row('Alpha', { sku: 'dup' }), row('Beta', { sku: 'dup' })]
    const mocks = buildContainer({})

    const summary = await createCatalogProductsWithProgress({
      container: mocks.container,
      progressJobId: 'job-1',
      items,
      scope: { organizationId: ORG, tenantId: TENANT },
    })

    expect(mocks.execute).toHaveBeenCalledTimes(1)
    expect(summary.createdCount).toBe(1)
    expect(summary.failedItems).toEqual([
      { index: 1, title: 'Beta', message: 'Product SKU already exists for this organization.' },
    ])
  })

  it('catches a command execution error into failedItems and continues the batch', async () => {
    const items: Row[] = [row('Alpha'), row('Beta')]
    const execute = jest.fn()
      .mockRejectedValueOnce(new Error('duplicate key'))
      .mockResolvedValueOnce({ result: { productId: 'created-Beta' } })
    const mocks = buildContainer({ execute })

    const summary = await createCatalogProductsWithProgress({
      container: mocks.container,
      progressJobId: 'job-1',
      items,
      scope: { organizationId: ORG, tenantId: TENANT },
    })

    expect(summary.createdCount).toBe(1)
    expect(summary.failedItems).toEqual([{ index: 0, title: 'Alpha', message: 'duplicate key' }])
  })

  it('resumes from the checkpointed row and recognizes rows already created before the crash', async () => {
    const items: Row[] = [row('Alpha'), row('Beta'), row('Gamma'), row('Delta')]
    const mocks = buildContainer({
      existingJobMeta: { lastCompletedRowIndex: 0 },
      alreadyCreatedByNaturalKey: [{ title: 'Beta', id: 'existing-beta' }],
    })

    const summary = await createCatalogProductsWithProgress({
      container: mocks.container,
      progressJobId: 'job-1',
      items,
      scope: { organizationId: ORG, tenantId: TENANT },
    })

    expect(mocks.execute).toHaveBeenCalledTimes(2)
    expect(mocks.execute).toHaveBeenNthCalledWith(1, 'catalog.products.create', expect.objectContaining({
      input: expect.objectContaining({ title: 'Gamma' }),
    }))
    expect(mocks.execute).toHaveBeenNthCalledWith(2, 'catalog.products.create', expect.objectContaining({
      input: expect.objectContaining({ title: 'Delta' }),
    }))
    expect(summary.createdIds).toEqual(['existing-beta', 'created-Gamma', 'created-Delta'])
    expect(summary.failedItems).toEqual([])
  })

  it('stops the batch and marks the job cancelled when cancellation is requested mid-flight', async () => {
    const items: Row[] = [row('Alpha'), row('Beta'), row('Gamma')]
    const isCancellationRequested = jest.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
    const mocks = buildContainer({ isCancellationRequested })

    const summary = await createCatalogProductsWithProgress({
      container: mocks.container,
      progressJobId: 'job-1',
      items,
      scope: { organizationId: ORG, tenantId: TENANT },
    })

    expect(mocks.execute).toHaveBeenCalledTimes(1)
    expect(summary.createdCount).toBe(1)
    expect(mocks.markCancelled).toHaveBeenCalledTimes(1)
    expect(mocks.completeJob).not.toHaveBeenCalled()
  })

  it('checkpoints lastCompletedRowIndex on the final row even below the 20-row interval', async () => {
    const items: Row[] = [row('Alpha'), row('Beta')]
    const mocks = buildContainer({})

    await createCatalogProductsWithProgress({
      container: mocks.container,
      progressJobId: 'job-1',
      items,
      scope: { organizationId: ORG, tenantId: TENANT },
    })

    const checkpointCalls = mocks.updateProgress.mock.calls.filter(([, input]) => (input as { meta?: Record<string, unknown> }).meta?.lastCompletedRowIndex !== undefined)
    expect(checkpointCalls).toHaveLength(1)
    expect(checkpointCalls[0][1]).toMatchObject({ processedCount: 2, meta: { lastCompletedRowIndex: 1 } })
  })
})
