import { evaluateGroup } from './rule-evaluators'
import { resolveEffects } from './effect-resolvers'
import type {
  AppliedPromotion,
  EvaluateResult,
  EvaluationContext,
  EvaluationInput,
  NormalizedBenefit,
  NormalizedPromotion,
  NormalizedRuleGroup,
} from './types'

// Three-pass evaluation engine (SPEC-055 §Evaluation Engine Data Flow). Pure: no
// MikroORM entities, no DB access, no system-clock reads — every time-sensitive check
// compares against the caller-supplied `input.evaluatedAt`. The caller (the promotion
// cache, §Cache Build Contract) is responsible for ordering `promotions` by
// `ORDER BY order ASC, id ASC` before calling this function; it is not re-sorted here.
export function evaluatePromotions(
  promotions: NormalizedPromotion[],
  input: EvaluationInput,
): EvaluateResult {
  const appliedTags: string[] = []
  const appliedPromotions: AppliedPromotion[] = []

  for (const promotion of promotions) {
    if (!isPromotionEligible(promotion, input, appliedTags)) continue

    const context: EvaluationContext = {
      items: input.items,
      currency: input.currency,
      evaluatedAt: input.evaluatedAt,
      buyer: input.buyer,
      customerOrderCount: input.customerOrderCount,
      cartWeight: input.cartWeight,
      codes: input.codes,
      appliedTags,
      excludeFlags: promotion.excludeFlags,
      currencyFractionDigits: input.currencyFractionDigits,
      // D-R5-17: absent on every existing (cart-stage) caller, so `evaluateDeliveryMethod`/
      // `resolveDeliveryDiscount` both fail closed and this is a pure pass-through.
      deliveryMethodCode: input.deliveryMethodCode,
      deliveryCost: input.deliveryCost,
    }

    const matched = evaluateGroup(promotion.rootGroup, context)
    if (!matched) continue

    const benefits = collectBenefits(promotion.rootGroup)
    const effects = resolveEffects(benefits, context, promotion.id)

    appliedPromotions.push({
      promotionId: promotion.id,
      promotionName: promotion.name,
      effects,
    })

    for (const tag of promotion.tags) {
      if (!appliedTags.includes(tag)) appliedTags.push(tag)
    }

    if (!promotion.cumulative) break
  }

  return { appliedPromotions }
}

// Checks #1-4 from §Evaluation Engine Data Flow, run before Pass 1: date window,
// excluded-tags intersection against the tags accumulated so far, currency eligibility,
// and the optimistic (non-authoritative) budget pre-check. Extracted from the loop above
// so each condition is independently unit-testable — in particular the excluded-tags
// check, whose `appliedTagsSoFar` would otherwise only ever be populated by a promotion
// that already passed Pass 1, which this step's `evaluateGroup` stub cannot do.
export function isPromotionEligible(
  promotion: NormalizedPromotion,
  input: Pick<EvaluationInput, 'evaluatedAt' | 'currency'>,
  appliedTagsSoFar: string[],
): boolean {
  const evaluatedAtMs = new Date(input.evaluatedAt).getTime()

  if (promotion.startsAt !== null && evaluatedAtMs < new Date(promotion.startsAt).getTime()) return false
  if (promotion.endsAt !== null && evaluatedAtMs > new Date(promotion.endsAt).getTime()) return false
  if (promotion.excludedTags.some((tag) => appliedTagsSoFar.includes(tag))) return false
  if (promotion.eligibleCurrencies.length > 0 && !promotion.eligibleCurrencies.includes(input.currency)) return false
  if (promotion.maxBudget !== null && Number(promotion.totalDiscountGranted) >= Number(promotion.maxBudget)) {
    return false
  }

  return true
}

// Pure recursive tree walk collecting every group's `benefits` array (Pass 2). Needs no
// rule-type knowledge — the real per-rule-type logic lives in `rule-evaluators.ts`.
export function collectBenefits(group: NormalizedRuleGroup): NormalizedBenefit[] {
  const benefits: NormalizedBenefit[] = [...group.benefits]
  for (const child of group.children) {
    benefits.push(...collectBenefits(child))
  }
  return benefits
}
