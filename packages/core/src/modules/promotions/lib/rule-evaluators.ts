import type { EnrichedEvaluateItem, EvaluationContext, NormalizedRule, NormalizedRuleGroup } from './types'

// Real Step 2.2 implementation — per-rule-type evaluators plus AND/OR group composition
// (SPEC-055 §Evaluation Engine Data Flow Pass 1, §Normalized Promotion Shape,
// §Data Models "Rule" table). Pure: no DB access, no system-clock reads — every
// time-sensitive check compares against `context.evaluatedAt`.

type ComparisonOperator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte'

// Non-authoritative numeric comparison — confirms the judgment call already flagged in
// `data/validators.ts` (no operator semantics are defined anywhere in SPEC-055 for these
// rule configs). Matches the precedent in `lib/evaluation-engine.ts`'s budget pre-check
// (`Number(a) >= Number(b)`): plain `Number()` comparison, no decimal/bignum library.
function compareNumbers(actual: number, operator: ComparisonOperator, threshold: number): boolean {
  switch (operator) {
    case 'eq':
      return actual === threshold
    case 'neq':
      return actual !== threshold
    case 'gt':
      return actual > threshold
    case 'gte':
      return actual >= threshold
    case 'lt':
      return actual < threshold
    case 'lte':
      return actual <= threshold
    default:
      return false
  }
}

function compareDates(actualMs: number, operator: ComparisonOperator, thresholdMs: number): boolean {
  return compareNumbers(actualMs, operator, thresholdMs)
}

function compareStrings(actual: string, operator: ComparisonOperator, threshold: string): boolean {
  if (operator === 'eq') return actual === threshold
  if (operator === 'neq') return actual !== threshold
  const actualNum = Number(actual)
  const thresholdNum = Number(threshold)
  if (Number.isNaN(actualNum) || Number.isNaN(thresholdNum)) return false
  return compareNumbers(actualNum, operator, thresholdNum)
}

function isComparisonOperator(value: unknown): value is ComparisonOperator {
  return value === 'eq' || value === 'neq' || value === 'gt' || value === 'gte' || value === 'lt' || value === 'lte'
}

// The exclude_promotional_prices filter (D-R4-16) — only ever applied to the three
// price-/priced-item aggregates (order_value, row_total, product_count), never to pure
// quantity-counting or membership rules (product, category, cart_weight,
// customer_order_history, customer_group, code, order_date). Shared helper so the three
// callers don't each duplicate the filter inline.
function applicableItems(context: EvaluationContext): EnrichedEvaluateItem[] {
  if (context.excludeFlags.exclude_promotional_prices !== true) return context.items
  return context.items.filter((item) => !item.priceIsPromotional)
}

function evaluateOrderValue(config: Record<string, unknown>, context: EvaluationContext): boolean {
  const operator = config.operator
  if (!isComparisonOperator(operator)) return false
  const value = Number(config.value)
  const taxInclusive = config.taxInclusive === true
  // `limitToCategory` is typed as a free-form string in the validator (Step 1.2 never
  // resolved the apparent naming/typing mismatch against `categoryId`-style fields used
  // elsewhere) — this evaluator's own judgment call: treat it as a category id and apply
  // the same membership check `category`/`row_total` use against `categoryIds`.
  const limitToCategory = typeof config.limitToCategory === 'string' ? config.limitToCategory : null

  let total = 0
  for (const item of applicableItems(context)) {
    if (limitToCategory !== null && !item.categoryIds.includes(limitToCategory)) continue
    const unitPrice = taxInclusive ? Number(item.unitPriceGross) : Number(item.unitPriceNet)
    total += Number(item.quantity) * unitPrice
  }

  return compareNumbers(total, operator, value)
}

function evaluateOrderDate(config: Record<string, unknown>, context: EvaluationContext): boolean {
  const operator = config.operator
  if (!isComparisonOperator(operator)) return false
  if (typeof config.date !== 'string') return false

  const actualMs = new Date(context.evaluatedAt).getTime()
  const thresholdMs = new Date(config.date).getTime()
  return compareDates(actualMs, operator, thresholdMs)
}

function evaluateProductCount(config: Record<string, unknown>, context: EvaluationContext): boolean {
  const operator = config.operator
  if (!isComparisonOperator(operator)) return false
  const value = Number(config.value)

  let total = 0
  for (const item of applicableItems(context)) {
    total += Number(item.quantity)
  }

  return compareNumbers(total, operator, value)
}

function evaluateCartWeight(config: Record<string, unknown>, context: EvaluationContext): boolean {
  const operator = config.operator
  if (!isComparisonOperator(operator)) return false
  if (context.cartWeight === null) return false

  const value = Number(config.value)
  const actual = Number(context.cartWeight)
  return compareNumbers(actual, operator, value)
}

