/** @jest-environment jsdom */
import { sanitizePerspectiveSettings } from '../DataTable'

describe('sanitizePerspectiveSettings — pageSize (#3882)', () => {
  it('keeps a page size within the list cap', () => {
    expect(sanitizePerspectiveSettings({ pageSize: 50 })?.pageSize).toBe(50)
  })

  it('clamps a stored page size above 100 down to the list cap', () => {
    expect(sanitizePerspectiveSettings({ pageSize: 500 })?.pageSize).toBe(100)
    expect(sanitizePerspectiveSettings({ pageSize: 101 })?.pageSize).toBe(100)
  })

  it('raises non-positive page sizes to 1 and floors fractions', () => {
    expect(sanitizePerspectiveSettings({ pageSize: 0 })?.pageSize).toBe(1)
    expect(sanitizePerspectiveSettings({ pageSize: 25.9 })?.pageSize).toBe(25)
  })
})
