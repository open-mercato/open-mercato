// Local (client-side) tree state for the Rule Group Tree Builder (Step 1.7, SPEC-055
// §UI/UX "Rule Group Tree Builder"). This is a plain nested object mirroring the
// `RuleGroupTreeNodeInput`/`RuleInput`/`BenefitInput` shape from `data/validators.ts`
// (Step 1.2), with one addition: every node carries a `clientId` used only for React
// keys and reducer targeting — it is never sent to the server. `id` is present only for
// nodes that already exist server-side; new nodes omit it and the
// `promotions.rule_tree.reconcile` command (Step 1.4) mints a real id on save (see
// `commands/rule-tree.ts` `planRuleGroupTree`), the same convention
// `packages/ui/src/backend/filters/treeReducer.ts` documents for its own tree.
//
// Only the ELEVEN Release 4 shipped rule types and FIVE shipped benefit types are
// offered here — `RELEASE_4_SHIPPED_RULE_TYPES`/`RELEASE_4_SHIPPED_BENEFIT_TYPES` are
// imported directly from `data/validators.ts` so this file cannot silently drift from
// the write-path allow-list (the hidden types, including `delivery_discount`, are never
// referenced here).

import {
  RELEASE_4_SHIPPED_RULE_TYPES,
  RELEASE_4_SHIPPED_BENEFIT_TYPES,
  comparisonOperatorValues,
  promotionBenefitAppliesToValues,
} from '../data/validators'

export type RuleTypeId = (typeof RELEASE_4_SHIPPED_RULE_TYPES)[number]
export type BenefitTypeId = (typeof RELEASE_4_SHIPPED_BENEFIT_TYPES)[number]
export type ComparisonOperator = (typeof comparisonOperatorValues)[number]

// `promotionBenefitAppliesToValues` IS exported from `data/validators.ts` (unlike the
// per-type allow-lists below, which live only inline inside `shippedBenefitVariants` and
// are mirrored here), so it is imported directly rather than duplicated.
export const appliesToOptions = promotionBenefitAppliesToValues
export type AppliesToId = (typeof appliesToOptions)[number]

// Mirrors `data/validators.ts`'s `shippedBenefitVariants` table (Step 1.2,
// §Data Models "Allowed values per applies_to per benefit_type") — the per-type
// `allowedAppliesTo` set and `defaultAppliesTo` passed to each `benefitEnvelope(...)`
// call are not exported from that file (only the resulting schemas are), so this table
// is mirrored by hand. A drift between the two would surface immediately as a 422 on
// save (an "Applies to" value this UI lets the operator pick that the write path then
// rejects), the same contract `discountTypeOptions` above already relies on.
export const BENEFIT_APPLIES_TO: Record<BenefitTypeId, { allowed: AppliesToId[]; default: AppliesToId }> = {
  product_discount: { allowed: ['line', 'unit'], default: 'line' },
  cart_discount: { allowed: ['order'], default: 'order' },
  free_product: { allowed: ['order'], default: 'order' },
  buy_x_get_y: { allowed: ['line', 'unit'], default: 'unit' },
  tiered_discount: { allowed: ['order', 'line', 'unit'], default: 'order' },
}

// `data/validators.ts` keeps its own `discountTypeValues` module-local (not exported) —
// mirrored here rather than exported from Step 1.2's file to keep this step's change
// surface limited to new files. Both lists must name the same two values
// (`discount_type` text, §Data Models); a drift between them would surface immediately
// as a 422 on save.
export const discountTypeOptions = ['percentage', 'fixed'] as const
export type DiscountTypeId = (typeof discountTypeOptions)[number]

export const RULE_TYPE_OPTIONS: RuleTypeId[] = [...RELEASE_4_SHIPPED_RULE_TYPES]
export const BENEFIT_TYPE_OPTIONS: BenefitTypeId[] = [...RELEASE_4_SHIPPED_BENEFIT_TYPES]

export type LocalRuleNode = {
  clientId: string
  id?: string
  sortOrder: number
  ruleType: RuleTypeId
  config: Record<string, unknown>
}

export type TierRow = { threshold: string; discountType: DiscountTypeId; value: string }

