// Declarative per-type field layouts for rule and benefit cards (Step 1.7). One
// generic field renderer (`RuleFieldInput` in `RuleCard.tsx`/`BenefitCard.tsx`) reads
// these specs instead of hand-writing eight/five near-identical JSX blocks — the field
// `key`/`kind` pairs match `data/validators.ts`'s per-type config schemas field-for-field
// (Step 1.2) so every value this UI writes parses on save.

import type { BenefitTypeId, RuleTypeId } from './ruleTreeTypes'

export type FieldKind = 'text' | 'number' | 'decimal' | 'checkbox' | 'operator' | 'discountType' | 'date'

export type FieldSpec = {
  key: string
  kind: FieldKind
  labelKey: string
  labelFallback: string
  hintKey?: string
  hintFallback?: string
  nullable?: boolean
}

const value: FieldSpec = { key: 'value', kind: 'decimal', labelKey: 'promotions.fields.value', labelFallback: 'Value' }
const integerValue: FieldSpec = { key: 'value', kind: 'number', labelKey: 'promotions.fields.value', labelFallback: 'Value' }
const operator: FieldSpec = { key: 'operator', kind: 'operator', labelKey: 'promotions.fields.operator', labelFallback: 'Operator' }

export const RULE_FIELD_SPECS: Record<RuleTypeId, FieldSpec[]> = {
  order_value: [
    value,
    operator,
    { key: 'taxInclusive', kind: 'checkbox', labelKey: 'promotions.fields.taxInclusive', labelFallback: 'Tax inclusive' },
    {
      key: 'limitToCategory',
      kind: 'text',
      labelKey: 'promotions.fields.limitToCategory',
      labelFallback: 'Limit to category',
      nullable: true,
    },
  ],
  order_date: [
    { key: 'date', kind: 'date', labelKey: 'promotions.fields.date', labelFallback: 'Date' },
    operator,
  ],
  product_count: [integerValue, operator],
  row_total: [
    {
      key: 'value',
      kind: 'decimal',
      labelKey: 'promotions.fields.rowTotalValue',
      labelFallback: 'Value (net)',
      hintKey: 'promotions.fields.netAmountHint',
      hintFallback: 'Compared with the net amount, before tax.',
    },
    operator,
    { key: 'productId', kind: 'text', labelKey: 'promotions.fields.productId', labelFallback: 'Product ID', nullable: true },
    { key: 'categoryId', kind: 'text', labelKey: 'promotions.fields.categoryId', labelFallback: 'Category ID', nullable: true },
  ],
  product: [
    { key: 'productId', kind: 'text', labelKey: 'promotions.fields.productId', labelFallback: 'Product ID' },
    { key: 'variantId', kind: 'text', labelKey: 'promotions.fields.variantId', labelFallback: 'Variant ID', nullable: true },
    { key: 'quantity', kind: 'number', labelKey: 'promotions.fields.quantity', labelFallback: 'Quantity' },
    operator,
  ],
  category: [
    { key: 'categoryId', kind: 'text', labelKey: 'promotions.fields.categoryId', labelFallback: 'Category ID' },
    { key: 'quantity', kind: 'number', labelKey: 'promotions.fields.quantity', labelFallback: 'Quantity' },
    operator,
  ],
  customer_group: [
    {
      key: 'customerGroupId',
      kind: 'text',
      labelKey: 'promotions.fields.customerGroupId',
      labelFallback: 'Customer group ID',
    },
  ],
  code: [{ key: 'codeId', kind: 'text', labelKey: 'promotions.fields.codeId', labelFallback: 'Promotion code ID' }],
  delivery_method: [
    {
      key: 'deliveryMethodCode',
      kind: 'text',
      labelKey: 'promotions.fields.deliveryMethodCode',
      labelFallback: 'Delivery method code',
    },
  ],
}

