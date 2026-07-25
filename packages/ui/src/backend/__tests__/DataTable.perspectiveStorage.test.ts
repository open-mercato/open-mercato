/** @jest-environment jsdom */
import { readPerspectiveSnapshot, writePerspectiveSnapshot } from '../DataTable'

const PREFIX = 'om_table_perspective_snapshot'

describe('DataTable perspective snapshot storage (versioned envelope)', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('writes a versioned envelope and reads it back', () => {
    const snapshot = { perspectiveId: 'p1', settings: { columnOrder: ['a', 'b'] }, updatedAt: 123 }
    writePerspectiveSnapshot('tbl', snapshot)
    const stored = JSON.parse(localStorage.getItem(`${PREFIX}:tbl`)!)
    expect(stored.v).toBe(1)
    expect(stored.data).toEqual(snapshot)
    expect(readPerspectiveSnapshot('tbl')).toEqual(snapshot)
  })

  it('round-trips user column widths (columnSizing) through the snapshot (#1835)', () => {
    const snapshot = {
      perspectiveId: 'p1',
      settings: { columnOrder: ['a', 'b'], columnSizing: { a: 240, b: 120 } },
      updatedAt: 456,
    }
    writePerspectiveSnapshot('tbl-sizing', snapshot)
    expect(readPerspectiveSnapshot('tbl-sizing')).toEqual(snapshot)
  })

  it('migrates a legacy bare (pre-envelope) snapshot on read', () => {
    const legacy = { perspectiveId: 'p2', settings: { columnOrder: ['x'] }, updatedAt: 7 }
    localStorage.setItem(`${PREFIX}:tbl2`, JSON.stringify(legacy))
    expect(readPerspectiveSnapshot('tbl2')).toEqual(legacy)
  })

  it('discards a version-mismatched envelope', () => {
    localStorage.setItem(
      `${PREFIX}:tbl3`,
      JSON.stringify({ v: 99, data: { perspectiveId: null, settings: {}, updatedAt: 1 } }),
    )
    expect(readPerspectiveSnapshot('tbl3')).toBeNull()
  })

  it('returns null for a malformed value (no settings object)', () => {
    localStorage.setItem(`${PREFIX}:tbl4`, JSON.stringify({ foo: 'bar' }))
    expect(readPerspectiveSnapshot('tbl4')).toBeNull()
  })

  it('clears the slot when writing null', () => {
    writePerspectiveSnapshot('tbl5', { perspectiveId: null, settings: { columnOrder: ['z'] }, updatedAt: 1 })
    writePerspectiveSnapshot('tbl5', null)
    expect(localStorage.getItem(`${PREFIX}:tbl5`)).toBeNull()
  })
})