export type LocalBenefitNode = {
  clientId: string
  id?: string
  sortOrder: number
  benefitType: BenefitTypeId
  // Step 1.8's "Applies to" segmented control. A sibling of `config` on the wire (the
  // `benefitEnvelope` in `data/validators.ts` puts `appliesTo` next to `config`, not
  // inside it) — Step 1.7 left this unset and let the server's per-type default apply;
  // Step 1.8 makes it explicit so the UI can restrict the control and compute the echo
  // line without re-fetching the server default.
  appliesTo: AppliesToId
  config: Record<string, unknown>
  labels: Record<string, string>
}

// §Data Models "Quantity caps (shared config block)": "At least one label is required"
// (`nonEmptyLabelsSchema` in `data/validators.ts`) — a benefit with no non-blank label
// in any locale 422s on save. Used by `BenefitCard.tsx` (inline indicator) and
// `RuleTreeBuilder.tsx` (pre-save guard) so the operator sees this before the request,
// not as the generic save-error flash Step 1.7 left (its own report flagged this gap).
export function isBenefitLabelsEmpty(labels: Record<string, string>): boolean {
  return !Object.values(labels).some((value) => typeof value === 'string' && value.trim() !== '')
}

export type LocalRuleGroupNode = {
  clientId: string
  id?: string
  sortOrder: number
  operator: 'and' | 'or'
  rules: LocalRuleNode[]
  benefits: LocalBenefitNode[]
  children: LocalRuleGroupNode[]
}

function clientId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `tmp-${Math.random().toString(36).slice(2)}`
}

// Defaults per rule type — matches the shape `data/validators.ts`'s per-type config
// schema expects, with the operator defaulting to `eq` (the first allowed value) and
// numeric/text fields defaulting to an empty/zero baseline the operator must fill in.
export function buildDefaultRuleConfig(ruleType: RuleTypeId): Record<string, unknown> {
  switch (ruleType) {
    case 'order_value':
      return { value: '0', operator: 'eq', taxInclusive: false, limitToCategory: null }
    case 'order_date':
      return { date: new Date().toISOString().slice(0, 10), operator: 'eq' }
    case 'product_count':
      return { value: 0, operator: 'eq' }
    case 'cart_weight':
      return { value: '0', operator: 'eq' }
    case 'row_total':
      return { value: '0', operator: 'eq', productId: null, categoryId: null }
    case 'product':
      return { productId: '', variantId: null, quantity: 1, operator: 'eq' }
    case 'category':
      return { categoryId: '', quantity: 1, operator: 'eq' }
    case 'product_attribute':
      return { attributeCode: '', operator: 'eq', value: '' }
    case 'customer_group':
      return { customerGroupId: '' }
    case 'customer_order_history':
      return { value: 0, operator: 'eq' }
    case 'code':
      return { codeId: '' }
    default:
      return {}
  }
}

// Defaults per benefit type. Quantity-cap fields (`maxQuantity`/`maxLines`/
// `quantityStep`/`selector`/`nthPosition`) are intentionally omitted — they are all
// optional/nullable in `data/validators.ts`'s shared quantity-cap block, and the
// "Applies to / Limits / Which pieces" UI that edits them is explicitly Step 1.8's job
// (SPEC-055 §UI/UX, rev note on the Promotion Form / Rule Group Tree Builder sections).
export function buildDefaultBenefitConfig(benefitType: BenefitTypeId): Record<string, unknown> {
  switch (benefitType) {
    case 'product_discount':
      return { productId: null, discountType: 'percentage', value: '0', limitToCategoryId: null, maxDiscount: null }
    case 'cart_discount':
      return { discountType: 'percentage', value: '0', maxDiscount: null }
    case 'free_product':
      return { productId: null, categoryId: null, quantity: 1 }
    case 'buy_x_get_y':
      return {
        triggerProductId: null,
        triggerCategoryId: null,
        triggerQuantity: 1,
        rewardProductId: '',
        rewardVariantId: null,
        rewardQuantity: 1,
        discountType: 'percentage',
        value: '0',
        maxApplications: null,
        maxDiscount: null,
      }
    case 'tiered_discount':
      return { limitToCategoryId: null, tiers: [{ threshold: '0', discountType: 'percentage', value: '0' }], maxDiscount: null }
    default:
      return {}
  }
}

export function createEmptyRule(sortOrder: number, ruleType: RuleTypeId = RULE_TYPE_OPTIONS[0]): LocalRuleNode {
  return { clientId: clientId(), sortOrder, ruleType, config: buildDefaultRuleConfig(ruleType) }
}

