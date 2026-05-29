/** @jest-environment jsdom */
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { OPTIMISTIC_LOCK_CONFLICT_CODE } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import {
  dismissRecordConflict,
  getRecordConflictForTest,
  showRecordConflict,
  surfaceRecordConflict,
} from '..'

const t = (key: string, fallback?: string) => fallback ?? key

describe('record conflict store + surfaceRecordConflict', () => {
  beforeEach(() => dismissRecordConflict())

  it('showRecordConflict sets the active entry; dismiss clears it', () => {
    expect(getRecordConflictForTest()).toBeNull()
    showRecordConflict({ message: 'Changed', currentUpdatedAt: '2026-05-25T08:00:01.000Z' })
    const entry = getRecordConflictForTest()
    expect(entry?.message).toBe('Changed')
    expect(entry?.currentUpdatedAt).toBe('2026-05-25T08:00:01.000Z')
    dismissRecordConflict()
    expect(getRecordConflictForTest()).toBeNull()
  })

  it('surfaceRecordConflict pushes the localized message for an optimistic-lock 409 and returns true', () => {
    const conflict = new CrudHttpError(409, {
      error: 'record_modified',
      code: OPTIMISTIC_LOCK_CONFLICT_CODE,
      currentUpdatedAt: '2026-05-25T08:00:01.000Z',
      expectedUpdatedAt: '2026-05-25T08:00:00.000Z',
    })
    const handled = surfaceRecordConflict(conflict, t)
    expect(handled).toBe(true)
    expect(getRecordConflictForTest()?.message).toBe(
      'This record was modified by someone else. Refresh and try again.',
    )
  })

  it('surfaceRecordConflict is a no-op (returns false) for non-conflict errors', () => {
    expect(surfaceRecordConflict(new CrudHttpError(422, { error: 'validation_failed' }), t)).toBe(false)
    expect(surfaceRecordConflict(new Error('boom'), t)).toBe(false)
    expect(getRecordConflictForTest()).toBeNull()
  })

  it('forwards a custom onRefresh callback', () => {
    const onRefresh = jest.fn()
    const conflict = new CrudHttpError(409, {
      error: 'record_modified',
      code: OPTIMISTIC_LOCK_CONFLICT_CODE,
      currentUpdatedAt: '2026-05-25T08:00:01.000Z',
      expectedUpdatedAt: '2026-05-25T08:00:00.000Z',
    })
    surfaceRecordConflict(conflict, t, { onRefresh, title: 'Order changed' })
    const entry = getRecordConflictForTest()
    expect(entry?.title).toBe('Order changed')
    expect(entry?.onRefresh).toBe(onRefresh)
  })
})
