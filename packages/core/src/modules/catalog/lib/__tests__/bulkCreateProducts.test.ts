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

  // Resume no longer probes row by row; the batch pre-validation query supplies everything it
  // needs. Kept so tests can assert that no per-row lookup sneaks back in.
  const findOne = jest.fn().mockResolvedValue(null)

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
      { index: 0, title: 'Alpha', code: 'sku_taken', message: 'Product SKU already exists for this organization.' },
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
      { index: 0, title: 'Alpha', code: 'handle_taken', message: 'Product handle already exists for this organization.' },
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
      { index: 1, title: 'Beta', code: 'sku_taken', message: 'Product SKU already exists for this organization.' },
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
    expect(summary.failedItems).toEqual([{ index: 0, title: 'Alpha', code: 'command_failed', message: 'duplicate key' }])
  })

  it('resumes from the checkpointed row and reports a summary covering the whole batch', async () => {
    const items: Row[] = [
      row('Alpha', { sku: 'sku-alpha' }),
      row('Beta', { sku: 'sku-beta' }),
      row('Gamma', { sku: 'sku-gamma' }),
      row('Delta', { sku: 'sku-delta' }),
    ]
    const mocks = buildContainer({
      existingJobMeta: {
        lastCompletedRowIndex: 0,
        priorNaturalKeys: [],
        checkpointSummary: { createdCount: 1, failedCount: 0, failedItems: [] },
      },
      existingSkus: ['sku-alpha', 'sku-beta'],
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
    expect(summary.createdCount).toBe(4)
    expect(summary.createdIds).toEqual(['existing-sku-beta', 'created-Gamma', 'created-Delta'])
    expect(summary.failedItems).toEqual([])
  })

  it('does not re-create or report conflicts for rows behind a row the interrupted attempt failed', async () => {
    // The interrupted attempt checkpointed at row 0, then failed row 1 and created rows 2-3
    // before dying. Row 1 left nothing behind, which must not be read as "nothing after it
    // was created either".
    const items: Row[] = [
      row('Alpha', { sku: 'sku-alpha' }),
      row('Beta', { sku: 'sku-beta' }),
      row('Gamma', { sku: 'sku-gamma' }),
      row('Delta', { sku: 'sku-delta' }),
    ]
    const mocks = buildContainer({
      existingJobMeta: {
        lastCompletedRowIndex: 0,
        priorNaturalKeys: [],
        checkpointSummary: { createdCount: 1, failedCount: 0, failedItems: [] },
      },
      existingSkus: ['sku-alpha', 'sku-gamma', 'sku-delta'],
    })

    const summary = await createCatalogProductsWithProgress({
      container: mocks.container,
      progressJobId: 'job-1',
      items,
      scope: { organizationId: ORG, tenantId: TENANT },
    })

    expect(mocks.execute).toHaveBeenCalledTimes(1)
    expect(mocks.execute).toHaveBeenCalledWith('catalog.products.create', expect.objectContaining({
      input: expect.objectContaining({ title: 'Beta' }),
    }))
    expect(summary.createdCount).toBe(4)
    expect(summary.failedItems).toEqual([])
    expect(summary.createdIds).toEqual(['created-Beta', 'existing-sku-gamma', 'existing-sku-delta'])
  })

  it('reclaims rows created by an attempt that died before its first checkpoint landed', async () => {
    // The key snapshot persists on the attempt's first progress write, so it can outlive an
    // attempt that never reached a checkpoint. Resume must still recognize what that attempt
    // created rather than reporting it as a conflict.
    const items: Row[] = [row('Alpha', { sku: 'sku-alpha' }), row('Beta', { sku: 'sku-beta' })]
    const mocks = buildContainer({
      existingJobMeta: { priorNaturalKeys: [] },
      existingSkus: ['sku-alpha'],
    })

    const summary = await createCatalogProductsWithProgress({
      container: mocks.container,
      progressJobId: 'job-1',
      items,
      scope: { organizationId: ORG, tenantId: TENANT },
    })

    expect(mocks.execute).toHaveBeenCalledTimes(1)
    expect(mocks.execute).toHaveBeenCalledWith('catalog.products.create', expect.objectContaining({
      input: expect.objectContaining({ title: 'Beta' }),
    }))
    expect(summary.createdCount).toBe(2)
    expect(summary.createdIds).toEqual(['existing-sku-alpha', 'created-Beta'])
    expect(summary.failedItems).toEqual([])
  })

  it('reports a resumed row whose sku belongs to a pre-existing record as a conflict', async () => {
    const items: Row[] = [row('Alpha', { sku: 'sku-alpha' }), row('Beta', { sku: 'sku-beta' })]
    const mocks = buildContainer({
      existingJobMeta: {
        lastCompletedRowIndex: 0,
        priorNaturalKeys: ['sku:sku-beta'],
        checkpointSummary: { createdCount: 1, failedCount: 0, failedItems: [] },
      },
      existingSkus: ['sku-alpha', 'sku-beta'],
    })

    const summary = await createCatalogProductsWithProgress({
      container: mocks.container,
      progressJobId: 'job-1',
      items,
      scope: { organizationId: ORG, tenantId: TENANT },
    })

    expect(mocks.execute).not.toHaveBeenCalled()
    expect(summary.createdIds).not.toContain('existing-sku-beta')
    expect(summary.failedItems).toEqual([
      { index: 1, title: 'Beta', code: 'sku_taken', message: 'Product SKU already exists for this organization.' },
    ])
  })

  it('creates every keyless row on a resumed batch instead of matching them by title', async () => {
    const items: Row[] = [row('Duplicate'), row('Duplicate'), row('Duplicate')]
    const mocks = buildContainer({
      existingJobMeta: {
        lastCompletedRowIndex: 0,
        priorNaturalKeys: [],
        checkpointSummary: { createdCount: 1, failedCount: 0, failedItems: [] },
      },
    })

    const summary = await createCatalogProductsWithProgress({
      container: mocks.container,
      progressJobId: 'job-1',
      items,
      scope: { organizationId: ORG, tenantId: TENANT },
    })

    expect(mocks.findOne).not.toHaveBeenCalled()
    expect(mocks.execute).toHaveBeenCalledTimes(2)
    expect(summary.createdCount).toBe(3)
    expect(summary.failedItems).toEqual([])
  })

  it('accounts for a row whose command resolves without a product id', async () => {
    const items: Row[] = [row('Alpha'), row('Beta')]
    const execute = jest.fn()
      .mockResolvedValueOnce({ result: {} })
      .mockResolvedValueOnce({ result: { productId: 'created-Beta' } })
    const mocks = buildContainer({ execute })

    const summary = await createCatalogProductsWithProgress({
      container: mocks.container,
      progressJobId: 'job-1',
      items,
      scope: { organizationId: ORG, tenantId: TENANT },
    })

    expect(summary.createdCount + summary.failedCount).toBe(items.length)
    expect(summary.failedItems).toEqual([
      { index: 0, title: 'Alpha', code: 'command_failed', message: 'Product creation returned no product id.' },
    ])
  })

  it('records the pre-existing natural keys on the attempt that starts the batch', async () => {
    const items: Row[] = [row('Alpha', { sku: 'sku-alpha' }), row('Beta', { handle: 'beta-handle' })]
    const mocks = buildContainer({ existingSkus: ['sku-alpha'], existingHandles: ['beta-handle'] })

    await createCatalogProductsWithProgress({
      container: mocks.container,
      progressJobId: 'job-1',
      items,
      scope: { organizationId: ORG, tenantId: TENANT },
    })

    expect(mocks.updateProgress.mock.calls[0][1]).toMatchObject({
      totalCount: 2,
      processedCount: 0,
      meta: { priorNaturalKeys: ['sku:sku-alpha', 'handle:beta-handle'] },
    })
  })

  it('keeps the checkpoint payload bounded by persisting counts rather than every created id', async () => {
    const items: Row[] = [row('Alpha'), row('Beta')]
    const mocks = buildContainer({})

    await createCatalogProductsWithProgress({
      container: mocks.container,
      progressJobId: 'job-1',
      items,
      scope: { organizationId: ORG, tenantId: TENANT },
    })

    const checkpointCalls = mocks.updateProgress.mock.calls.filter(
      ([, input]) => (input as { meta?: Record<string, unknown> }).meta?.lastCompletedRowIndex !== undefined,
    )
    const lastCheckpoint = checkpointCalls[checkpointCalls.length - 1][1] as {
      meta: { checkpointSummary: Record<string, unknown> }
    }
    expect(lastCheckpoint).toMatchObject({
      meta: {
        lastCompletedRowIndex: 1,
        checkpointSummary: { createdCount: 2, failedCount: 0, failedItems: [] },
      },
    })
    expect(lastCheckpoint.meta.checkpointSummary).not.toHaveProperty('createdIds')
  })

  it('stops the batch and marks the job cancelled when cancellation is requested mid-flight', async () => {
    const items: Row[] = [row('Alpha'), row('Beta'), row('Gamma')]
    const isCancellationRequested = jest.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
    // Cancellation is polled on the checkpoint boundary, not per row, so this batch declares a
    // one-row interval to exercise the cancel between row 0 and row 1.
    const mocks = buildContainer({ existingJobMeta: { checkpointInterval: 1 }, isCancellationRequested })

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
