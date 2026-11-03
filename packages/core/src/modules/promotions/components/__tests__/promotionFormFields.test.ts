// Step 8.7 (QA F1): the promotion form schema gained `eligibleCurrencies`/`maxBudget`/
// `budgetCurrency` so the UI can satisfy D-R4-27 without a round trip to the server. This
// pins the client-side mirror of `promotionBudgetAndWindowRefine` in `data/validators.ts`
// — `budgetCurrency` is required exactly when `maxBudget` is set — plus the pre-existing
// `endsAt` ordering check, so a future edit cannot silently drop either rule.

import { createPromotionFormSchema, type PromotionFormValues } from '../promotionFormFields'

const t = ((key: string, fallback?: string) => fallback ?? key) as Parameters<typeof createPromotionFormSchema>[0]

function baseValues(overrides: Partial<PromotionFormValues> = {}): PromotionFormValues {
  return {
    name: 'Spring sale',
    description: null,
    startsAt: null,
    endsAt: null,
    active: true,
    cumulative: true,
    tags: [],
    excludedTags: [],
    excludeFlags: {},
    eligibleCurrencies: [],
    maxBudget: null,
    budgetCurrency: null,
    ...overrides,
  }
}

describe('createPromotionFormSchema', () => {
  it('accepts a promotion with no budget set', () => {
    const result = createPromotionFormSchema(t).safeParse(baseValues())
    expect(result.success).toBe(true)
  })

  it('accepts a promotion with both maxBudget and budgetCurrency set', () => {
    const result = createPromotionFormSchema(t).safeParse(
      baseValues({ maxBudget: '500.00', budgetCurrency: 'USD' }),
    )
    expect(result.success).toBe(true)
  })

  it('rejects maxBudget set without a budgetCurrency', () => {
    const result = createPromotionFormSchema(t).safeParse(baseValues({ maxBudget: '500.00', budgetCurrency: null }))
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.join('.') === 'budgetCurrency')).toBe(true)
    }
  })

  it('rejects maxBudget set with an empty-string budgetCurrency', () => {
    const result = createPromotionFormSchema(t).safeParse(baseValues({ maxBudget: '500.00', budgetCurrency: '' }))
    expect(result.success).toBe(false)
  })

  it('treats an empty-string maxBudget as unset, not requiring a currency', () => {
    const result = createPromotionFormSchema(t).safeParse(baseValues({ maxBudget: '', budgetCurrency: null }))
    expect(result.success).toBe(true)
  })

  it('still rejects endsAt before startsAt alongside the budget check', () => {
    const result = createPromotionFormSchema(t).safeParse(
      baseValues({ startsAt: '2026-02-01', endsAt: '2026-01-01', maxBudget: '10', budgetCurrency: null }),
    )
    expect(result.success).toBe(false)
    if (!result.success) {
      const paths = result.error.issues.map((issue) => issue.path.join('.'))
      expect(paths).toContain('endsAt')
      expect(paths).toContain('budgetCurrency')
    }
  })
})
