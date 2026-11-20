import { perspectiveSaveSchema, perspectiveSettingsSchema, PERSPECTIVE_MAX_PAGE_SIZE } from '../validators'

describe('perspectiveSettingsSchema — pageSize cap (#3882)', () => {
  it('caps the persisted page size at the project-wide maximum of 100', () => {
    expect(PERSPECTIVE_MAX_PAGE_SIZE).toBe(100)
  })

  it('keeps page sizes within the cap unchanged', () => {
    expect(perspectiveSettingsSchema.parse({ pageSize: 25 }).pageSize).toBe(25)
    expect(perspectiveSettingsSchema.parse({ pageSize: 100 }).pageSize).toBe(100)
  })

  it('normalizes oversized page sizes from legacy views down to the cap instead of rejecting them', () => {
    expect(perspectiveSettingsSchema.parse({ pageSize: 101 }).pageSize).toBe(100)
    expect(perspectiveSettingsSchema.parse({ pageSize: 500 }).pageSize).toBe(100)
    expect(perspectiveSettingsSchema.parse({ pageSize: 100000 }).pageSize).toBe(100)
  })

  it('normalizes the cap through the save payload schema', () => {
    const parsed = perspectiveSaveSchema.parse({ name: 'Wide', settings: { pageSize: 250 } })
    expect(parsed.settings.pageSize).toBe(100)
  })

  it('leaves pageSize absent when not provided', () => {
    const parsed = perspectiveSettingsSchema.parse({ columnOrder: ['a'] })
    expect(parsed.pageSize).toBeUndefined()
    expect('pageSize' in parsed).toBe(false)
  })

  it('still rejects non-positive, fractional, and non-numeric page sizes', () => {
    expect(() => perspectiveSettingsSchema.parse({ pageSize: 0 })).toThrow()
    expect(() => perspectiveSettingsSchema.parse({ pageSize: -5 })).toThrow()
    expect(() => perspectiveSettingsSchema.parse({ pageSize: 12.5 })).toThrow()
    expect(() => perspectiveSettingsSchema.parse({ pageSize: '50' })).toThrow()
  })
})
