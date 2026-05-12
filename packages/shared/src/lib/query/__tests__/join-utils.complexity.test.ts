/** @jest-environment node */
import { normalizeFilters } from '../join-utils'
import { AdvancedFilterComplexityError, MAX_DNF_DISJUNCTS } from '../join-utils'

describe('compileToDnf complexity cap', () => {
  test('accepts a filter that fits within the disjunct cap', () => {
    const filter = {
      $or: Array.from({ length: 10 }, (_v, i) => ({ name: { $ilike: `%v${i}%` } })),
    }
    expect(() => normalizeFilters(filter)).not.toThrow()
  })

  test('throws AdvancedFilterComplexityError when DNF expansion would exceed the cap', () => {
    // 4 ANDed disjunctions of 8 alternatives each = 8^4 = 4096 disjuncts.
    const eightOptions = (field: string) => ({
      $or: Array.from({ length: 8 }, (_v, i) => ({ [field]: { $ilike: `%${i}%` } })),
    })
    const filter = {
      $and: [
        eightOptions('a'),
        eightOptions('b'),
        eightOptions('c'),
        eightOptions('d'),
      ],
    }
    expect(() => normalizeFilters(filter)).toThrow(AdvancedFilterComplexityError)
    try {
      normalizeFilters(filter)
    } catch (err) {
      expect(err).toBeInstanceOf(AdvancedFilterComplexityError)
      const e = err as AdvancedFilterComplexityError
      expect(e.code).toBe('ADVANCED_FILTER_TOO_COMPLEX')
      expect(e.disjunctCount).toBeGreaterThan(MAX_DNF_DISJUNCTS)
    }
  })

  test('throws when a single $or has more than the cap of alternatives', () => {
    const filter = {
      $or: Array.from({ length: MAX_DNF_DISJUNCTS + 5 }, (_v, i) => ({ name: { $ilike: `%v${i}%` } })),
    }
    expect(() => normalizeFilters(filter)).toThrow(AdvancedFilterComplexityError)
  })
})
