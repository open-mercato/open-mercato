import { resolveLockAfterValidate } from '../widgets/injection/record-locking/widget.client'
import type { RecordLockUiView } from '../lib/clientLockStore'

const baseLock: RecordLockUiView = {
  id: 'lock-1',
  resourceKind: 'catalog.product',
  resourceId: 'r-1',
  token: 'tok-1',
  strategy: 'optimistic',
  status: 'active',
  lockedByUserId: 'u-1',
  baseActionLogId: null,
  lockedAt: '2026-07-19T10:00:00.000Z',
  lastHeartbeatAt: '2026-07-19T10:00:05.000Z',
  expiresAt: '2026-07-19T10:05:00.000Z',
  activeParticipantCount: 1,
}

describe('resolveLockAfterValidate (#5289 — /validate token-strip must not flash a false lock)', () => {
  it('preserves the caller own token when /validate returns the same lock tokenless', () => {
    const current = { ...baseLock, token: 'tok-1' }
    const validated = { ...baseLock, token: null, activeParticipantCount: 1 }
    const result = resolveLockAfterValidate(current, validated)
    expect(result?.id).toBe('lock-1')
    expect(result?.token).toBe('tok-1')
  })

  it('keeps a genuinely foreign lock tokenless so real contention banners still render', () => {
    const current = { ...baseLock, id: 'lock-1', token: 'tok-1' }
    const foreign = { ...baseLock, id: 'lock-2', token: null, lockedByUserId: 'u-2' }
    const result = resolveLockAfterValidate(current, foreign)
    expect(result?.id).toBe('lock-2')
    expect(result?.token).toBeNull()
  })

  it('does not resurrect a token for a same-id lock that already carries one', () => {
    const current = { ...baseLock, token: 'tok-old' }
    const validated = { ...baseLock, token: 'tok-new' }
    expect(resolveLockAfterValidate(current, validated).token).toBe('tok-new')
  })

  it('does not restore a token for a same-id lock the server no longer reports as active', () => {
    const current = { ...baseLock, token: 'tok-1' }
    const released = { ...baseLock, token: null, status: 'released' as const }
    const result = resolveLockAfterValidate(current, released)
    expect(result?.id).toBe('lock-1')
    expect(result?.token).toBeNull()
  })

  it('returns the current lock when the response carries no lock', () => {
    const current = { ...baseLock, token: 'tok-1' }
    expect(resolveLockAfterValidate(current, null)).toBe(current)
    expect(resolveLockAfterValidate(current, undefined)).toBe(current)
  })

  it('returns null when neither side has a lock', () => {
    expect(resolveLockAfterValidate(null, null)).toBeNull()
    expect(resolveLockAfterValidate(undefined, undefined)).toBeNull()
  })
})
