/** @jest-environment node */

import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { SyncCursor, SyncRun } from '../../data/entities'
import { createSyncRunService, SyncRunCursorConflictError } from '../sync-run-service'

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
    nativeUpdate: jest.fn().mockResolvedValue(1),
    refresh: jest.fn().mockResolvedValue(undefined),
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({ ...data })),
  }
}

function buildRun(overrides: Record<string, unknown> = {}) {
  return {
    id: 'run-1',
    integrationId: 'sync_excel',
    entityType: 'products',
    direction: 'import' as const,
    createdCount: 5,
    updatedCount: 1,
    skippedCount: 0,
    failedCount: 0,
    batchesCompleted: 2,
    cursor: 'old-cursor',
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

describe('SyncRunService.commitBatchProgress — atomic counter + cursor (issue #2341)', () => {
  beforeEach(() => {
    ;(findOneWithDecryption as jest.Mock).mockReset()
  })

  it('applies counters and cursor together in a single transaction when a cursor row exists', async () => {
    const em = buildFakeEm()
    const run = buildRun()
    const cursorRow = { cursor: 'old-cursor' }
    mockLookups(run, cursorRow)

    const service = createSyncRunService(em as any)
    const result = await service.commitBatchProgress(
      'run-1',
      { createdCount: 3, updatedCount: 0, skippedCount: 0, failedCount: 0, batchesCompleted: 1 },
      'new-cursor',
      SCOPE,
    )

    expect(em.begin).toHaveBeenCalledTimes(1)
    expect(em.commit).toHaveBeenCalledTimes(1)
    expect(em.flush).toHaveBeenCalledTimes(1)
    expect(em.rollback).not.toHaveBeenCalled()
    expect(em.create).not.toHaveBeenCalled()

    expect(run.createdCount).toBe(8)
    expect(run.batchesCompleted).toBe(3)
    expect(run.cursor).toBe('new-cursor')
    expect(cursorRow.cursor).toBe('new-cursor')
    expect(result).toBe(run)
  })

  it('creates a cursor row when none exists, still within one transaction', async () => {
    const em = buildFakeEm()
    const run = buildRun()
    mockLookups(run, null)

    const service = createSyncRunService(em as any)
    await service.commitBatchProgress('run-1', { updatedCount: 2, batchesCompleted: 1 }, 'c2', SCOPE)

    expect(em.create).toHaveBeenCalledWith(
      SyncCursor,
      expect.objectContaining({
        integrationId: 'sync_excel',
        entityType: 'products',
        direction: 'import',
        cursor: 'c2',
        organizationId: 'org-1',
        tenantId: 'tenant-1',
      }),
    )
    expect(run.updatedCount).toBe(3)
    expect(run.cursor).toBe('c2')
    expect(em.commit).toHaveBeenCalledTimes(1)
  })

  it('rolls back without committing when the flush fails (no partial counter/cursor commit)', async () => {
    const em = buildFakeEm()
    em.flush.mockRejectedValueOnce(new Error('flush-failure'))
    const run = buildRun()
    mockLookups(run, { cursor: 'old-cursor' })

    const service = createSyncRunService(em as any)
    await expect(
      service.commitBatchProgress('run-1', { createdCount: 1, batchesCompleted: 1 }, 'c3', SCOPE),
    ).rejects.toThrow('flush-failure')

    expect(em.begin).toHaveBeenCalledTimes(1)
    expect(em.rollback).toHaveBeenCalledTimes(1)
    expect(em.commit).not.toHaveBeenCalled()
  })

  it('returns null and does not open a transaction when the run is missing', async () => {
    const em = buildFakeEm()
    mockLookups(null, null)

    const service = createSyncRunService(em as any)
    const result = await service.commitBatchProgress('missing', { createdCount: 1 }, 'c', SCOPE)

    expect(result).toBeNull()
    expect(em.begin).not.toHaveBeenCalled()
  })
})

describe('SyncRunService.commitBatchProgress — cursor fencing against a concurrent delivery', () => {
  beforeEach(() => {
    ;(findOneWithDecryption as jest.Mock).mockReset()
  })

  it('advances the cursor only from the value the caller streamed from', async () => {
    const em = buildFakeEm()
    const run = buildRun()
    mockLookups(run, { cursor: 'old-cursor' })

    const service = createSyncRunService(em as any)
    await service.commitBatchProgress('run-1', { createdCount: 1, batchesCompleted: 1 }, 'new-cursor', SCOPE, 'old-cursor')

    expect(em.nativeUpdate).toHaveBeenCalledWith(
      SyncRun,
      expect.objectContaining({
        id: 'run-1',
        organizationId: 'org-1',
        tenantId: 'tenant-1',
        deletedAt: null,
        cursor: 'old-cursor',
      }),
      expect.objectContaining({ cursor: 'new-cursor' }),
    )
    expect(em.commit).toHaveBeenCalledTimes(1)
  })

  it('fences a null starting cursor so only the first delivery can leave the initial position', async () => {
    const em = buildFakeEm()
    const run = buildRun({ cursor: null })
    mockLookups(run, null)

    const service = createSyncRunService(em as any)
    await service.commitBatchProgress('run-1', { batchesCompleted: 1 }, 'first-cursor', SCOPE, null)

    expect(em.nativeUpdate).toHaveBeenCalledWith(
      SyncRun,
      expect.objectContaining({ cursor: null }),
      expect.objectContaining({ cursor: 'first-cursor' }),
    )
  })

  it('rejects the commit and rolls back when another worker already moved the cursor', async () => {
    const em = buildFakeEm()
    em.nativeUpdate.mockResolvedValueOnce(0)
    const run = buildRun()
    mockLookups(run, { cursor: 'moved-by-other-worker' })

    const service = createSyncRunService(em as any)
    await expect(
      service.commitBatchProgress('run-1', { createdCount: 1, batchesCompleted: 1 }, 'new-cursor', SCOPE, 'old-cursor'),
    ).rejects.toBeInstanceOf(SyncRunCursorConflictError)

    expect(em.rollback).toHaveBeenCalledTimes(1)
    expect(em.commit).not.toHaveBeenCalled()
    expect(run.createdCount).toBe(5)
    expect(run.batchesCompleted).toBe(2)
    expect(run.cursor).toBe('old-cursor')
  })

  it('leaves the cursor unguarded when no expectation is supplied, preserving the legacy write', async () => {
    const em = buildFakeEm()
    const run = buildRun()
    mockLookups(run, { cursor: 'old-cursor' })

    const service = createSyncRunService(em as any)
    await service.commitBatchProgress('run-1', { createdCount: 1, batchesCompleted: 1 }, 'new-cursor', SCOPE)

    expect(em.nativeUpdate).not.toHaveBeenCalled()
    expect(run.cursor).toBe('new-cursor')
  })
})

describe('SyncRunService.updateCursor — UoW-safe cursor write (issue #2341)', () => {
  beforeEach(() => {
    ;(findOneWithDecryption as jest.Mock).mockReset()
  })

  it('mutates the run cursor inside a transaction after the cursor-row lookup', async () => {
    const em = buildFakeEm()
    const run = buildRun()
    const cursorRow = { cursor: 'old-cursor' }
    mockLookups(run, cursorRow)

    const service = createSyncRunService(em as any)
    await service.updateCursor('run-1', 'advanced-cursor', SCOPE)

    expect(em.begin).toHaveBeenCalledTimes(1)
    expect(em.commit).toHaveBeenCalledTimes(1)
    expect(em.flush).toHaveBeenCalledTimes(1)
    expect(run.cursor).toBe('advanced-cursor')
    expect(cursorRow.cursor).toBe('advanced-cursor')
  })
})

describe('SyncRunService.markStatus — stalled-job recovery', () => {
  beforeEach(() => {
    ;(findOneWithDecryption as jest.Mock).mockReset()
  })

  it('idempotently reclaims a running run without admitting terminal statuses', async () => {
    const em = buildFakeEm()
    const run = buildRun({ status: 'running' })
    mockLookups(run, null)

    const service = createSyncRunService(em as any)
    const result = await service.markStatus('run-1', 'running', SCOPE)

    expect(em.nativeUpdate).toHaveBeenCalledWith(
      SyncRun,
      expect.objectContaining({
        id: 'run-1',
        organizationId: 'org-1',
        tenantId: 'tenant-1',
        status: { $in: ['pending', 'running'] },
      }),
      expect.objectContaining({ status: 'running' }),
    )
    expect(em.refresh).toHaveBeenCalledWith(run)
    expect(result).toBe(run)
  })
})
