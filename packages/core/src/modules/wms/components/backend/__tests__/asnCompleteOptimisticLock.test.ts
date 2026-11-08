import { OPTIMISTIC_LOCK_CONFLICT_CODE } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import {
  applyAsnCompleteLockTokenFromConflict,
  applyAsnReceiveLockTokenFromSuccess,
  resolveAsnReceiveLockToken,
} from '../asnCompleteOptimisticLock'

describe('applyAsnCompleteLockTokenFromConflict', () => {
  it('stores currentUpdatedAt so a retry can send a fresh If-Match', () => {
    const tokenHolder = { current: '2026-08-22T10:00:00.000Z' as string | null }
    const refreshed = applyAsnCompleteLockTokenFromConflict(tokenHolder, {
      status: 409,
      body: {
        error: 'record_modified',
        code: OPTIMISTIC_LOCK_CONFLICT_CODE,
        expectedUpdatedAt: '2026-08-22T10:00:00.000Z',
        currentUpdatedAt: '2026-08-22T10:05:00.000Z',
      },
    })

    expect(refreshed).toBe('2026-08-22T10:05:00.000Z')
    expect(tokenHolder.current).toBe('2026-08-22T10:05:00.000Z')
  })

  it('returns null for non-conflict responses without mutating the token', () => {
    const tokenHolder = { current: '2026-08-22T10:00:00.000Z' as string | null }
    expect(
      applyAsnCompleteLockTokenFromConflict(tokenHolder, {
        status: 422,
        body: { error: 'invalid_asn_state' },
      }),
    ).toBeNull()
    expect(tokenHolder.current).toBe('2026-08-22T10:00:00.000Z')
  })
})

describe('ASN receive lock token (second openReceive before refetch)', () => {
  it('applyAsnReceiveLockTokenFromSuccess stores asnUpdatedAt for the next If-Match', () => {
    const tokenHolder = { current: '2026-08-22T10:00:00.000Z' as string | null }
    const refreshed = applyAsnReceiveLockTokenFromSuccess(
      tokenHolder,
      '2026-08-22T10:05:00.000Z',
    )
    expect(refreshed).toBe('2026-08-22T10:05:00.000Z')
    expect(tokenHolder.current).toBe('2026-08-22T10:05:00.000Z')
  })

  it('applyAsnReceiveLockTokenFromSuccess ignores blank values', () => {
    const tokenHolder = { current: '2026-08-22T10:00:00.000Z' as string | null }
    expect(applyAsnReceiveLockTokenFromSuccess(tokenHolder, '   ')).toBeNull()
    expect(applyAsnReceiveLockTokenFromSuccess(tokenHolder, null)).toBeNull()
    expect(tokenHolder.current).toBe('2026-08-22T10:00:00.000Z')
  })

  it('resolveAsnReceiveLockToken prefers the mutable ref over stale query updated_at', () => {
    const tokenHolder = { current: '2026-08-22T10:05:00.000Z' as string | null }
    expect(resolveAsnReceiveLockToken(tokenHolder, '2026-08-22T10:00:00.000Z')).toBe(
      '2026-08-22T10:05:00.000Z',
    )
  })

  it('resolveAsnReceiveLockToken falls back to query updated_at when ref is empty', () => {
    const tokenHolder = { current: null as string | null }
    expect(resolveAsnReceiveLockToken(tokenHolder, '2026-08-22T10:00:00.000Z')).toBe(
      '2026-08-22T10:00:00.000Z',
    )
  })
})