function evaluateRowTotal(config: Record<string, unknown>, context: EvaluationContext): boolean {
  const operator = config.operator
  if (!isComparisonOperator(operator)) return false
  const value = Number(config.value)
  const productId = typeof config.productId === 'string' ? config.productId : null
  const categoryId = typeof config.categoryId === 'string' ? config.categoryId : null

  let total = 0
  for (const item of applicableItems(context)) {
    if (productId !== null && item.productId !== productId) continue
    if (categoryId !== null && !item.categoryIds.includes(categoryId)) continue
    // No `taxInclusive` field exists on this config (unlike `order_value`) — this
    // evaluator's own judgment call: use net, matching the shared culture of calling out
    // an unresolved choice (`data/validators.ts`'s comment style) rather than silently
    // picking one.
    total += Number(item.quantity) * Number(item.unitPriceNet)
  }

  return compareNumbers(total, operator, value)
}

function evaluateProduct(config: Record<string, unknown>, context: EvaluationContext): boolean {
  const operator = config.operator
  if (!isComparisonOperator(operator)) return false
  if (typeof config.productId !== 'string') return false
  const productId = config.productId
  const variantId = typeof config.variantId === 'string' ? config.variantId : null
  const quantity = Number(config.quantity)

  let total = 0
  for (const item of context.items) {
    if (item.productId !== productId) continue
    if (variantId !== null && item.variantId !== variantId) continue
    total += Number(item.quantity)
  }

  return compareNumbers(total, operator, quantity)
}

function evaluateCategory(config: Record<string, unknown>, context: EvaluationContext): boolean {
  const operator = config.operator
  if (!isComparisonOperator(operator)) return false
  if (typeof config.categoryId !== 'string') return false
  const categoryId = config.categoryId
  const quantity = Number(config.quantity)

  let total = 0
  for (const item of context.items) {
    if (!item.categoryIds.includes(categoryId)) continue
    total += Number(item.quantity)
  }

  return compareNumbers(total, operator, quantity)
}

function evaluateProductAttribute(config: Record<string, unknown>, context: EvaluationContext): boolean {
  const operator = config.operator
  if (!isComparisonOperator(operator)) return false
  if (typeof config.attributeCode !== 'string' || typeof config.value !== 'string') return false
  const attributeCode = config.attributeCode
  const value = config.value

  return context.items.some((item) => {
    const actual = item.attributes[attributeCode]
    if (actual === undefined) return false
    return compareStrings(actual, operator, value)
  })
}

function evaluateCustomerGroup(config: Record<string, unknown>, context: EvaluationContext): boolean {
  if (typeof config.customerGroupId !== 'string') return false
  return context.buyer.customerGroupIds.includes(config.customerGroupId)
}

function evaluateCustomerOrderHistory(config: Record<string, unknown>, context: EvaluationContext): boolean {
  const operator = config.operator
  if (!isComparisonOperator(operator)) return false
  if (context.customerOrderCount === null) return false

  const value = Number(config.value)
  return compareNumbers(context.customerOrderCount, operator, value)
}

function evaluateCode(config: Record<string, unknown>, context: EvaluationContext): boolean {
  if (typeof config.codeId !== 'string') return false
  const codeId = config.codeId
  return context.codes.some((code) => code.id === codeId)
}

// Dispatcher over the Release 4 shipped set (`RELEASE_4_SHIPPED_RULE_TYPES` in
// `data/validators.ts`). An unrecognized type (one of the six hidden types, or anything
// else) fails closed to `false` rather than throwing — per D-R4-14, hidden types have no
// data source and should never appear in a real rule tree, but the write-path validators
// are the enforcement point, not this evaluator.
function evaluateRule(rule: NormalizedRule, context: EvaluationContext): boolean {
  switch (rule.type) {
    case 'order_value':
      return evaluateOrderValue(rule.config, context)
    case 'order_date':
      return evaluateOrderDate(rule.config, context)
    case 'product_count':
      return evaluateProductCount(rule.config, context)
    case 'cart_weight':
      return evaluateCartWeight(rule.config, context)
    case 'row_total':
      return evaluateRowTotal(rule.config, context)
    case 'product':
      return evaluateProduct(rule.config, context)
    case 'category':
      return evaluateCategory(rule.config, context)
    case 'product_attribute':
      return evaluateProductAttribute(rule.config, context)
    case 'customer_group':
      return evaluateCustomerGroup(rule.config, context)
    case 'customer_order_history':
      return evaluateCustomerOrderHistory(rule.config, context)
    case 'code':
      return evaluateCode(rule.config, context)
    default:
      return false
  }
}

// Group composition (Pass 1): evaluate every rule and every child group to a boolean,
// then combine ALL of those booleans together (rules and children are not combined
// separately) using `group.operator`. Standard vacuous-truth convention for an empty
// combined list: `true` under `and`, `false` under `or`.
export function evaluateGroup(group: NormalizedRuleGroup, context: EvaluationContext): boolean {
  const results: boolean[] = []
  for (const rule of group.rules) {
    results.push(evaluateRule(rule, context))
  }
  for (const child of group.children) {
    results.push(evaluateGroup(child, context))
  }

  if (group.operator === 'and') {
    return results.every((result) => result)
  }
  return results.some((result) => result)
}
