// Pure unit coverage for the normalization/tree-assembly logic extracted from
// `services/promotion-cache.ts` (SPEC-055 §Cache Build Contract, Step 2.5). No database
// connection, no MikroORM entity instances — plain row-shaped objects with the same
// field names as `data/entities.ts`, exactly what the real service passes in after its
// own batch fetch. The service's DB/cache wiring itself is exercised by the
// Playwright `__integration__` suite once a later step gives it an HTTP surface to call
// through (SPEC-055 §Implementation Plan).

import {
  buildNormalizedPromotion,
  type BenefitCacheRow,
  type PromotionCacheRow,
  type RuleCacheRow,
  type RuleGroupCacheRow,
} from '../promotion-cache'

function promotionRow(overrides: Partial<PromotionCacheRow> = {}): PromotionCacheRow {
  return {
    id: 'promo-1',
    name: 'Test Promotion',
    order: 1,
    cumulative: true,
    tags: ['sale'],
    excludedTags: [],
    excludeFlags: {},
    eligibleCurrencies: [],
    startsAt: null,
    endsAt: null,
    maxBudget: null,
    budgetCurrency: null,
    ...overrides,
  }
}

const ruleGroupRows: RuleGroupCacheRow[] = [
  { id: 'group-root', promotionId: 'promo-1', parentRuleGroupId: null, operator: 'and', sortOrder: 0 },
  { id: 'group-child', promotionId: 'promo-1', parentRuleGroupId: 'group-root', operator: 'or', sortOrder: 0 },
  // A different promotion's rows, included in the same batch array the real service
  // would pass (one query pass for every active promotion) — must be filtered out and
  // never leak into promo-1's tree.
  { id: 'group-other', promotionId: 'promo-2', parentRuleGroupId: null, operator: 'and', sortOrder: 0 },
]

const ruleRows: RuleCacheRow[] = [
  // Deliberately out of sortOrder — must come out sorted ascending.
  { ruleGroupId: 'group-root', promotionId: 'promo-1', ruleType: 'CART_TOTAL', config: { min: 10 }, sortOrder: 2 },
  { ruleGroupId: 'group-root', promotionId: 'promo-1', ruleType: 'CATEGORY', config: { ids: ['x'] }, sortOrder: 1 },
  { ruleGroupId: 'group-child', promotionId: 'promo-1', ruleType: 'TAG', config: { tag: 'sale' }, sortOrder: 0 },
  { ruleGroupId: 'group-other', promotionId: 'promo-2', ruleType: 'OTHER', config: {}, sortOrder: 0 },
]

const benefitRows: BenefitCacheRow[] = [
  {
    ruleGroupId: 'group-root',
    promotionId: 'promo-1',
    benefitType: 'CART_DISCOUNT',
    appliesTo: 'order',
    config: { percent: 10 },
    sortOrder: 1,
  },
  {
    ruleGroupId: 'group-root',
    promotionId: 'promo-1',
    benefitType: 'FREE_SHIPPING',
    appliesTo: 'order',
    config: {},
    sortOrder: 0,
  },
  {
    ruleGroupId: 'group-child',
    promotionId: 'promo-1',
    benefitType: 'LINE_DISCOUNT',
    appliesTo: 'line',
    config: { percent: 5 },
    sortOrder: 0,
  },
]

