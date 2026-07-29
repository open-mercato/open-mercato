/** @jest-environment jsdom */
import { sanitizePerspectiveSettings } from '../DataTable'

// Column widths persisted in PerspectiveSettings come from untrusted sources
// (localStorage snapshot, saved perspectives API), so `sanitizePerspectiveSettings`
// must validate and clamp them before they drive layout (#1835).
describe('sanitizePerspectiveSettings — columnSizing (#1835)', () => {
  it('keeps valid integer widths keyed by column id', () => {
    const result = sanitizePerspectiveSettings({ columnSizing: { name: 240, status: 120 } })
    expect(result?.columnSizing).toEqual({ name: 240, status: 120 })
  })

  it('clamps widths into the [60, 900] bound and rounds fractional pixels', () => {
    const result = sanitizePerspectiveSettings({
      columnSizing: { tooSmall: 10, tooBig: 5000, fractional: 199.7 },
    })
    expect(result?.columnSizing).toEqual({ tooSmall: 60, tooBig: 900, fractional: 200 })
  })

  it('drops non-numeric, non-finite, and prototype-polluting entries', () => {
    // JSON.parse creates genuine own `__proto__` / `constructor` keys (unlike an
    // object literal, where `__proto__` sets the prototype), so the forbidden-key
    // guard is actually exercised.
    const columnSizing = JSON.parse('{"good":150,"__proto__":300,"constructor":400}')
    columnSizing.nan = Number.NaN
    columnSizing.inf = Number.POSITIVE_INFINITY
    columnSizing.str = '200'
    const result = sanitizePerspectiveSettings({ columnSizing })
    expect(result?.columnSizing).toEqual({ good: 150 })
  })

  it('omits columnSizing entirely when no valid entry survives', () => {
    const result = sanitizePerspectiveSettings({ columnSizing: { bad: Number.NaN } })
    expect(result?.columnSizing).toBeUndefined()
  })

  it('preserves columnSizing alongside the other settings', () => {
    const result = sanitizePerspectiveSettings({
      columnOrder: ['a', 'b'],
      columnVisibility: { a: false },
      columnSizing: { a: 300 },
    })
    expect(result).toEqual({
      columnOrder: ['a', 'b'],
      columnVisibility: { a: false },
      columnSizing: { a: 300 },
    })
  })
})
