/** @jest-environment node */

import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
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