export function createEmptyBenefit(sortOrder: number, benefitType: BenefitTypeId = BENEFIT_TYPE_OPTIONS[0]): LocalBenefitNode {
  return {
    clientId: clientId(),
    sortOrder,
    benefitType,
    appliesTo: BENEFIT_APPLIES_TO[benefitType].default,
    config: buildDefaultBenefitConfig(benefitType),
    labels: {},
  }
}

export function createEmptyGroup(sortOrder: number, operator: 'and' | 'or' = 'and'): LocalRuleGroupNode {
  return { clientId: clientId(), sortOrder, operator, rules: [], benefits: [], children: [] }
}

// ---------------------------------------------------------------------------
// Server <-> local conversion
// ---------------------------------------------------------------------------

type ServerRule = { id: string; ruleType: string; config: Record<string, unknown>; sortOrder: number }
type ServerBenefit = {
  id: string
  benefitType: string
  appliesTo: string
  config: Record<string, unknown>
  sortOrder: number
}
export type ServerRuleGroupTree = {
  id: string
  operator: string
  sortOrder: number
  rules: ServerRule[]
  benefits: ServerBenefit[]
  children: ServerRuleGroupTree[]
}

function splitLabels(config: Record<string, unknown>): { config: Record<string, unknown>; labels: Record<string, string> } {
  const { labels, ...rest } = config
  const normalizedLabels: Record<string, string> = {}
  if (labels && typeof labels === 'object' && !Array.isArray(labels)) {
    for (const [locale, text] of Object.entries(labels as Record<string, unknown>)) {
      if (typeof text === 'string') normalizedLabels[locale] = text
    }
  }
  return { config: rest, labels: normalizedLabels }
}

export function fromServerTree(node: ServerRuleGroupTree): LocalRuleGroupNode {
  return {
    clientId: clientId(),
    id: node.id,
    sortOrder: node.sortOrder,
    operator: node.operator === 'or' ? 'or' : 'and',
    rules: node.rules.map((rule) => ({
      clientId: clientId(),
      id: rule.id,
      sortOrder: rule.sortOrder,
      ruleType: rule.ruleType as RuleTypeId,
      config: rule.config,
    })),
    benefits: node.benefits.map((benefit) => {
      const { config, labels } = splitLabels(benefit.config)
      const benefitType = benefit.benefitType as BenefitTypeId
      const appliesTo = (appliesToOptions as readonly string[]).includes(benefit.appliesTo)
        ? (benefit.appliesTo as AppliesToId)
        : BENEFIT_APPLIES_TO[benefitType].default
      return {
        clientId: clientId(),
        id: benefit.id,
        sortOrder: benefit.sortOrder,
        benefitType,
        appliesTo,
        config,
        labels,
      }
    }),
    children: node.children.map((child) => fromServerTree(child)),
  }
}

type SerializedRule = { id?: string; sortOrder: number; ruleType: string; config: Record<string, unknown> }
type SerializedBenefit = {
  id?: string
  sortOrder: number
  benefitType: string
  appliesTo: string
  config: Record<string, unknown>
}
export type SerializedGroup = {
  id?: string
  sortOrder: number
  operator: 'and' | 'or'
  rules: SerializedRule[]
  benefits: SerializedBenefit[]
  children: SerializedGroup[]
}

// Serializes local state back to the `PUT /api/promotions/[id]/tree` body shape
// (`promotionTreeUpdateSchema`'s `root`, §Data Models). `clientId` is dropped; `id` is
// included only when the node already exists server-side. Sort order is recomputed from
// array position so drag/reorder is reflected regardless of how it happened.
export function toServerTree(node: LocalRuleGroupNode): SerializedGroup {
  return {
    ...(node.id ? { id: node.id } : {}),
    sortOrder: node.sortOrder,
    operator: node.operator,
    rules: node.rules.map((rule, index) => ({
      ...(rule.id ? { id: rule.id } : {}),
      sortOrder: index,
      ruleType: rule.ruleType,
      config: rule.config,
    })),
    benefits: node.benefits.map((benefit, index) => ({
      ...(benefit.id ? { id: benefit.id } : {}),
      sortOrder: index,
      benefitType: benefit.benefitType,
      appliesTo: benefit.appliesTo,
      config: { ...benefit.config, labels: benefit.labels },
    })),
    children: node.children.map((child, index) => ({ ...toServerTree(child), sortOrder: index })),
  }
}
