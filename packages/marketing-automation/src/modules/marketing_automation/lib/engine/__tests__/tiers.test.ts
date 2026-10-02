import { DEFAULT_TIER_THRESHOLDS, normalizeTierThresholds, resolveTier } from '../tiers'

describe('resolveTier', () => {
  test.each([
    [0, 'bronze', 0],
    [99, 'bronze', 0],
    [100, 'silver', 1],
    [499, 'silver', 1],
    [500, 'gold', 2],
    [10_000, 'gold', 2],
  ])('%s points is %s', (points, key, rank) => {
    expect(resolveTier(points)).toMatchObject({ key, rank })
  })

  // Below every bound there is no tier, and the rank is -1 rather than 0 so that "at least bronze"
  // is false for them instead of accidentally true.
  test('a score below every bound has no tier', () => {
    const ladder = [{ key: 'silver', minPoints: 100 }, { key: 'gold', minPoints: 500 }]
    expect(resolveTier(50, ladder)).toEqual({ key: null, rank: -1, pointsToNext: 50 })
  })

  test('a negative score has no tier when the ladder starts at zero', () => {
    expect(resolveTier(-10)).toMatchObject({ key: null, rank: -1 })
  })

  test('reports how far the next tier is, and null at the top', () => {
    expect(resolveTier(80).pointsToNext).toBe(20)
    expect(resolveTier(600).pointsToNext).toBeNull()
  })

  test('a custom ladder is honoured', () => {
    const ladder = [{ key: 'basic', minPoints: 0 }, { key: 'pro', minPoints: 10 }]
    expect(resolveTier(15, ladder)).toMatchObject({ key: 'pro', rank: 1 })
  })

  // A ladder in the wrong order would otherwise award the wrong tier silently.
  test('an unsorted ladder is sorted before it is walked', () => {
    const ladder = [{ key: 'gold', minPoints: 500 }, { key: 'bronze', minPoints: 0 }, { key: 'silver', minPoints: 100 }]
    expect(resolveTier(150, ladder)).toMatchObject({ key: 'silver', rank: 1 })
  })
})

describe('normalizeTierThresholds', () => {
  test('falls back to the defaults for anything unusable', () => {
    for (const input of [null, undefined, 'nonsense', 42, {}, [], [{ key: '' }], [{ minPoints: 5 }]]) {
      expect(normalizeTierThresholds(input)).toEqual(DEFAULT_TIER_THRESHOLDS)
    }
  })

  test('drops malformed entries but keeps the usable ones', () => {
    expect(normalizeTierThresholds([
      { key: 'a', minPoints: 0 },
      { key: '', minPoints: 10 },
      { key: 'b', minPoints: 'not a number' },
      { key: 'c', minPoints: 20 },
    ])).toEqual([{ key: 'a', minPoints: 0 }, { key: 'c', minPoints: 20 }])
  })

  test('accepts a numeric string bound, which a settings form will produce', () => {
    expect(normalizeTierThresholds([{ key: 'a', minPoints: '250' }])).toEqual([{ key: 'a', minPoints: 250 }])
  })

  // Two tiers at the same bound cannot both be right, and keeping both would make the answer depend
  // on array order.
  test('de-duplicates by bound', () => {
    expect(normalizeTierThresholds([
      { key: 'first', minPoints: 100 },
      { key: 'second', minPoints: 100 },
    ])).toEqual([{ key: 'first', minPoints: 100 }])
  })
})
