/** @jest-environment jsdom */
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { OPTIMISTIC_LOCK_CONFLICT_CODE } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import {
  dismissRecordConflict,
  getRecordConflictForTest,
  registerRecordLockConflictHandler,
  resetRecordLockConflictHandlerForTest,
  surfaceRecordConflict,
} from '..'

const t = (key: string, fallback?: string) => fallback ?? key

function recordLockConflict() {
  return new CrudHttpError(409, {
    error: 'Record conflict detected',
    code: 'record_lock_conflict',
    lock: null,
    conflict: { id: 'c1' },
  })
}

function ossConflict() {
  return new CrudHttpError(409, {
    error: 'record_modified',
    code: OPTIMISTIC_LOCK_CONFLICT_CODE,
    currentUpdatedAt: '2026-06-01T00:00:01.000Z',
    expectedUpdatedAt: '2026-06-01T00:00:00.000Z',
  })
}

describe('surfaceRecordConflict — single surface (S3)', () => {
  beforeEach(() => {
    dismissRecordConflict()
    resetRecordLockConflictHandlerForTest()
  })
  afterEach(() => {
    dismissRecordConflict()
    resetRecordLockConflictHandlerForTest()
  })

  it('defers a record_lock_conflict to the registered merge-dialog handler that owns the record (returns true → no OSS bar)', () => {
    const handler = jest.fn(() => true)
    registerRecordLockConflictHandler(handler)

    const handled = surfaceRecordConflict(recordLockConflict(), t)

    expect(handled).toBe(true)
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler.mock.calls[0][0]).toMatchObject({ code: 'record_lock_conflict' })
    // The OSS conflict bar must NOT render when the dialog handles it.
    expect(getRecordConflictForTest()).toBeNull()
  })

  it('SAFETY: handler registered but DECLINES the record (returns false) → OSS bar still renders (never swallowed)', () => {
    const handler = jest.fn(() => false)
    registerRecordLockConflictHandler(handler)

    const handled = surfaceRecordConflict(recordLockConflict(), t)

    expect(handled).toBe(true)
    expect(handler).toHaveBeenCalledTimes(1)
    expect(getRecordConflictForTest()).not.toBeNull()
  })

  it('SAFETY: with NO handler registered, a record_lock_conflict still renders the OSS bar (never swallowed)', () => {
    const handled = surfaceRecordConflict(recordLockConflict(), t)
    expect(handled).toBe(true)
    expect(getRecordConflictForTest()).not.toBeNull()
  })

  it('renders the OSS conflict bar for an optimistic_lock_conflict regardless of handler registration', () => {
    const handler = jest.fn(() => true)
    registerRecordLockConflictHandler(handler)
    const handled = surfaceRecordConflict(ossConflict(), t)
    expect(handled).toBe(true)
    // The record-lock handler must NOT be consulted for an OSS optimistic-lock conflict.
    expect(handler).not.toHaveBeenCalled()
    const entry = getRecordConflictForTest()
    expect(entry).not.toBeNull()
    expect(entry?.currentUpdatedAt).toBe('2026-06-01T00:00:01.000Z')
  })

  it('unregister restores the no-handler behavior', () => {
    const handler = jest.fn(() => true)
    const unregister = registerRecordLockConflictHandler(handler)
    unregister()

    surfaceRecordConflict(recordLockConflict(), t)
    expect(handler).not.toHaveBeenCalled()
    expect(getRecordConflictForTest()).not.toBeNull()
  })

  it('returns false for a non-conflict error', () => {
    expect(surfaceRecordConflict(new CrudHttpError(422, { error: 'validation_failed' }), t)).toBe(false)
    expect(surfaceRecordConflict(new Error('boom'), t)).toBe(false)
    expect(getRecordConflictForTest()).toBeNull()
  })
})