const discountType: FieldSpec = {
  key: 'discountType',
  kind: 'discountType',
  labelKey: 'promotions.fields.discountType',
  labelFallback: 'Discount type',
}
const benefitValue: FieldSpec = { key: 'value', kind: 'decimal', labelKey: 'promotions.fields.value', labelFallback: 'Value' }
const maxDiscount: FieldSpec = {
  key: 'maxDiscount',
  kind: 'decimal',
  labelKey: 'promotions.fields.maxDiscount',
  labelFallback: 'Max discount',
  nullable: true,
}

// Quantity-cap fields are deliberately excluded from every list below — the "Applies to
// / Limits / Which pieces" segmented control that edits them is Step 1.8's job (SPEC-055
// §UI/UX rev note).
export const BENEFIT_FIELD_SPECS: Record<BenefitTypeId, FieldSpec[]> = {
  product_discount: [
    { key: 'productId', kind: 'text', labelKey: 'promotions.fields.productId', labelFallback: 'Product ID', nullable: true },
    discountType,
    benefitValue,
    {
      key: 'limitToCategoryId',
      kind: 'text',
      labelKey: 'promotions.fields.limitToCategoryId',
      labelFallback: 'Limit to category ID',
      nullable: true,
    },
    maxDiscount,
  ],
  cart_discount: [discountType, benefitValue, maxDiscount],
  free_product: [
    { key: 'productId', kind: 'text', labelKey: 'promotions.fields.productId', labelFallback: 'Product ID', nullable: true },
    { key: 'categoryId', kind: 'text', labelKey: 'promotions.fields.categoryId', labelFallback: 'Category ID', nullable: true },
    { key: 'quantity', kind: 'number', labelKey: 'promotions.fields.quantity', labelFallback: 'Quantity' },
  ],
  buy_x_get_y: [
    {
      key: 'triggerProductId',
      kind: 'text',
      labelKey: 'promotions.fields.triggerProductId',
      labelFallback: 'Trigger product ID',
      nullable: true,
    },
    {
      key: 'triggerCategoryId',
      kind: 'text',
      labelKey: 'promotions.fields.triggerCategoryId',
      labelFallback: 'Trigger category ID',
      nullable: true,
    },
    {
      key: 'triggerQuantity',
      kind: 'number',
      labelKey: 'promotions.fields.triggerQuantity',
      labelFallback: 'Trigger quantity',
    },
    { key: 'rewardProductId', kind: 'text', labelKey: 'promotions.fields.rewardProductId', labelFallback: 'Reward product ID' },
    {
      key: 'rewardVariantId',
      kind: 'text',
      labelKey: 'promotions.fields.rewardVariantId',
      labelFallback: 'Reward variant ID',
      nullable: true,
    },
    { key: 'rewardQuantity', kind: 'number', labelKey: 'promotions.fields.rewardQuantity', labelFallback: 'Reward quantity' },
    discountType,
    benefitValue,
    {
      key: 'maxApplications',
      kind: 'number',
      labelKey: 'promotions.fields.maxApplications',
      labelFallback: 'Max applications',
      nullable: true,
    },
    maxDiscount,
  ],
  // `tiered_discount` additionally carries a repeatable `tiers` list, rendered
  // separately in `BenefitCard.tsx` (not expressible as a single flat field spec).
  tiered_discount: [
    {
      key: 'limitToCategoryId',
      kind: 'text',
      labelKey: 'promotions.fields.limitToCategoryId',
      labelFallback: 'Limit to category ID',
      nullable: true,
    },
    maxDiscount,
  ],
  // D-R5-17: un-hidden in Release 5. No `maxDiscount` field — `deliveryDiscountConfigSchema`
  // (`data/validators.ts`) does not carry one; "naturally bounded by delivery cost"
  // (SPEC-055 §Data Models "max_discount"), the same clamp `effect-resolvers.ts`'s
  // `computeDiscountAmount` already applies to every benefit's base amount.
  delivery_discount: [
    {
      key: 'deliveryMethodCode',
      kind: 'text',
      labelKey: 'promotions.fields.deliveryMethodCode',
      labelFallback: 'Delivery method code',
    },
    discountType,
    benefitValue,
  ],
}
