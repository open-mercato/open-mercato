/** @jest-environment jsdom */
import { clearAllPerspectiveState, readPerspectiveSnapshot, writePerspectiveSnapshot } from '../DataTable'

const PREFIX = 'om_table_perspective_snapshot'
const COOKIE_PREFIX = 'om_table_perspective'

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

describe('clearAllPerspectiveState (tenant-isolation at the auth identity boundary, #4185)', () => {
  beforeEach(() => {
    localStorage.clear()
    for (const cookie of document.cookie ? document.cookie.split(';') : []) {
      const name = cookie.split('=')[0]?.trim()
      if (name) document.cookie = `${name}=; Path=/; Max-Age=0`
    }
  })

  it('removes every perspective snapshot across all tables', () => {
    writePerspectiveSnapshot('customers-companies', {
      perspectiveId: null,
      settings: { columnSizing: { name: 210, status: 60 } },
      updatedAt: 1,
    })
    writePerspectiveSnapshot('customers-people', {
      perspectiveId: null,
      settings: { columnSizing: { name: 300 } },
      updatedAt: 2,
    })

    clearAllPerspectiveState()

    expect(localStorage.getItem(`${PREFIX}:customers-companies`)).toBeNull()
    expect(localStorage.getItem(`${PREFIX}:customers-people`)).toBeNull()
    expect(readPerspectiveSnapshot('customers-companies')).toBeNull()
    expect(readPerspectiveSnapshot('customers-people')).toBeNull()
  })

  it('leaves unrelated localStorage keys untouched', () => {
    writePerspectiveSnapshot('customers-companies', {
      perspectiveId: null,
      settings: { columnSizing: { name: 210 } },
      updatedAt: 1,
    })
    localStorage.setItem('om_login_tenant', 'acme')
    localStorage.setItem('om:auth:identity', '123')

    clearAllPerspectiveState()

    expect(localStorage.getItem(`${PREFIX}:customers-companies`)).toBeNull()
    expect(localStorage.getItem('om_login_tenant')).toBe('acme')
    expect(localStorage.getItem('om:auth:identity')).toBe('123')
  })

  it('expires the active-view perspective cookies', () => {
    document.cookie = `${COOKIE_PREFIX}:customers-companies=view-1; Path=/`
    expect(document.cookie).toContain(`${COOKIE_PREFIX}:customers-companies=view-1`)

    clearAllPerspectiveState()

    expect(document.cookie).not.toContain(`${COOKIE_PREFIX}:customers-companies`)
  })

  it('is a no-op when nothing is stored', () => {
    expect(() => clearAllPerspectiveState()).not.toThrow()
    expect(localStorage.length).toBe(0)
  })
})
