import { extractUndoPayload, reviveSnapshotDates } from '../undo'

describe('extractUndoPayload', () => {
  it('returns undo payload from direct property', () => {
    const logEntry = { commandPayload: { undo: { foo: 'bar' } } }
    expect(extractUndoPayload(logEntry as any)).toEqual({ foo: 'bar' })
  })

  it('returns undo payload from nested value property', () => {
    const logEntry = { commandPayload: { value: { undo: { id: 1 } } } }
    expect(extractUndoPayload(logEntry as any)).toEqual({ id: 1 })
  })

  it('returns undo payload from nested envelope entries', () => {
    const logEntry = { commandPayload: { something: { undo: { id: 2 } }, __redoInput: {} } }
    expect(extractUndoPayload(logEntry as any)).toEqual({ id: 2 })
  })

  it('falls back to snapshots when undo payload is missing', () => {
    const logEntry = { snapshotBefore: { id: 'before' }, snapshotAfter: { id: 'after' } }
    expect(extractUndoPayload(logEntry as any)).toEqual({ before: { id: 'before' }, after: { id: 'after' } })
  })

  it('includes null after when only snapshotBefore exists', () => {
    const logEntry = { snapshotBefore: { id: 'before' } }
    expect(extractUndoPayload(logEntry as any)).toEqual({ before: { id: 'before' }, after: null })
  })

  it('includes null before when only snapshotAfter exists', () => {
    const logEntry = { snapshotAfter: { id: 'after' } }
    expect(extractUndoPayload(logEntry as any)).toEqual({ before: null, after: { id: 'after' } })
  })

  it('supports legacy payload field when commandPayload is absent', () => {
    const logEntry = { payload: { undo: { id: 3 } } }
    expect(extractUndoPayload(logEntry as any)).toEqual({ id: 3 })
  })

  it('falls back to snapshots when commandPayload is null', () => {
    const logEntry = { commandPayload: null, snapshotBefore: { id: 'before' } }
    expect(extractUndoPayload(logEntry as any)).toEqual({ before: { id: 'before' }, after: null })
  })

  it('falls back to snapshots when commandPayload is an array', () => {
    const logEntry = { commandPayload: [], snapshotAfter: { id: 'after' } }
    expect(extractUndoPayload(logEntry as any)).toEqual({ before: null, after: { id: 'after' } })
  })

  it('returns null when undo value is explicitly null', () => {
    const logEntry = { commandPayload: { undo: null } }
    expect(extractUndoPayload(logEntry as any)).toBeNull()
  })

  it('falls back to snapshots when undo value is undefined', () => {
    const logEntry = { commandPayload: { undo: undefined }, snapshotBefore: { id: 'before' } }
    expect(extractUndoPayload(logEntry as any)).toEqual({ before: { id: 'before' }, after: null })
  })
})

