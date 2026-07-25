/**
 * @jest-environment node
 */
import { fractionToSize, sizeToFraction } from '../sizeSnap'

describe('dashboard v2 size snapping', () => {
  test('sizeToFraction maps each size to its column fraction', () => {
    expect(sizeToFraction('sm')).toBe(0.25)
    expect(sizeToFraction('md')).toBe(0.5)
    expect(sizeToFraction('lg')).toBe(0.75)
    expect(sizeToFraction('full')).toBe(1)
    expect(sizeToFraction(undefined)).toBe(0.5)
  })

  test('fractionToSize snaps to the nearest available size', () => {
    expect(fractionToSize(0.1)).toBe('sm')
    expect(fractionToSize(0.3)).toBe('sm')
    expect(fractionToSize(0.4)).toBe('md')
    expect(fractionToSize(0.55)).toBe('md')
    expect(fractionToSize(0.7)).toBe('lg')
    expect(fractionToSize(0.9)).toBe('full')
    expect(fractionToSize(1)).toBe('full')
  })

  test('round-trips every size through its fraction', () => {
    for (const size of ['sm', 'md', 'lg', 'full'] as const) {
      expect(fractionToSize(sizeToFraction(size))).toBe(size)
    }
  })
})