describe('buildNormalizedPromotion', () => {
  it('builds a root group plus nested child group, each with rules/benefits pre-sorted by sortOrder', () => {
    const result = buildNormalizedPromotion(promotionRow(), ruleGroupRows, ruleRows, benefitRows, '12.34')

    expect(result.id).toBe('promo-1')
    expect(result.name).toBe('Test Promotion')
    expect(result.totalDiscountGranted).toBe('12.34')
    expect(result.startsAt).toBeNull()
    expect(result.endsAt).toBeNull()

    expect(result.rootGroup.operator).toBe('and')
    expect(result.rootGroup.rules).toEqual([
      { type: 'CATEGORY', config: { ids: ['x'] } },
      { type: 'CART_TOTAL', config: { min: 10 } },
    ])
    expect(result.rootGroup.benefits).toEqual([
      { type: 'FREE_SHIPPING', appliesTo: 'order', config: {} },
      { type: 'CART_DISCOUNT', appliesTo: 'order', config: { percent: 10 } },
    ])

    expect(result.rootGroup.children).toHaveLength(1)
    const child = result.rootGroup.children[0]
    expect(child.operator).toBe('or')
    expect(child.rules).toEqual([{ type: 'TAG', config: { tag: 'sale' } }])
    expect(child.benefits).toEqual([{ type: 'LINE_DISCOUNT', appliesTo: 'line', config: { percent: 5 } }])
    expect(child.children).toEqual([])
  })

  it('never leaks another promotion\'s rows into this promotion\'s tree', () => {
    const result = buildNormalizedPromotion(promotionRow(), ruleGroupRows, ruleRows, benefitRows, '0')
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('group-other')
    expect(serialized).not.toContain('OTHER')
  })

  it('converts startsAt/endsAt Date rows to ISO strings', () => {
    const result = buildNormalizedPromotion(
      promotionRow({ startsAt: new Date('2026-01-01T00:00:00.000Z'), endsAt: new Date('2026-02-01T00:00:00.000Z') }),
      ruleGroupRows,
      ruleRows,
      benefitRows,
      '0',
    )
    expect(result.startsAt).toBe('2026-01-01T00:00:00.000Z')
    expect(result.endsAt).toBe('2026-02-01T00:00:00.000Z')
  })

  it('throws a clear [internal] error when the root rule group was not eager-loaded', () => {
    const groupsMissingRoot = ruleGroupRows.filter((group) => group.id !== 'group-root')
    expect(() => buildNormalizedPromotion(promotionRow(), groupsMissingRoot, ruleRows, benefitRows, '0')).toThrow(
      /\[internal\].*root rule group/,
    )
  })

  it('throws a clear [internal] error when a rule references a rule group that was not eager-loaded', () => {
    // `group-child` is dropped from the fetched groups, but `ruleRows`/`benefitRows`
    // still carry rows pointing at it — the orphan-reference case §Cache Build Contract
    // item 3 calls out: "any missing eager-loaded relation is a critical bug".
    const groupsMissingChild = ruleGroupRows.filter((group) => group.id !== 'group-child')
    expect(() => buildNormalizedPromotion(promotionRow(), groupsMissingChild, ruleRows, benefitRows, '0')).toThrow(
      /\[internal\].*rule group group-child/,
    )
  })

  describe('deep freeze (non-production builds)', () => {
    const originalNodeEnv = process.env.NODE_ENV

    afterEach(() => {
      process.env.NODE_ENV = originalNodeEnv
    })

    it('is active under the default test NODE_ENV', () => {
      expect(process.env.NODE_ENV).not.toBe('production')
    })

    it('freezes the top-level NormalizedPromotion so a later mutation throws', () => {
      const result = buildNormalizedPromotion(promotionRow(), ruleGroupRows, ruleRows, benefitRows, '0')
      expect(() => {
        ;(result as { name: string }).name = 'mutated'
      }).toThrow(TypeError)
      expect(() => result.tags.push('mutated')).toThrow(TypeError)
    })

    it('freezes the nested rootGroup tree (rules, benefits, children)', () => {
      const result = buildNormalizedPromotion(promotionRow(), ruleGroupRows, ruleRows, benefitRows, '0')
      expect(() => {
        ;(result.rootGroup as { operator: string }).operator = 'or'
      }).toThrow(TypeError)
      expect(() => {
        ;(result.rootGroup.rules[0] as { type: string }).type = 'mutated'
      }).toThrow(TypeError)
      expect(() => {
        ;(result.rootGroup.children[0] as { operator: string }).operator = 'and'
      }).toThrow(TypeError)
    })

    it('does not deep-freeze when NODE_ENV is production', () => {
      process.env.NODE_ENV = 'production'
      const result = buildNormalizedPromotion(promotionRow(), ruleGroupRows, ruleRows, benefitRows, '0')
      expect(() => {
        ;(result as { name: string }).name = 'mutated'
      }).not.toThrow()
    })
  })
})