describe('extractUndoPayload date revival (#6336)', () => {
  const iso = '2026-01-02T03:04:05.000Z'
  const jsonRoundTrip = <T>(value: T): T => JSON.parse(JSON.stringify(value))

  it('returns ISO strings untouched when no options are given', () => {
    const logEntry = jsonRoundTrip({ commandPayload: { undo: { before: { item: { occurredAt: new Date(iso) } } } } })
    const payload = extractUndoPayload<{ before: { item: { occurredAt: unknown } } }>(logEntry)
    expect(payload?.before.item.occurredAt).toBe(iso)
  })

  it('revives dateFields at any depth, including inside arrays', () => {
    const logEntry = jsonRoundTrip({
      commandPayload: {
        undo: {
          before: { item: { occurredAt: new Date(iso), scheduledAt: null, title: iso }, lines: [{ occurredAt: new Date(iso) }] },
          after: { item: { occurredAt: new Date(iso) } },
        },
      },
    })
    const payload = extractUndoPayload<{
      before: { item: { occurredAt: Date; scheduledAt: Date | null; title: string }; lines: Array<{ occurredAt: Date }> }
      after: { item: { occurredAt: Date } }
    }>(logEntry, { dateFields: ['occurredAt', 'scheduledAt'] })
    expect(payload?.before.item.occurredAt).toBeInstanceOf(Date)
    expect(payload?.before.item.occurredAt.toISOString()).toBe(iso)
    expect(payload?.before.item.scheduledAt).toBeNull()
    expect(payload?.before.item.title).toBe(iso)
    expect(payload?.before.lines[0].occurredAt).toBeInstanceOf(Date)
    expect(payload?.after.item.occurredAt).toBeInstanceOf(Date)
  })

  it('revives only the named datePaths', () => {
    const logEntry = jsonRoundTrip({
      commandPayload: { undo: { before: { item: { occurredAt: iso }, lines: [{ occurredAt: iso }] }, after: { item: { occurredAt: iso } } } },
    })
    const payload = extractUndoPayload<{
      before: { item: { occurredAt: unknown }; lines: Array<{ occurredAt: unknown }> }
      after: { item: { occurredAt: unknown } }
    }>(logEntry, { datePaths: ['before.item.occurredAt', 'before.lines.occurredAt', 'before.missing.occurredAt'] })
    expect(payload?.before.item.occurredAt).toBeInstanceOf(Date)
    expect(payload?.before.lines[0].occurredAt).toBeInstanceOf(Date)
    expect(payload?.after.item.occurredAt).toBe(iso)
    expect(payload?.before).not.toHaveProperty('missing')
  })

  it('revives dates in the snapshot fallback too', () => {
    const logEntry = { snapshotBefore: { occurredAt: iso }, snapshotAfter: null }
    const payload = extractUndoPayload<{ before: { occurredAt: Date } }>(logEntry, { dateFields: ['occurredAt'] })
    expect(payload?.before.occurredAt).toBeInstanceOf(Date)
  })

  it('does not mutate the log entry payload', () => {
    const logEntry = { commandPayload: { undo: { before: { occurredAt: iso } } } }
    extractUndoPayload(logEntry, { dateFields: ['occurredAt'] })
    expect(logEntry.commandPayload.undo.before.occurredAt).toBe(iso)
  })

  it('keeps a __proto__ key as plain data while walking', () => {
    const logEntry = { commandPayload: JSON.parse('{"undo":{"before":{"__proto__":{"polluted":true},"occurredAt":"2026-01-02T03:04:05.000Z"}}}') }
    const payload = extractUndoPayload<{ before: Record<string, unknown> }>(logEntry, { dateFields: ['occurredAt'] })
    expect(Object.getPrototypeOf(payload?.before)).toBe(Object.prototype)
    expect(Object.keys(payload?.before ?? {})).toContain('__proto__')
  })

  it('throws on an unparsable snapshot date', () => {
    const logEntry = { commandPayload: { undo: { before: { occurredAt: 'not-a-date' } } } }
    expect(() => extractUndoPayload(logEntry, { dateFields: ['occurredAt'] })).toThrow('Invalid occurredAt snapshot date')
  })
})

describe('reviveSnapshotDates', () => {
  it('shallow-clones the record and revives only the named fields', () => {
    const existing = new Date('2026-05-06T00:00:00.000Z')
    const snapshot = { id: 'row-1', effectiveAt: '2026-02-03T00:00:00.000Z', deletedAt: null, updatedAt: existing, label: '2026-02-03' }
    const revived = reviveSnapshotDates(snapshot, ['effectiveAt', 'deletedAt', 'updatedAt', 'absentAt'])
    expect(revived).not.toBe(snapshot)
    expect(revived.effectiveAt).toBeInstanceOf(Date)
    expect(revived.deletedAt).toBeNull()
    expect(revived.updatedAt).toBe(existing)
    expect(revived.label).toBe('2026-02-03')
    expect(revived).not.toHaveProperty('absentAt')
    expect(snapshot.effectiveAt).toBe('2026-02-03T00:00:00.000Z')
  })

  it('throws on an unparsable value', () => {
    expect(() => reviveSnapshotDates({ effectiveAt: 'garbage' }, ['effectiveAt'])).toThrow('Invalid effectiveAt snapshot date')
  })
})
