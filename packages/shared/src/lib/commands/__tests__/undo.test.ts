import { extractUndoPayload } from '../undo'

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

  it('supports legacy payload field when commandPayload is absent', () => {
    const logEntry = { payload: { undo: { id: 3 } } }
    expect(extractUndoPayload(logEntry as any)).toEqual({ id: 3 })
  })
})
