import { perspectiveSettingsSchema } from '../validators'

// The perspective save route validates `settings` through this schema before
// persisting. `columnSizing` (#1835) must survive that boundary — otherwise
// saved/role perspectives silently drop user column widths.
describe('perspectiveSettingsSchema — columnSizing (#1835)', () => {
  it('round-trips valid column widths', () => {
    const parsed = perspectiveSettingsSchema.parse({ columnSizing: { name: 240, status: 120 } })
    expect(parsed.columnSizing).toEqual({ name: 240, status: 120 })
  })

  it('preserves columnSizing alongside the other settings', () => {
    const parsed = perspectiveSettingsSchema.parse({
      columnOrder: ['a', 'b'],
      columnVisibility: { a: false },
      columnSizing: { a: 300 },
      pageSize: 50,
    })
    expect(parsed).toEqual({
      columnOrder: ['a', 'b'],
      columnVisibility: { a: false },
      columnSizing: { a: 300 },
      pageSize: 50,
    })
  })

  it('rejects widths outside the [60, 900] bound', () => {
    expect(() => perspectiveSettingsSchema.parse({ columnSizing: { a: 10 } })).toThrow()
    expect(() => perspectiveSettingsSchema.parse({ columnSizing: { a: 5000 } })).toThrow()
  })

  it('rejects non-integer widths', () => {
    expect(() => perspectiveSettingsSchema.parse({ columnSizing: { a: 199.7 } })).toThrow()
  })

  it('accepts settings without columnSizing (backward compatible)', () => {
    const parsed = perspectiveSettingsSchema.parse({ columnOrder: ['a'] })
    expect(parsed.columnSizing).toBeUndefined()
  })
})
