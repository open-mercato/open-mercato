import { detectStatusChange, normalizeActionLogToHistoryEntry } from '../../lib/historyHelpers'
import { parseDocumentHistoryTypes } from '../document-history/route'

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
  it('treats creation with initial status as status transition (for Status history)', () => {
    const log = makeLog({ snapshotBefore: null, snapshotAfter: { order: { status: 'draft' } } })
    expect(detectStatusChange(log)).toEqual({ statusFrom: null, statusTo: 'draft' })
  })

  it('returns created entry with null status when snapshotAfter has no status', () => {
    const log = makeLog({ snapshotBefore: null, snapshotAfter: { order: { note: 'x' } } })
    expect(detectStatusChange(log)).toEqual({ statusFrom: null, statusTo: null })
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

  it('extracts fulfillment_status when order.status is missing', () => {
    const log = makeLog({
      snapshotBefore: { order: { fulfillment_status: null } },
      snapshotAfter: { order: { fulfillment_status: 'fulfilled' } },
    })
    expect(detectStatusChange(log)).toEqual({ statusFrom: null, statusTo: 'fulfilled' })
  })

  it('extracts payment_status when order.status and fulfillment_status are missing', () => {
    const log = makeLog({
      snapshotBefore: { order: { payment_status: null } },
      snapshotAfter: { order: { payment_status: 'received' } },
    })
    expect(detectStatusChange(log)).toEqual({ statusFrom: null, statusTo: 'received' })
  })

  it('returns status change with both null when snapshot has no status (e.g. Create return)', () => {
    const log = makeLog({
      snapshotBefore: null,
      snapshotAfter: { id: 'ret-1', orderId: 'ord-1', lines: [], adjustmentIds: [] },
    })
    expect(detectStatusChange(log)).toEqual({ statusFrom: null, statusTo: null })
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

  it('classifies create as status entry (null snapshotBefore) so it appears in Status changes filter', () => {
    const log = makeLog({
      snapshotBefore: null,
      snapshotAfter: { order: { status: 'draft' } },
      actionLabel: 'Create sales order',
    })
    const entry = normalizeActionLogToHistoryEntry(log, 'order')
    expect(entry.kind).toBe('status')
    expect(entry.metadata?.statusFrom).toBeNull()
    expect(entry.metadata?.statusTo).toBe('draft')
    expect(entry.action).toBe('draft')
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

  it('uses commandId as action fallback when actionLabel is null and no status change', () => {
    const log = makeLog({
      actionLabel: null,
      commandId: 'my-command-id',
      snapshotBefore: { order: { status: 'draft' } },
      snapshotAfter: { order: { status: 'draft', note: 'updated' } },
    })
    const entry = normalizeActionLogToHistoryEntry(log, 'order')
    expect(entry.kind).toBe('action')
    expect(entry.action).toBe('my-command-id')
  })

  it('includes documentKind in metadata', () => {
    const log = makeLog()
    expect(normalizeActionLogToHistoryEntry(log, 'order').metadata?.documentKind).toBe('order')
    expect(normalizeActionLogToHistoryEntry(log, 'quote').metadata?.documentKind).toBe('quote')
  })

  it('treats Create return (no status in snapshot) as action with actionLabel', () => {
    const log = makeLog({
      snapshotBefore: null,
      snapshotAfter: { id: 'ret-1', orderId: 'ord-1', lines: [], adjustmentIds: [] },
      actionLabel: 'Create return',
      commandId: 'sales.returns.create',
    })
    const entry = normalizeActionLogToHistoryEntry(log, 'order')
    expect(entry.kind).toBe('action')
    expect(entry.action).toBe('Create return')
  })
})

describe('parseDocumentHistoryTypes', () => {
  it('returns empty set for empty input', () => {
    expect(Array.from(parseDocumentHistoryTypes(undefined))).toEqual([])
    expect(Array.from(parseDocumentHistoryTypes(''))).toEqual([])
    expect(Array.from(parseDocumentHistoryTypes(' , '))).toEqual([])
  })

  it('parses and sanitizes known types', () => {
    expect(Array.from(parseDocumentHistoryTypes('status'))).toEqual(['status'])
    expect(Array.from(parseDocumentHistoryTypes('status,action'))).toEqual(['status', 'action'])
    expect(Array.from(parseDocumentHistoryTypes(' Status ,  COMMENT '))).toEqual(['status', 'comment'])
  })

  it('ignores unknown types', () => {
    expect(Array.from(parseDocumentHistoryTypes('status,invalid,comment'))).toEqual(['status', 'comment'])
    expect(Array.from(parseDocumentHistoryTypes('invalid'))).toEqual([])
  })
})
