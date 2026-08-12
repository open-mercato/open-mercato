/** @jest-environment node */

import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { SyncCursor, SyncRun } from '../../data/entities'
import { createSyncRunService } from '../sync-run-service'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
  findWithDecryption: jest.fn().mockResolvedValue([]),
  findAndCountWithDecryption: jest.fn().mockResolvedValue([[], 0]),
}))

const SCOPE = { organizationId: 'org-1', tenantId: 'tenant-1' }

function buildFakeEm() {
  return {
    begin: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
    flush: jest.fn().mockResolvedValue(undefined),
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({ ...data })),
  }
}

function buildRun(overrides: Record<string, unknown> = {}) {
  return {
    id: 'run-1',
    integrationId: 'sync_backfill',
    entityType: 'catalog.product',
    direction: 'import' as const,
    createdCount: 0,
    updatedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    batchesCompleted: 0,
    cursor: 'run-cursor',
    ...overrides,
  }
}

function mockLookups(run: unknown, cursorRow: unknown) {
  ;(findOneWithDecryption as jest.Mock).mockImplementation((_em: unknown, entity: unknown) => {
    if (entity === SyncRun) return Promise.resolve(run)
    if (entity === SyncCursor) return Promise.resolve(cursorRow)
    return Promise.resolve(null)
  })
}

describe('SyncRunService cursor commits honour persistSharedCursor', () => {
  beforeEach(() => {
    ;(findOneWithDecryption as jest.Mock).mockReset()
    ;(findWithDecryption as jest.Mock).mockReset().mockResolvedValue([])
  })

  it('writes the shared cursor row when no options are passed', async () => {
    const em = buildFakeEm()
    const run = buildRun()
    mockLookups(run, null)

    const service = createSyncRunService(em as any)
    await service.commitBatchProgress('run-1', { createdCount: 1, batchesCompleted: 1 }, 'batch-1', SCOPE)

    expect(run.cursor).toBe('batch-1')
    expect(em.create).toHaveBeenCalledWith(SyncCursor, expect.objectContaining({ cursor: 'batch-1' }))
  })

  it('advances the run cursor without creating a shared row when the adapter opted out', async () => {
    const em = buildFakeEm()
    const run = buildRun()
    mockLookups(run, null)

    const service = createSyncRunService(em as any)
    await service.commitBatchProgress(
      'run-1',
      { createdCount: 2, batchesCompleted: 1 },
      'batch-2',
      SCOPE,
      { persistSharedCursor: false },
    )

    expect(run.cursor).toBe('batch-2')
    expect(run.createdCount).toBe(2)
    expect(em.create).not.toHaveBeenCalled()
    expect(em.commit).toHaveBeenCalledTimes(1)
  })

  it('leaves an inherited shared cursor row untouched when the adapter opted out', async () => {
    const em = buildFakeEm()
    const run = buildRun()
    const cursorRow = { cursor: 'inherited-cursor' }
    mockLookups(run, cursorRow)

    const service = createSyncRunService(em as any)
    await service.commitBatchProgress(
      'run-1',
      { updatedCount: 1, batchesCompleted: 1 },
      'batch-3',
      SCOPE,
      { persistSharedCursor: false },
    )

    expect(cursorRow.cursor).toBe('inherited-cursor')
    expect(run.cursor).toBe('batch-3')
  })

  it('skips the shared cursor row lookup entirely when the adapter opted out', async () => {
    const em = buildFakeEm()
    mockLookups(buildRun(), { cursor: 'inherited-cursor' })

    const service = createSyncRunService(em as any)
    await service.commitBatchProgress('run-1', { batchesCompleted: 1 }, 'batch-4', SCOPE, { persistSharedCursor: false })

    const cursorLookups = (findOneWithDecryption as jest.Mock).mock.calls.filter(([, entity]) => entity === SyncCursor)
    expect(cursorLookups).toHaveLength(0)
  })

  it('applies the same opt-out to updateCursor', async () => {
    const em = buildFakeEm()
    const run = buildRun()
    const cursorRow = { cursor: 'inherited-cursor' }
    mockLookups(run, cursorRow)

    const service = createSyncRunService(em as any)
    await service.updateCursor('run-1', 'advanced-cursor', SCOPE, { persistSharedCursor: false })

    expect(run.cursor).toBe('advanced-cursor')
    expect(cursorRow.cursor).toBe('inherited-cursor')
    expect(em.create).not.toHaveBeenCalled()
  })
})

describe('SyncRunService.resolveResumeCursor', () => {
  beforeEach(() => {
    ;(findOneWithDecryption as jest.Mock).mockReset()
    ;(findWithDecryption as jest.Mock).mockReset().mockResolvedValue([])
  })

  it('returns the cursor of the most recent run that never completed', async () => {
    const em = buildFakeEm()
    ;(findWithDecryption as jest.Mock).mockResolvedValue([{ cursor: 'interrupted-cursor' }])

    const service = createSyncRunService(em as any)
    const cursor = await service.resolveResumeCursor('sync_backfill', 'catalog.product', 'import', SCOPE)

    expect(cursor).toBe('interrupted-cursor')
    expect(findWithDecryption).toHaveBeenCalledWith(
      em,
      SyncRun,
      expect.objectContaining({
        integrationId: 'sync_backfill',
        entityType: 'catalog.product',
        direction: 'import',
        status: { $ne: 'completed' },
        organizationId: 'org-1',
        tenantId: 'tenant-1',
        deletedAt: null,
      }),
      { orderBy: { createdAt: 'DESC' }, limit: 1 },
      SCOPE,
    )
  })

  it('returns null when the last run completed', async () => {
    const em = buildFakeEm()
    ;(findWithDecryption as jest.Mock).mockResolvedValue([])

    const service = createSyncRunService(em as any)
    await expect(service.resolveResumeCursor('sync_backfill', 'catalog.product', 'import', SCOPE)).resolves.toBeNull()
  })
})
