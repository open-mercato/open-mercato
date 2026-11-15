import { resolveSupportRouteFromRules, type SupportRoutingRuleView } from '../routing'

const FALLBACK_PROJECT = '00000000-0000-4000-8000-000000000001'
const BILLING_PROJECT = '00000000-0000-4000-8000-000000000002'
const TECH_PROJECT = '00000000-0000-4000-8000-000000000003'

function rule(categoryValue: string | null, timeProjectId: string, isActive = true): SupportRoutingRuleView {
  return { id: `${categoryValue ?? 'fallback'}-rule`, categoryValue, timeProjectId, isActive }
}

describe('resolveSupportRouteFromRules', () => {
  const allUsable = new Set([FALLBACK_PROJECT, BILLING_PROJECT, TECH_PROJECT])

  it('sends every category to the fallback project when it is the only rule', () => {
    const rules = [rule(null, FALLBACK_PROJECT)]
    expect(resolveSupportRouteFromRules(rules, 'billing', allUsable)).toEqual({ timeProjectId: FALLBACK_PROJECT, via: 'fallback' })
    expect(resolveSupportRouteFromRules(rules, 'technical-issue', allUsable)).toEqual({ timeProjectId: FALLBACK_PROJECT, via: 'fallback' })
  })

  it('prefers a usable per-category rule', () => {
    const rules = [rule(null, FALLBACK_PROJECT), rule('billing', BILLING_PROJECT), rule('technical-issue', TECH_PROJECT)]
    expect(resolveSupportRouteFromRules(rules, 'billing', allUsable)).toEqual({ timeProjectId: BILLING_PROJECT, via: 'category' })
    expect(resolveSupportRouteFromRules(rules, 'technical-issue', allUsable)).toEqual({ timeProjectId: TECH_PROJECT, via: 'category' })
    expect(resolveSupportRouteFromRules(rules, 'general-question', allUsable)).toEqual({ timeProjectId: FALLBACK_PROJECT, via: 'fallback' })
  })

  it('falls back when the category rule is paused', () => {
    const rules = [rule(null, FALLBACK_PROJECT), rule('billing', BILLING_PROJECT, false)]
    expect(resolveSupportRouteFromRules(rules, 'billing', allUsable)).toEqual({ timeProjectId: FALLBACK_PROJECT, via: 'fallback' })
  })

  it('falls back when the category rule points at an unusable project', () => {
    const rules = [rule(null, FALLBACK_PROJECT), rule('billing', BILLING_PROJECT)]
    const usable = new Set([FALLBACK_PROJECT])
    expect(resolveSupportRouteFromRules(rules, 'billing', usable)).toEqual({ timeProjectId: FALLBACK_PROJECT, via: 'fallback' })
  })

  it('keeps a usable override working when the fallback project is unusable', () => {
    const rules = [rule(null, FALLBACK_PROJECT), rule('billing', BILLING_PROJECT)]
    const usable = new Set([BILLING_PROJECT])
    expect(resolveSupportRouteFromRules(rules, 'billing', usable)).toEqual({ timeProjectId: BILLING_PROJECT, via: 'category' })
    expect(resolveSupportRouteFromRules(rules, 'general-question', usable)).toBeNull()
  })

  it('returns null when there is no fallback rule and no category rule', () => {
    expect(resolveSupportRouteFromRules([], 'billing', allUsable)).toBeNull()
    expect(resolveSupportRouteFromRules([rule('billing', BILLING_PROJECT)], 'general-question', allUsable)).toBeNull()
  })
})
