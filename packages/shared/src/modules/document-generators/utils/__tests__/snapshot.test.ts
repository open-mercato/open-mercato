import { toSnapshotRecord } from '../snapshot'

describe('toSnapshotRecord', () => {
  it('accepts objects and JSON strings only', () => {
    expect(toSnapshotRecord({ a: 1 })).toEqual({ a: 1 })
    expect(toSnapshotRecord(JSON.stringify({ a: 1 }))).toEqual({ a: 1 })
    expect(toSnapshotRecord([1])).toBeNull()
    expect(toSnapshotRecord('plain text')).toBeNull()
    expect(toSnapshotRecord(5)).toBeNull()
    expect(toSnapshotRecord(null)).toBeNull()
  })
})
