jest.mock('@open-mercato/queue', () => ({
  createModuleQueue: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/redis/connection', () => ({
  getRedisUrl: jest.fn(),
}))

import type { AwilixContainer } from 'awilix'
import { createCatalogCategoriesWithProgress } from '../bulkCreateCategories'
import type { CategoryBulkCreateRow } from '../../data/validators'

const ORG = 'org-1'
const TENANT = 'tenant-1'

type Row = CategoryBulkCreateRow

function row(name: string, overrides: Partial<Row> = {}): Row {
  return { name, ...overrides }
}

function buildContainer(opts: {
  existingJobMeta?: Record<string, unknown> | null
  existingSlugs?: string[]
  existingParentIds?: string[]
  execute?: jest.Mock
  isCancellationRequested?: jest.Mock
}) {
  const execute = opts.execute ?? jest.fn().mockImplementation(async (_id: string, { input }: { input: Record<string, unknown> }) => ({
    result: { categoryId: `created-${input.name}` },
  }))

  const findCalls: unknown[] = []
  const find = jest.fn().mockImplementation(async (_entity: unknown, filter: Record<string, unknown>) => {
    findCalls.push(filter)
    if (Array.isArray((filter.slug as { $in?: string[] })?.$in)) {
      const slugs = (filter.slug as { $in: string[] }).$in
      return (opts.existingSlugs ?? []).filter((s) => slugs.includes(s)).map((s) => ({ slug: s, id: `existing-${s}` }))
    }
    if (Array.isArray((filter.id as { $in?: string[] })?.$in)) {
      const ids = (filter.id as { $in: string[] }).$in
      return (opts.existingParentIds ?? []).filter((id) => ids.includes(id)).map((id) => ({ id }))
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

describe('createCatalogCategoriesWithProgress', () => {
  it('creates every row and reports the summary on completion', async () => {
    const items: Row[] = [row('Alpha'), row('Beta')]
    const mocks = buildContainer({})

    const summary = await createCatalogCategoriesWithProgress({
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

  it('fails a row whose slug already exists without calling the command', async () => {
    const items: Row[] = [row('Alpha', { slug: 'alpha' })]
    const mocks = buildContainer({ existingSlugs: ['alpha'] })

    const summary = await createCatalogCategoriesWithProgress({
      container: mocks.container,
      progressJobId: 'job-1',
      items,
      scope: { organizationId: ORG, tenantId: TENANT },
    })

    expect(mocks.execute).not.toHaveBeenCalled()
    expect(summary.failedItems).toEqual([
      { index: 0, name: 'Alpha', code: 'slug_taken', message: 'Category slug already exists for this organization.' },
    ])
  })

  it('fails a row whose parentId does not resolve without calling the command', async () => {
    const items: Row[] = [row('Alpha', { parentId: 'missing-parent' })]
    const mocks = buildContainer({ existingParentIds: [] })

    const summary = await createCatalogCategoriesWithProgress({
      container: mocks.container,
      progressJobId: 'job-1',
      items,
      scope: { organizationId: ORG, tenantId: TENANT },
    })

    expect(mocks.execute).not.toHaveBeenCalled()
    expect(summary.failedItems).toEqual([
      { index: 0, name: 'Alpha', code: 'parent_not_found', message: 'Parent category not found or inaccessible.' },
    ])
  })

  it('catches a command execution error into failedItems and continues the batch', async () => {
    const items: Row[] = [row('Alpha'), row('Beta')]
    const execute = jest.fn()
      .mockRejectedValueOnce(new Error('duplicate key'))
      .mockResolvedValueOnce({ result: { categoryId: 'created-Beta' } })
    const mocks = buildContainer({ execute })

    const summary = await createCatalogCategoriesWithProgress({
      container: mocks.container,
      progressJobId: 'job-1',
      items,
      scope: { organizationId: ORG, tenantId: TENANT },
    })

    expect(summary.createdCount).toBe(1)
    expect(summary.failedItems).toEqual([{ index: 0, name: 'Alpha', code: 'command_failed', message: 'duplicate key' }])
  })

  it('resumes from the checkpointed row and reports a summary covering the whole batch', async () => {
    const items: Row[] = [
      row('Alpha', { slug: 'alpha' }),
      row('Beta', { slug: 'beta' }),
      row('Gamma', { slug: 'gamma' }),
      row('Delta', { slug: 'delta' }),
    ]
    // A prior attempt persisted a checkpoint after row 0 (index 0) carrying the state it had
    // accumulated so far, then crashed after also creating row 1 ("Beta") but before the next
    // checkpoint.
    const mocks = buildContainer({
      existingJobMeta: {
        lastCompletedRowIndex: 0,
        priorNaturalKeys: [],
        checkpointSummary: { createdCount: 1, failedCount: 0, failedItems: [] },
      },
      existingSlugs: ['alpha', 'beta'],
    })

    const summary = await createCatalogCategoriesWithProgress({
      container: mocks.container,
      progressJobId: 'job-1',
      items,
      scope: { organizationId: ORG, tenantId: TENANT },
    })

    // Row 0 is not reprocessed, but its count is restored from the checkpoint rather than
    // dropped. Row 1 ("Beta") is reclaimed as a record this job created and NOT re-submitted
    // to the command. Rows 2-3 are genuinely new. All four rows appear in the summary.
    expect(mocks.execute).toHaveBeenCalledTimes(2)
    expect(mocks.execute).toHaveBeenNthCalledWith(1, 'catalog.categories.create', expect.objectContaining({
      input: expect.objectContaining({ name: 'Gamma' }),
    }))
    expect(mocks.execute).toHaveBeenNthCalledWith(2, 'catalog.categories.create', expect.objectContaining({
      input: expect.objectContaining({ name: 'Delta' }),
    }))
    expect(summary.createdCount).toBe(4)
    expect(summary.createdIds).toEqual(['existing-beta', 'created-Gamma', 'created-Delta'])
    expect(summary.failedItems).toEqual([])
  })

  it('does not re-create or report conflicts for rows behind a row the interrupted attempt failed', async () => {
    const items: Row[] = [
      row('Alpha', { slug: 'alpha' }),
      row('Beta', { slug: 'beta' }),
      row('Gamma', { slug: 'gamma' }),
      row('Delta', { slug: 'delta' }),
    ]
    // Row 1 failed inside the command during the interrupted attempt and left nothing behind,
    // while rows 2-3 were created. A missing row 1 must not be read as "rows 2-3 are new too".
    const mocks = buildContainer({
      existingJobMeta: {
        lastCompletedRowIndex: 0,
        priorNaturalKeys: [],
        checkpointSummary: { createdCount: 1, failedCount: 0, failedItems: [] },
      },
      existingSlugs: ['alpha', 'gamma', 'delta'],
    })

    const summary = await createCatalogCategoriesWithProgress({
      container: mocks.container,
      progressJobId: 'job-1',
      items,
      scope: { organizationId: ORG, tenantId: TENANT },
    })

    expect(mocks.execute).toHaveBeenCalledTimes(1)
    expect(mocks.execute).toHaveBeenCalledWith('catalog.categories.create', expect.objectContaining({
      input: expect.objectContaining({ name: 'Beta' }),
    }))
    expect(summary.createdCount).toBe(4)
    expect(summary.failedItems).toEqual([])
    expect(summary.createdIds).toEqual(['created-Beta', 'existing-gamma', 'existing-delta'])
  })

  it('reclaims rows created by an attempt that died before its first checkpoint landed', async () => {
    // The slug snapshot persists on the attempt's first progress write, so it can outlive an
    // attempt that never reached a checkpoint. Resume must still recognize what that attempt
    // created rather than reporting it as a conflict.
    const items: Row[] = [row('Alpha', { slug: 'alpha' }), row('Beta', { slug: 'beta' })]
    const mocks = buildContainer({
      existingJobMeta: { priorNaturalKeys: [] },
      existingSlugs: ['alpha'],
    })

    const summary = await createCatalogCategoriesWithProgress({
      container: mocks.container,
      progressJobId: 'job-1',
      items,
      scope: { organizationId: ORG, tenantId: TENANT },
    })

    expect(mocks.execute).toHaveBeenCalledTimes(1)
    expect(mocks.execute).toHaveBeenCalledWith('catalog.categories.create', expect.objectContaining({
      input: expect.objectContaining({ name: 'Beta' }),
    }))
    expect(summary.createdCount).toBe(2)
    expect(summary.createdIds).toEqual(['existing-alpha', 'created-Beta'])
    expect(summary.failedItems).toEqual([])
  })

  it('reports a resumed row whose slug belongs to a pre-existing record as a conflict', async () => {
    const items: Row[] = [row('Alpha', { slug: 'alpha' }), row('Beta', { slug: 'beta' })]
    const mocks = buildContainer({
      existingJobMeta: {
        lastCompletedRowIndex: 0,
        priorNaturalKeys: ['slug:beta'],
        checkpointSummary: { createdCount: 1, failedCount: 0, failedItems: [] },
      },
      existingSlugs: ['alpha', 'beta'],
    })

    const summary = await createCatalogCategoriesWithProgress({
      container: mocks.container,
      progressJobId: 'job-1',
      items,
      scope: { organizationId: ORG, tenantId: TENANT },
    })

    expect(mocks.execute).not.toHaveBeenCalled()
    expect(summary.createdIds).not.toContain('existing-beta')
    expect(summary.failedItems).toEqual([
      { index: 1, name: 'Beta', code: 'slug_taken', message: 'Category slug already exists for this organization.' },
    ])
  })

  it('creates every slugless row on a resumed batch instead of matching them by name', async () => {
    const items: Row[] = [row('Duplicate'), row('Duplicate'), row('Duplicate')]
    const mocks = buildContainer({
      existingJobMeta: {
        lastCompletedRowIndex: 0,
        priorNaturalKeys: [],
        checkpointSummary: { createdCount: 1, failedCount: 0, failedItems: [] },
      },
    })

    const summary = await createCatalogCategoriesWithProgress({
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

  it('accounts for a row whose command resolves without a category id', async () => {
    const items: Row[] = [row('Alpha'), row('Beta')]
    const execute = jest.fn()
      .mockResolvedValueOnce({ result: {} })
      .mockResolvedValueOnce({ result: { categoryId: 'created-Beta' } })
    const mocks = buildContainer({ execute })

    const summary = await createCatalogCategoriesWithProgress({
      container: mocks.container,
      progressJobId: 'job-1',
      items,
      scope: { organizationId: ORG, tenantId: TENANT },
    })

    expect(summary.createdCount + summary.failedCount).toBe(items.length)
    expect(summary.failedItems).toEqual([
      { index: 0, name: 'Alpha', code: 'command_failed', message: 'Category creation returned no category id.' },
    ])
  })

  it('records the pre-existing natural keys on the attempt that starts the batch', async () => {
    const items: Row[] = [row('Alpha', { slug: 'alpha' }), row('Beta', { slug: 'beta' })]
    const mocks = buildContainer({ existingSlugs: ['beta'] })

    await createCatalogCategoriesWithProgress({
      container: mocks.container,
      progressJobId: 'job-1',
      items,
      scope: { organizationId: ORG, tenantId: TENANT },
    })

    expect(mocks.updateProgress.mock.calls[0][1]).toMatchObject({
      totalCount: 2,
      processedCount: 0,
      meta: { priorNaturalKeys: ['slug:beta'] },
    })
  })

  it('restores failures recorded before the checkpoint so a resumed summary keeps them', async () => {
    const items: Row[] = [row('Alpha'), row('Beta')]
    const priorFailure = { index: 0, name: 'Alpha', code: 'command_failed', message: 'duplicate key' }
    const mocks = buildContainer({
      existingJobMeta: {
        lastCompletedRowIndex: 0,
        checkpointSummary: { createdCount: 0, createdIds: [], failedItems: [priorFailure] },
      },
    })

    const summary = await createCatalogCategoriesWithProgress({
      container: mocks.container,
      progressJobId: 'job-1',
      items,
      scope: { organizationId: ORG, tenantId: TENANT },
    })

    expect(summary.failedCount).toBe(1)
    expect(summary.failedItems).toEqual([priorFailure])
    expect(summary.createdCount).toBe(1)
  })

  it('resumes safely when the checkpoint predates the accumulated-summary shape', async () => {
    const items: Row[] = [row('Alpha'), row('Beta')]
    // A job enqueued before this shape existed carries only `lastCompletedRowIndex`. It must
    // resume rather than throw; the pre-checkpoint rows are simply unrecoverable there.
    const mocks = buildContainer({ existingJobMeta: { lastCompletedRowIndex: 0 } })

    const summary = await createCatalogCategoriesWithProgress({
      container: mocks.container,
      progressJobId: 'job-1',
      items,
      scope: { organizationId: ORG, tenantId: TENANT },
    })

    expect(summary.createdCount).toBe(1)
    expect(summary.createdIds).toEqual(['created-Beta'])
  })

  it('keeps the checkpoint payload bounded by persisting counts rather than every created id', async () => {
    const items: Row[] = [row('Alpha'), row('Beta')]
    const mocks = buildContainer({})

    await createCatalogCategoriesWithProgress({
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

    const summary = await createCatalogCategoriesWithProgress({
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

    await createCatalogCategoriesWithProgress({
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
