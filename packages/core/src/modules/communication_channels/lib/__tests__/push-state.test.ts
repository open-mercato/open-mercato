import { PUSH_STATE_KEYS, preservePushState } from '../push-state'

describe('preservePushState', () => {
  it('replaces the sync cursor while carrying hub-owned push keys forward', () => {
    const previous = {
      pushStatus: 'active',
      pubsubTopic: 'projects/p/topics/gmail-push',
      watchExpirationMs: 123,
      historyId: '100',
    }
    const next = { historyId: '200' }

    const merged = preservePushState(previous, next)

    expect(merged.historyId).toBe('200')
    expect(merged.pushStatus).toBe('active')
    expect(merged.pubsubTopic).toBe('projects/p/topics/gmail-push')
    expect(merged.watchExpirationMs).toBe(123)
  })

  it('clears a stale mid-drain resumption token once the new cursor omits it (regression)', () => {
    // A spread `{ ...previous, ...next }` would retain these and mis-route the next
    // push notification; a full replace must drop them when the adapter finished draining.
    const previous = {
      pushStatus: 'active',
      pendingHistoryPageToken: 'page-2',
      pendingMessagesPageToken: 'msg-page-2',
      historyId: '100',
    }
    const next = { historyId: '200' }

    const merged = preservePushState(previous, next)

    expect('pendingHistoryPageToken' in merged).toBe(false)
    expect('pendingMessagesPageToken' in merged).toBe(false)
    expect(merged.pushStatus).toBe('active')
  })

  it('lets the new cursor override a push key it explicitly sets', () => {
    const merged = preservePushState({ pushStatus: 'active' }, { pushStatus: 'failed', historyId: '1' })
    expect(merged.pushStatus).toBe('failed')
  })

  it('tolerates a non-object previous state', () => {
    expect(preservePushState(null, { historyId: '1' })).toEqual({ historyId: '1' })
    expect(preservePushState('garbage', { historyId: '1' })).toEqual({ historyId: '1' })
  })

  it('declares the push-owned keys that must survive a cursor replacement', () => {
    expect(PUSH_STATE_KEYS).toContain('pushStatus')
    expect(PUSH_STATE_KEYS).toContain('pubsubTopic')
    expect(PUSH_STATE_KEYS).toContain('watchExpirationMs')
  })
})
