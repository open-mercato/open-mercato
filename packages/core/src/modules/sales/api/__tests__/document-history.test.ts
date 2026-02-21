import { detectStatusChange, normalizeActionLogToHistoryEntry } from '../../lib/historyHelpers'

function makeLog(overrides: Partial<{
  id: string
  snapshotBefore: unknown
  snapshotAfter: unknown
  actionLabel: string | null
  commandId: string
  actorUserId: string | null
  createdAt: Date
}> = {}): any {
  return {
    id: 'log-1',
    commandId: 'cmd-1',
    actionLabel: 'Update sales order',
    actorUserId: null,
    createdAt: new Date('2024-01-01T10:00:00Z'),
    snapshotBefore: null,
    snapshotAfter: null,
    ...overrides,
  }
}

describe('detectStatusChange', () => {
  it('returns null for creations (null snapshotBefore)', () => {
    const log = makeLog({ snapshotBefore: null, snapshotAfter: { order: { status: 'draft' } } })
    expect(detectStatusChange(log)).toBeNull()
  })

  it('detects direct status change from logStatusChange entries', () => {
    const log = makeLog({
      snapshotBefore: { status: 'draft' },
      snapshotAfter: { status: 'confirmed' },
    })
    expect(detectStatusChange(log)).toEqual({ statusFrom: 'draft', statusTo: 'confirmed' })
  })

  it('detects null-to-value transition from dedicated logStatusChange entry', () => {
    const log = makeLog({
      snapshotBefore: { status: null },
      snapshotAfter: { status: 'confirmed' },
    })
    expect(detectStatusChange(log)).toEqual({ statusFrom: null, statusTo: 'confirmed' })
  })

  it('detects status change in nested order snapshot from update commands', () => {
    const log = makeLog({
      snapshotBefore: { order: { id: 'o1', status: 'draft', note: 'x' } },
      snapshotAfter: { order: { id: 'o1', status: 'confirmed', note: 'x' } },
    })
    expect(detectStatusChange(log)).toEqual({ statusFrom: 'draft', statusTo: 'confirmed' })
  })

  it('detects status change in nested quote snapshot from update commands', () => {
    const log = makeLog({
      snapshotBefore: { quote: { id: 'q1', status: 'pending' } },
      snapshotAfter: { quote: { id: 'q1', status: 'accepted' } },
    })
    expect(detectStatusChange(log)).toEqual({ statusFrom: 'pending', statusTo: 'accepted' })
  })

  it('returns null when status did not change in update', () => {
    const log = makeLog({
      snapshotBefore: { order: { status: 'confirmed', note: 'old' } },
      snapshotAfter: { order: { status: 'confirmed', note: 'new' } },
    })
    expect(detectStatusChange(log)).toBeNull()
  })

  it('returns null when neither snapshot has a status field', () => {
    const log = makeLog({
      snapshotBefore: { order: { note: 'old' } },
      snapshotAfter: { order: { note: 'new' } },
    })
    expect(detectStatusChange(log)).toBeNull()
  })
})

describe('normalizeActionLogToHistoryEntry', () => {
  it('classifies as status when order snapshot contains a status change', () => {
    const log = makeLog({
      snapshotBefore: { order: { status: 'draft' } },
      snapshotAfter: { order: { status: 'confirmed' } },
      actionLabel: 'Update sales order',
    })
    const entry = normalizeActionLogToHistoryEntry(log, 'order')
    expect(entry.kind).toBe('status')
    expect(entry.metadata?.statusFrom).toBe('draft')
    expect(entry.metadata?.statusTo).toBe('confirmed')
    expect(entry.action).toBe('confirmed')
  })

  it('classifies as action when status did not change', () => {
    const log = makeLog({
      snapshotBefore: { order: { status: 'draft', note: 'old' } },
      snapshotAfter: { order: { status: 'draft', note: 'new' } },
      actionLabel: 'Update sales order',
    })
    const entry = normalizeActionLogToHistoryEntry(log, 'order')
    expect(entry.kind).toBe('action')
    expect(entry.action).toBe('Update sales order')
  })

  it('classifies create as action (null snapshotBefore)', () => {
    const log = makeLog({
      snapshotBefore: null,
      snapshotAfter: { order: { status: 'draft' } },
      actionLabel: 'Create sales order',
    })
    const entry = normalizeActionLogToHistoryEntry(log, 'order')
    expect(entry.kind).toBe('action')
    expect(entry.action).toBe('Create sales order')
  })

  it('resolves actor name from displayUsers map', () => {
    const log = makeLog({ actorUserId: 'user-uuid-1' })
    const entry = normalizeActionLogToHistoryEntry(log, 'order', { 'user-uuid-1': 'Jane Doe' })
    expect(entry.actor.label).toBe('Jane Doe')
    expect(entry.actor.id).toBe('user-uuid-1')
  })

  it('falls back to userId string when not in displayUsers map', () => {
    const log = makeLog({ actorUserId: 'user-uuid-2' })
    const entry = normalizeActionLogToHistoryEntry(log, 'order', {})
    expect(entry.actor.label).toBe('user-uuid-2')
  })

  it('uses "system" for null actorUserId', () => {
    const log = makeLog({ actorUserId: null })
    const entry = normalizeActionLogToHistoryEntry(log, 'order')
    expect(entry.actor.label).toBe('system')
    expect(entry.actor.id).toBeNull()
  })

  it('uses commandId as action fallback when actionLabel is null', () => {
    const log = makeLog({ actionLabel: null, commandId: 'my-command-id' })
    const entry = normalizeActionLogToHistoryEntry(log, 'order')
    expect(entry.action).toBe('my-command-id')
  })

  it('includes documentKind in metadata', () => {
    const log = makeLog()
    expect(normalizeActionLogToHistoryEntry(log, 'order').metadata?.documentKind).toBe('order')
    expect(normalizeActionLogToHistoryEntry(log, 'quote').metadata?.documentKind).toBe('quote')
  })
})
