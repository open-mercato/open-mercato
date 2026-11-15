import { OPTIMISTIC_LOCK_CONFLICT_CODE } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { applyPutawayLockTokenFromConflict } from '../putawayQueueOptimisticLock'

describe('applyPutawayLockTokenFromConflict', () => {
  it('stores currentUpdatedAt so a retry can send a fresh If-Match', () => {
    const tokens: Record<string, string> = {
      'task-1': '2026-08-22T10:00:00.000Z',
    }
    const refreshed = applyPutawayLockTokenFromConflict(tokens, 'task-1', {
      status: 409,
      body: {
        error: 'record_modified',
        code: OPTIMISTIC_LOCK_CONFLICT_CODE,
        expectedUpdatedAt: '2026-08-22T10:00:00.000Z',
        currentUpdatedAt: '2026-08-22T10:05:00.000Z',
      },
    })

    expect(refreshed).toBe('2026-08-22T10:05:00.000Z')
    expect(tokens['task-1']).toBe('2026-08-22T10:05:00.000Z')
  })

  it('returns null for non-conflict responses without mutating tokens', () => {
    const tokens: Record<string, string> = {
      'task-1': '2026-08-22T10:00:00.000Z',
    }
    expect(
      applyPutawayLockTokenFromConflict(tokens, 'task-1', {
        status: 422,
        body: { error: 'invalid_putaway_state' },
      }),
    ).toBeNull()
    expect(tokens['task-1']).toBe('2026-08-22T10:00:00.000Z')
  })
})
