import { z } from 'zod'

const uuid = () => z.string().uuid()

const emptyStringToNull = (value: unknown): unknown => {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

// Mirrors `clearableStringSchema` in `customer_groups/data/validators.ts`: blanking a
// previously-set value on edit must transmit null to clear it, not be silently dropped.
const clearableStringSchema = (max: number) =>
  z.preprocess(emptyStringToNull, z.string().trim().max(max).nullable().optional())

const clearableDateSchema = z.preprocess(emptyStringToNull, z.coerce.date().nullable().optional())

const clearableUuidSchema = z.preprocess(emptyStringToNull, uuid().nullable().optional())

// Decimal amounts travel as strings end-to-end (§Data Models: "value decimal string") so
// a caller never loses precision to IEEE-754 float rounding before this module's own
// half-up integer-minor-units rounding (Phase 2, D-R4-10) ever runs.
const decimalStringSchema = z.string().regex(/^-?\d+(\.\d+)?$/, 'Must be a decimal string')

const clearableDecimalStringSchema = z.preprocess(emptyStringToNull, decimalStringSchema.nullable().optional())

const currencyCodeSchema = z
  .string()
  .trim()
  .length(3, 'Currency code must be an ISO 4217 3-letter code')
  .transform((value) => value.toUpperCase())

const clearableCurrencyCodeSchema = z.preprocess(emptyStringToNull, currencyCodeSchema.nullable().optional())

// No operator enum is defined anywhere in SPEC-055 for `order_value`/`order_date`/
// `product_count`/`cart_weight`/`row_total`/`product`/`category`/`customer_order_history`
// rule configs or the hidden `producer`/`shipping_address` configs. This six-value
// comparison set is this module's own resolved judgment call (flagged in the Step 1.2
// report) — Phase 2's `lib/rule-evaluators.ts` is the first consumer and should confirm
// or correct it before it ships to the admin UI.
export const comparisonOperatorValues = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'] as const
export const comparisonOperatorSchema = z.enum(comparisonOperatorValues)

const nonEmptyLabelsSchema = z
  .record(z.string(), z.string().trim().min(1))
  .refine((value) => Object.keys(value).length > 0, 'At least one label is required')

const isoDateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be an ISO date (YYYY-MM-DD)')

// ---------------------------------------------------------------------------
// Rule configs — Release 4 rule set (§Data Models, rev P10/D-R4-14)
// ---------------------------------------------------------------------------

const orderValueConfigSchema = z
  .object({
    value: decimalStringSchema,
    operator: comparisonOperatorSchema,
    taxInclusive: z.boolean(),
    limitToCategory: clearableStringSchema(200),
  })
  .strict()

const orderDateConfigSchema = z
  .object({
    date: isoDateStringSchema,
    operator: comparisonOperatorSchema,
  })
  .strict()

const productCountConfigSchema = z
  .object({
    value: z.number().int(),
    operator: comparisonOperatorSchema,
  })
  .strict()

const cartWeightConfigSchema = z
  .object({
    value: decimalStringSchema,
    operator: comparisonOperatorSchema,
  })
  .strict()

// `sku`/`category_slug` replaced by id fields (rev — items are never addressed by SKU
// in Release 4, §API Contracts).
const rowTotalConfigSchema = z
  .object({
    value: decimalStringSchema,
    operator: comparisonOperatorSchema,
    productId: clearableUuidSchema,
    categoryId: clearableUuidSchema,
  })
  .strict()

const productConfigSchema = z
  .object({
    productId: uuid(),
    variantId: clearableUuidSchema,
    quantity: z.number().int(),
    operator: comparisonOperatorSchema,
  })
  .strict()

// Includes descendants — ancestor-expanded match (D-R4-15); the expansion itself is a
// Phase 2 evaluator concern, not a validator concern.
const categoryConfigSchema = z
  .object({
    categoryId: uuid(),
    quantity: z.number().int(),
    operator: comparisonOperatorSchema,
  })
  .strict()

const productAttributeConfigSchema = z
  .object({
    attributeCode: z.string().trim().min(1).max(100),
    operator: comparisonOperatorSchema,
    value: z.string().trim().min(1).max(500),
  })
  .strict()

// Replaces `user_group` outright (rev — not additive; nothing has ever shipped against
// `user_group`, §Data Models).
const customerGroupConfigSchema = z
  .object({
    customerGroupId: uuid(),
  })
  .strict()

const customerOrderHistoryConfigSchema = z
  .object({
    value: z.number().int(),
    operator: comparisonOperatorSchema,
  })
  .strict()

// `codeId` is validated against `promotion_codes` in commands before persisting
// (§Data Models) — this schema only checks shape.
const codeRuleConfigSchema = z
  .object({
    codeId: uuid(),
  })
  .strict()

// --- Hidden rule types (§Data Models) — modelled so the discriminated union never needs
// a second migration later, but excluded from `ruleInputSchema` (the Release 4 write-path
// schema) below. No admin UI, no Phase 1-3 evaluator registration.

const producerConfigSchema = z
  .object({
    producerCode: z.string().trim().min(1).max(100),
    quantity: z.number().int(),
    operator: comparisonOperatorSchema,
  })
  .strict()

const excludePharmaceuticalConfigSchema = z.object({}).strict()

const consentFlagConfigSchema = z
  .object({
    flagKey: z.string().trim().min(1).max(100),
  })
  .strict()

const deliveryMethodRuleConfigSchema = z
  .object({
    deliveryMethodCode: z.string().trim().min(1).max(100),
  })
  .strict()

const paymentMethodConfigSchema = z
  .object({
    paymentMethodCode: z.string().trim().min(1).max(100),
  })
  .strict()

const shippingAddressConfigSchema = z
  .object({
    field: z.string().trim().min(1).max(100),
    operator: comparisonOperatorSchema,
    value: z.string().trim().min(1).max(500),
  })
  .strict()

const ruleEnvelope = <Type extends string, Config extends z.ZodTypeAny>(
  ruleType: Type,
  config: Config,
) =>
  z.object({
    id: uuid().optional(),
    sortOrder: z.number().int().min(0).optional().default(0),
    ruleType: z.literal(ruleType),
    config,
  })

const shippedRuleVariants = [
  ruleEnvelope('order_value', orderValueConfigSchema),
  ruleEnvelope('order_date', orderDateConfigSchema),
  ruleEnvelope('product_count', productCountConfigSchema),
  ruleEnvelope('cart_weight', cartWeightConfigSchema),
  ruleEnvelope('row_total', rowTotalConfigSchema),
  ruleEnvelope('product', productConfigSchema),
  ruleEnvelope('category', categoryConfigSchema),
  ruleEnvelope('product_attribute', productAttributeConfigSchema),
  ruleEnvelope('customer_group', customerGroupConfigSchema),
  ruleEnvelope('customer_order_history', customerOrderHistoryConfigSchema),
  ruleEnvelope('code', codeRuleConfigSchema),
] as const

const hiddenRuleVariants = [
  ruleEnvelope('producer', producerConfigSchema),
  ruleEnvelope('exclude_pharmaceutical', excludePharmaceuticalConfigSchema),
  ruleEnvelope('consent_flag', consentFlagConfigSchema),
  ruleEnvelope('delivery_method', deliveryMethodRuleConfigSchema),
  ruleEnvelope('payment_method', paymentMethodConfigSchema),
  ruleEnvelope('shipping_address', shippingAddressConfigSchema),
] as const

export const RELEASE_4_SHIPPED_RULE_TYPES = [
  'order_value',
  'order_date',
  'product_count',
  'cart_weight',
  'row_total',
  'product',
  'category',
  'product_attribute',
  'customer_group',
  'customer_order_history',
  'code',
] as const

export const PROMOTIONS_HIDDEN_RULE_TYPES = [
  'producer',
  'exclude_pharmaceutical',
  'consent_flag',
  'delivery_method',
  'payment_method',
  'shipping_address',
] as const

// Write-path schema (§Implementation Plan Phase 1, step 3): only the eleven Release 4
// rule types are accepted here. A request naming a hidden type fails to match any
// variant's `ruleType` literal and the discriminated union rejects it — the rejection
// a hidden-rule-type write test (`TC-PROM-0xx`) exercises, not merely hiding the type
// from the admin UI combobox.
export const ruleInputSchema = z.discriminatedUnion('ruleType', [...shippedRuleVariants])

// Full model (all seventeen types, shipped + hidden) — kept so the discriminated union
// does not need a second migration later when a data source appears for a hidden type
// (§Data Models rev P10). Used by extension/internal tooling only, never the write path.
export const ruleInputSchemaFull = z.discriminatedUnion('ruleType', [
  ...shippedRuleVariants,
  ...hiddenRuleVariants,
])

export type RuleInput = z.infer<typeof ruleInputSchema>

// ---------------------------------------------------------------------------
// Benefit configs — Application target (`applies_to`) and shared quantity-cap block
// (§Data Models)
// ---------------------------------------------------------------------------

export const promotionBenefitAppliesToValues = ['order', 'line', 'unit'] as const
export const promotionBenefitAppliesToSchema = z.enum(promotionBenefitAppliesToValues)

export const quantityCapSelectorValues = ['all', 'cart_order', 'cheapest', 'most_expensive', 'nth'] as const
export const quantityCapSelectorSchema = z.enum(quantityCapSelectorValues)

// Shared block intersected into every benefit variant (§Data Models "Quantity caps").
const quantityCapShape = {
  maxQuantity: z.number().int().positive().nullable().optional(),
  maxLines: z.number().int().positive().nullable().optional(),
  quantityStep: z.number().int().positive().nullable().optional(),
  selector: quantityCapSelectorSchema.nullable().optional(),
  nthPosition: z.number().int().positive().nullable().optional(),
}

type QuantityCapConfig = {
  maxQuantity?: number | null
  maxLines?: number | null
  quantityStep?: number | null
  selector?: (typeof quantityCapSelectorValues)[number] | null
  nthPosition?: number | null
}

// §Data Models "Write-path rejections (422), normative" — implemented as real
// rejections (not documentation): a capped benefit on `applies_to: 'order'`, a cap with
// no `selector`, `selector: 'all'` plus a cap, `selector: 'nth'` plus a cap,
// `selector`/`nthPosition` split apart, and `quantityStep` under `applies_to: 'line'`.
function checkQuantityCapRules(
  config: QuantityCapConfig,
  appliesTo: (typeof promotionBenefitAppliesToValues)[number],
  ctx: z.RefinementCtx,
) {
  const hasCap = config.maxQuantity != null || config.maxLines != null

  if (appliesTo === 'order') {
    if (config.maxQuantity != null || config.maxLines != null || config.quantityStep != null) {
      ctx.addIssue({
        code: 'custom',
        message: 'Quantity caps are not meaningful when appliesTo is "order" — nothing to count',
        path: ['config', 'maxQuantity'],
      })
    }
    // Nothing else to check: selector/nthPosition rules below only matter when a cap
    // can exist, which is already rejected above for `order`.
    return
  }

  if (hasCap && !config.selector) {
    ctx.addIssue({
      code: 'custom',
      message: 'selector is required when maxQuantity or maxLines is set',
      path: ['config', 'selector'],
    })
  }

  if (config.selector === 'all' && hasCap) {
    ctx.addIssue({
      code: 'custom',
      message: '"all" selector cannot be combined with a quantity cap — "all" means every qualifying unit',
      path: ['config', 'selector'],
    })
  }

  if (config.selector === 'nth' && hasCap) {
    ctx.addIssue({
      code: 'custom',
      message: '"nth" selector is its own cap and may not be combined with maxQuantity or maxLines',
      path: ['config', 'selector'],
    })
  }

  if (config.selector === 'nth' && config.nthPosition == null) {
    ctx.addIssue({
      code: 'custom',
      message: 'nthPosition is required when selector is "nth"',
      path: ['config', 'nthPosition'],
    })
  }

  if (config.selector !== 'nth' && config.nthPosition != null) {
    ctx.addIssue({
      code: 'custom',
      message: 'nthPosition is only meaningful when selector is "nth"',
      path: ['config', 'nthPosition'],
    })
  }

  // Blocks are counted in units only; `applies_to: 'line'` spends whole lines, where "a
  // block of units" has no meaning (§Data Models).
  if (config.quantityStep != null && appliesTo === 'line') {
    ctx.addIssue({
      code: 'custom',
      message: 'quantityStep is not meaningful when appliesTo is "line" — lines are spent whole',
      path: ['config', 'quantityStep'],
    })
  }
}

const discountTypeValues = ['percentage', 'fixed'] as const
const discountTypeSchema = z.enum(discountTypeValues)

const tierElementSchema = z
  .object({
    threshold: decimalStringSchema,
    discountType: discountTypeSchema,
    value: decimalStringSchema,
  })
  .strict()

// §Data Models: "Tiers must be sorted ascending by threshold."
const tiersSchema = z
  .array(tierElementSchema)
  .min(1)
  .superRefine((tiers, ctx) => {
    for (let i = 1; i < tiers.length; i += 1) {
      if (Number(tiers[i - 1].threshold) > Number(tiers[i].threshold)) {
        ctx.addIssue({
          code: 'custom',
          message: 'tiers must be sorted ascending by threshold',
          path: [i, 'threshold'],
        })
      }
    }
  })

const productDiscountConfigSchema = z
  .object({
    productId: clearableUuidSchema,
    discountType: discountTypeSchema,
    value: decimalStringSchema,
    limitToCategoryId: clearableUuidSchema,
    maxDiscount: clearableDecimalStringSchema,
    labels: nonEmptyLabelsSchema,
    ...quantityCapShape,
  })
  .strict()

const cartDiscountConfigSchema = z
  .object({
    discountType: discountTypeSchema,
    value: decimalStringSchema,
    maxDiscount: clearableDecimalStringSchema,
    labels: nonEmptyLabelsSchema,
    ...quantityCapShape,
  })
  .strict()

// Hidden from the admin tree builder in Release 4 (D-R4-14); the type and its config
// schema stay in the model per §Data Models.
const deliveryDiscountConfigSchema = z
  .object({
    deliveryMethodCode: z.string().trim().min(1).max(100),
    discountType: discountTypeSchema,
    value: decimalStringSchema,
    labels: nonEmptyLabelsSchema,
    ...quantityCapShape,
  })
  .strict()

const freeProductConfigSchema = z
  .object({
    productId: clearableUuidSchema,
    categoryId: clearableUuidSchema,
    quantity: z.number().int().positive(),
    labels: nonEmptyLabelsSchema,
    ...quantityCapShape,
  })
  .strict()

const buyXGetYConfigSchema = z
  .object({
    triggerProductId: clearableUuidSchema,
    triggerCategoryId: clearableUuidSchema,
    triggerQuantity: z.number().int().positive(),
    rewardProductId: uuid(),
    rewardVariantId: clearableUuidSchema,
    rewardQuantity: z.number().int().positive(),
    discountType: discountTypeSchema,
    value: decimalStringSchema,
    maxApplications: z.number().int().positive().nullable().optional(),
    maxDiscount: clearableDecimalStringSchema,
    labels: nonEmptyLabelsSchema,
    ...quantityCapShape,
  })
  .strict()

const tieredDiscountConfigSchema = z
  .object({
    limitToCategoryId: clearableUuidSchema,
    tiers: tiersSchema,
    maxDiscount: clearableDecimalStringSchema,
    labels: nonEmptyLabelsSchema,
    ...quantityCapShape,
  })
  .strict()

// §Data Models "Allowed values per applies_to per benefit_type" table — enforced by
// restricting each variant's `appliesTo` literal set (not merely documented) and
// defaulting to the type's documented default when the operator omits it.
const benefitEnvelope = <Type extends string, Config extends z.ZodTypeAny, Allowed extends string>(
  benefitType: Type,
  config: Config,
  allowedAppliesTo: readonly [Allowed, ...Allowed[]],
  defaultAppliesTo: Allowed,
) =>
  z.object({
    id: uuid().optional(),
    sortOrder: z.number().int().min(0).optional().default(0),
    benefitType: z.literal(benefitType),
    appliesTo: z.enum(allowedAppliesTo).optional().default(defaultAppliesTo),
    config,
  })

const shippedBenefitVariants = [
  benefitEnvelope('product_discount', productDiscountConfigSchema, ['line', 'unit'] as const, 'line'),
  benefitEnvelope('cart_discount', cartDiscountConfigSchema, ['order'] as const, 'order'),
  benefitEnvelope('free_product', freeProductConfigSchema, ['order'] as const, 'order'),
  benefitEnvelope('buy_x_get_y', buyXGetYConfigSchema, ['line', 'unit'] as const, 'unit'),
  benefitEnvelope('tiered_discount', tieredDiscountConfigSchema, ['order', 'line', 'unit'] as const, 'order'),
] as const

// Hidden from the admin tree builder in Release 4 (D-R4-14) — same rejection mechanism
// as the hidden rule types: excluded from `benefitInputSchema`, kept in
// `benefitInputSchemaFull` for the model.
const hiddenBenefitVariants = [
  benefitEnvelope('delivery_discount', deliveryDiscountConfigSchema, ['order'] as const, 'order'),
] as const

export const RELEASE_4_SHIPPED_BENEFIT_TYPES = [
  'product_discount',
  'cart_discount',
  'free_product',
  'buy_x_get_y',
  'tiered_discount',
] as const

export const PROMOTIONS_HIDDEN_BENEFIT_TYPES = ['delivery_discount'] as const

const withQuantityCapGuard = <T extends z.ZodTypeAny>(schema: T) =>
  schema.superRefine((value: any, ctx) => {
    checkQuantityCapRules(value.config, value.appliesTo, ctx)
  })

export const benefitInputSchema = withQuantityCapGuard(
  z.discriminatedUnion('benefitType', [...shippedBenefitVariants]),
)

export const benefitInputSchemaFull = withQuantityCapGuard(
  z.discriminatedUnion('benefitType', [...shippedBenefitVariants, ...hiddenBenefitVariants]),
)

export type BenefitInput = z.infer<typeof benefitInputSchema>

// ---------------------------------------------------------------------------
// D-R4-27: single `eligible_currency` requirement
// ---------------------------------------------------------------------------
//
// "Benefits with fixed amounts or tiers, and order_value/row_total thresholds, require a
// single eligible_currency (write-path validation)." This is a cross-entity rule — it
// reads `Promotion.eligibleCurrencies`, which is not visible from an individual Rule or
// Benefit config — so it cannot live inside `ruleInputSchema`/`benefitInputSchema`
// themselves. It is exposed here as a composite schema + assertion helper for the
// commands that own the full tree + promotion context (`commands/promotions.ts`,
// `commands/rule-tree.ts`, Step 1.3+) to call before persisting. Flagged in the Step 1.2
// report as the resolved design choice for this cross-entity check.

export const CURRENCY_SENSITIVE_RULE_TYPES = ['order_value', 'row_total'] as const

export function benefitRequiresSingleEligibleCurrency(
  benefitType: string,
  config: { discountType?: string },
): boolean {
  if (benefitType === 'tiered_discount') return true
  if (
    (benefitType === 'product_discount' || benefitType === 'cart_discount' || benefitType === 'buy_x_get_y') &&
    config.discountType === 'fixed'
  ) {
    return true
  }
  return false
}

export const promotionCurrencyGuardSchema = z
  .object({
    eligibleCurrencies: z.array(z.string()),
    rules: z.array(z.object({ ruleType: z.string() })),
    benefits: z.array(
      z.object({ benefitType: z.string(), config: z.object({ discountType: z.string().optional() }).passthrough() }),
    ),
  })
  .superRefine((value, ctx) => {
    const requiresSingleCurrency =
      value.rules.some((rule) => (CURRENCY_SENSITIVE_RULE_TYPES as readonly string[]).includes(rule.ruleType)) ||
      value.benefits.some((benefit) => benefitRequiresSingleEligibleCurrency(benefit.benefitType, benefit.config))

    if (requiresSingleCurrency && value.eligibleCurrencies.length !== 1) {
      ctx.addIssue({
        code: 'custom',
        message:
          'A promotion containing a fixed-amount benefit, a tiered_discount benefit, or an order_value/row_total rule must set exactly one eligible currency (D-R4-27)',
        path: ['eligibleCurrencies'],
      })
    }
  })

export type PromotionCurrencyGuardInput = z.infer<typeof promotionCurrencyGuardSchema>

export function assertPromotionCurrencyRequirements(input: PromotionCurrencyGuardInput): void {
  promotionCurrencyGuardSchema.parse(input)
}

// ---------------------------------------------------------------------------
// RuleGroup tree node (used by `commands/rule-tree.ts`, Step 1.3+)
// ---------------------------------------------------------------------------

export const ruleGroupOperatorValues = ['and', 'or'] as const
export const ruleGroupOperatorSchema = z.enum(ruleGroupOperatorValues)

export type RuleGroupTreeNodeInput = {
  id?: string
  operator: (typeof ruleGroupOperatorValues)[number]
  sortOrder: number
  rules: RuleInput[]
  benefits: BenefitInput[]
  children: RuleGroupTreeNodeInput[]
}

export const ruleGroupTreeNodeSchema: z.ZodType<RuleGroupTreeNodeInput> = z.lazy(() =>
  z.object({
    id: uuid().optional(),
    operator: ruleGroupOperatorSchema,
    sortOrder: z.number().int().min(0).optional().default(0),
    rules: z.array(ruleInputSchema).optional().default([]),
    benefits: z.array(benefitInputSchema).optional().default([]),
    children: z.array(ruleGroupTreeNodeSchema).optional().default([]),
  }),
)

// `PUT /api/promotions/[id]/tree` body (§API Contracts): the full tree plus the
// promotion's `updatedAt` for the optimistic-lock check on this separate tree-replace
// surface (distinct from the row-level header `CrudForm` sends for plain metadata PUTs).
export const promotionTreeUpdateSchema = z.object({
  updatedAt: z.coerce.date(),
  root: ruleGroupTreeNodeSchema,
})

export type PromotionTreeUpdateInput = z.infer<typeof promotionTreeUpdateSchema>

// `PATCH /api/promotions/order` body: each item carries its own `updatedAt`; a stale
// value 409s that item only, not the whole batch (§API Contracts).
export const promotionOrderBatchSchema = z.object({
  items: z
    .array(
      z.object({
        id: uuid(),
        order: z.number().int(),
        updatedAt: z.coerce.date(),
      }),
    )
    .min(1),
})

export type PromotionOrderBatchInput = z.infer<typeof promotionOrderBatchSchema>

// ---------------------------------------------------------------------------
// Promotion
// ---------------------------------------------------------------------------

const promotionBaseShape = {
  name: z.string().trim().min(1).max(200),
  description: clearableStringSchema(4000),
  order: z.number().int(),
  active: z.boolean().optional().default(false),
  startsAt: clearableDateSchema,
  endsAt: clearableDateSchema,
  cumulative: z.boolean().optional().default(true),
  tags: z.array(z.string().trim().min(1).max(60)).optional().default([]),
  excludedTags: z.array(z.string().trim().min(1).max(60)).optional().default([]),
  excludeFlags: z.record(z.string(), z.boolean()).optional().default({}),
  // Empty array = all currencies (§Data Models).
  eligibleCurrencies: z.array(currencyCodeSchema).optional().default([]),
  maxBudget: clearableDecimalStringSchema,
  budgetCurrency: clearableCurrencyCodeSchema,
}

const promotionBudgetAndWindowRefine = (
  value: { maxBudget?: string | null; budgetCurrency?: string | null; startsAt?: Date | null; endsAt?: Date | null },
  ctx: z.RefinementCtx,
) => {
  if (value.maxBudget != null && !value.budgetCurrency) {
    ctx.addIssue({
      code: 'custom',
      message: 'budgetCurrency is required when maxBudget is set',
      path: ['budgetCurrency'],
    })
  }
  if (value.startsAt && value.endsAt && value.startsAt.getTime() > value.endsAt.getTime()) {
    ctx.addIssue({
      code: 'custom',
      message: 'startsAt must be before or equal to endsAt',
      path: ['endsAt'],
    })
  }
}

export const promotionCreateSchema = z.object(promotionBaseShape).superRefine(promotionBudgetAndWindowRefine)

export type PromotionCreateInput = z.infer<typeof promotionCreateSchema>

export const promotionUpdateSchema = z
  .object({ id: uuid() })
  .merge(z.object(promotionBaseShape).partial())
  .superRefine(promotionBudgetAndWindowRefine)

export type PromotionUpdateInput = z.infer<typeof promotionUpdateSchema>

export const promotionDeleteSchema = z.object({
  id: uuid(),
})

export type PromotionDeleteInput = z.infer<typeof promotionDeleteSchema>

// ---------------------------------------------------------------------------
// Code / GeneratedCode
// ---------------------------------------------------------------------------

export const promotionCodeTypeValues = ['static', 'dynamic'] as const
export const promotionCodeTypeSchema = z.enum(promotionCodeTypeValues)

export const promotionCodeUsageModeValues = ['single', 'multiple', 'unlimited'] as const
export const promotionCodeUsageModeSchema = z.enum(promotionCodeUsageModeValues)

const codeBaseShape = {
  name: z.string().trim().min(1).max(200),
  type: promotionCodeTypeSchema,
  code: clearableStringSchema(100),
  prefix: clearableStringSchema(20),
  suffix: clearableStringSchema(20),
  length: z.number().int().positive().max(64).nullable().optional(),
  amount: z.number().int().positive().nullable().optional(),
  usage: promotionCodeUsageModeSchema,
  usageAmount: z.number().int().positive().nullable().optional(),
  usagePerCustomer: z.number().int().positive().nullable().optional(),
  active: z.boolean().optional().default(true),
}

const codeShapeRefine = (
  value: {
    type: (typeof promotionCodeTypeValues)[number]
    code?: string | null
    amount?: number | null
    usage: (typeof promotionCodeUsageModeValues)[number]
    usageAmount?: number | null
  },
  ctx: z.RefinementCtx,
) => {
  if (value.type === 'static' && !value.code) {
    ctx.addIssue({ code: 'custom', message: 'code is required for a static code', path: ['code'] })
  }
  if (value.type === 'dynamic' && !value.amount) {
    ctx.addIssue({ code: 'custom', message: 'amount is required for a dynamic code pool', path: ['amount'] })
  }
  if (value.usage === 'multiple' && value.usageAmount == null) {
    ctx.addIssue({
      code: 'custom',
      message: 'usageAmount is required when usage is "multiple"',
      path: ['usageAmount'],
    })
  }
}

export const promotionCodeCreateSchema = z.object(codeBaseShape).superRefine(codeShapeRefine)

export type PromotionCodeCreateInput = z.infer<typeof promotionCodeCreateSchema>

export const promotionCodeUpdateSchema = z
  .object({ id: uuid() })
  .merge(z.object(codeBaseShape).partial())
  .superRefine((value, ctx) => {
    if (value.type && value.usage) codeShapeRefine(value as any, ctx)
  })

export type PromotionCodeUpdateInput = z.infer<typeof promotionCodeUpdateSchema>

export const promotionCodeDeleteSchema = z.object({
  id: uuid(),
})

export type PromotionCodeDeleteInput = z.infer<typeof promotionCodeDeleteSchema>

export const generatedCodeCreateSchema = z.object({
  codeId: uuid(),
  code: z.string().trim().min(1).max(100),
  active: z.boolean().optional().default(true),
})

export type GeneratedCodeCreateInput = z.infer<typeof generatedCodeCreateSchema>

// ---------------------------------------------------------------------------
// CodeReservation / CodeUsage
// ---------------------------------------------------------------------------

// §Data Models rev C4/C7/D-R4-8: a reservation is keyed by `(codeId, cartId)`, never
// `(codeId, customerId)` — `customerId` stays a separate, nullable identity field.
export const codeReservationCreateSchema = z.object({
  codeId: uuid(),
  codeString: z.string().trim().min(1).max(100),
  cartId: uuid(),
  customerId: clearableStringSchema(200),
})

export type CodeReservationCreateInput = z.infer<typeof codeReservationCreateSchema>

export const codeReservationReleaseSchema = z.object({
  codeId: uuid(),
  cartId: uuid(),
})

export type CodeReservationReleaseInput = z.infer<typeof codeReservationReleaseSchema>

export const codeUsageCreateSchema = z.object({
  codeId: uuid(),
  customerId: clearableStringSchema(200),
})

export type CodeUsageCreateInput = z.infer<typeof codeUsageCreateSchema>

// ---------------------------------------------------------------------------
// PromotionUsage
// ---------------------------------------------------------------------------

export const promotionUsageOrderTypeValues = ['order', 'quote', 'pos_cart'] as const
export const promotionUsageOrderTypeSchema = z.enum(promotionUsageOrderTypeValues)

export const promotionUsageRegisterSchema = z.object({
  promotionId: uuid(),
  orderId: z.string().trim().min(1).max(200),
  orderType: promotionUsageOrderTypeSchema,
  customerId: clearableStringSchema(200),
  currency: currencyCodeSchema,
  totalDiscountAmount: decimalStringSchema,
  effectsSnapshot: z.unknown(),
})

export type PromotionUsageRegisterInput = z.infer<typeof promotionUsageRegisterSchema>

export const promotionUsageRevertSchema = z.object({
  orderId: z.string().trim().min(1).max(200),
})

export type PromotionUsageRevertInput = z.infer<typeof promotionUsageRevertSchema>
