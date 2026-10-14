import type { EntityManager } from '@mikro-orm/postgresql'
import { computeProductScopeKeys, PRODUCT_SCOPE_CATEGORY_PREFIX } from '@open-mercato/core/modules/catalog/lib/productScopeKeys'
import { Currency } from '@open-mercato/core/modules/currencies/data/entities'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { evaluatePromotions } from './evaluation-engine'
import type { PromotionCacheService } from '../services/promotion-cache'
import type {
  BuyerContext,
  CodeReservationResult,
  CodeUseResult,
  CodeValidationResult,
  EnrichedEvaluateItem,
  EvaluateInput,
  EvaluateItem,
  EvaluateResult,
  EvaluationInput,
  PromotionsService,
  RegisterUsageInput,
  ReserveCodeInput,
  RevertUsageInput,
  UseCodeInput,
} from './types'

// SPEC-055 §Implementation Plan Phase 2 step 6 / §Amendment A.2 — the DI facade named
// `promotionsService`. Scope for Step 2.6 is `evaluate`/`evaluateForProduct` only; every
// other `PromotionsService` method belongs to Phase 3 (codes) or its own usage-service
// step and is a one-line throwing placeholder here, same convention as Step 2.1's
// `evaluateGroup`/`resolveEffects` stubs in `rule-evaluators.ts`/`effect-resolvers.ts`.

export type PromotionsServiceContainer = {
  resolve: <T = unknown>(name: string) => T
}

// Minimal shape this file actually reads off whatever is registered under the `auth` DI
// token. NOT an existing contract: see the long comment on `resolvePromotionsServiceScope`
// below for why this is a documented gap, not a precedent this file is following.
type PromotionsServiceAuthContext = {
  tenantId?: string | null
  orgId?: string | null
} | null | undefined

type PromotionsServiceScope = { tenantId: string; organizationId: string }

// `EvaluateInput`/`evaluateForProduct`'s input (§Public TypeScript Contract) are frozen
// with NO tenant/organization parameter — by design, D-R4-11/C3: "no organizationId/
// tenantId in any request body ... organizationId/tenantId come from auth." Every OTHER
// place in this module that needs the caller's scope receives it explicitly: HTTP routes
// build a `CommandRuntimeContext` with `auth`/`selectedOrganizationId` straight from
// `getAuthFromRequest(req)` (see `api/order/route.ts`'s `resolveRouteContext`), and
// commands read `ctx.auth?.tenantId` / `ctx.selectedOrganizationId ?? ctx.auth?.orgId`
// (see `commands/promotions.ts`'s `resolveActorScope`) — never from the DI container.
//
// Investigated and NOT found: `createRequestContainer()` (`packages/shared/src/lib/di/
// container.ts`) never registers an `auth` token, and no module in this codebase
// registers one either — every grep for a DI-registered (not per-request-handler)
// service that resolves the current request's auth/tenant scope from the container
// alone, with no explicit parameter, came back empty. `PromotionCacheService` (the
// established sibling in this same module) sidesteps the question entirely: its public
// methods take `tenantId`/`organizationId` as explicit arguments, exactly because there
// is nothing to resolve implicitly.
//
// `evaluate`/`evaluateForProduct`'s signatures are frozen and take no second parameter,
// so resolving scope from the container is the only option left that does not violate
// the contract freeze. This resolves `auth` off the container (the shape the Amendment's
// "DI service, not HTTP" framing implies a future `cart` caller will register before
// resolving `promotionsService`) and fails closed with a clear 400 when it is absent —
// but it is new, not an existing pattern: a hard, in-process caller (eventually `cart`)
// MUST `container.register({ auth: asValue(auth) })` on its own per-request container
// before calling `promotionsService.evaluate()`, the same way it already carries `em`.
function resolvePromotionsServiceScope(container: PromotionsServiceContainer): PromotionsServiceScope {
  let auth: PromotionsServiceAuthContext = null
  try {
    auth = container.resolve<PromotionsServiceAuthContext>('auth')
  } catch {
    auth = null
  }
  const tenantId = auth?.tenantId ?? null
  const organizationId = auth?.orgId ?? null
  if (!tenantId || !organizationId) {
    throw new CrudHttpError(400, {
      error: '[internal] Tenant and organization scope are required to evaluate promotions',
    })
  }
  return { tenantId, organizationId }
}

function resolvePromotionsEm(container: PromotionsServiceContainer): EntityManager {
  // Same fork-on-resolve precedent as `services/promotion-cache.ts`'s
  // `resolvePromotionEm` / `commands/promotions.ts`'s command handlers.
  return container.resolve<EntityManager>('em').fork()
}

// D-R4-21/C11 batch category resolution — reuses `catalog`'s own `computeProductScopeKeys`
// exactly (the same function catalog's search-index enricher uses for "category
// membership including ancestors"), then narrows its combined `cat:<id>`/`tag:<id>` key
// set down to the plain, ancestor-expanded category id array `EnrichedEvaluateItem`
// expects (`rule-evaluators.ts` checks `item.categoryIds.includes(categoryId)` against
// bare ids, never prefixed keys).
async function resolveCategoryIdsForProducts(
  container: PromotionsServiceContainer,
  productIds: readonly string[],
  scope: PromotionsServiceScope,
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>()
  if (productIds.length === 0) return result
  const em = resolvePromotionsEm(container)
  const db = em.getKysely<any>()
  const scopeKeys = await computeProductScopeKeys(db, productIds, scope)
  for (const [productId, keys] of scopeKeys) {
    const categoryIds = keys
      .filter((key) => key.startsWith(PRODUCT_SCOPE_CATEGORY_PREFIX))
      .map((key) => key.slice(PRODUCT_SCOPE_CATEGORY_PREFIX.length))
    result.set(productId, categoryIds)
  }
  return result
}

// Investigated and NOT found: a batch "attribute code -> value" read path for
// `catalog:catalog_product`. `catalog/ce.ts` ships zero built-in custom fields for that
// entity (`fields: []`) — attributes are purely per-tenant, dynamically defined custom
// fields with no "attribute code" concept distinct from any other custom field, so there
// is no stable registry this file could batch-read against without speculating about a
// shape nothing in the codebase defines yet. Falls back to `{}` per D-R4-21's own rule:
// "a field with no resolvable source for a given product is [...] an empty [...] object,
// never undefined" (`lib/types.ts`'s `EnrichedEvaluateItem` comment).
function resolveAttributesForProduct(_productId: string): Record<string, string> {
  return {}
}

function buildEnrichedItems(
  items: EvaluateItem[],
  categoryIdsByProduct: Map<string, string[]>,
): EnrichedEvaluateItem[] {
  return items.map((item) => ({
    ...item,
    categoryIds: categoryIdsByProduct.get(item.productId) ?? [],
    attributes: resolveAttributesForProduct(item.productId),
  }))
}

async function enrichEvaluateItems(
  container: PromotionsServiceContainer,
  items: EvaluateItem[],
  scope: PromotionsServiceScope,
): Promise<EnrichedEvaluateItem[]> {
  const productIds = Array.from(new Set(items.map((item) => item.productId)))
  const categoryIdsByProduct = await resolveCategoryIdsForProducts(container, productIds, scope)
  return buildEnrichedItems(items, categoryIdsByProduct)
}

// D-R4-10 / Step 2.3b's own deferred TODO, closed here: `lib/effect-resolvers.ts`
// defaults to 2 fraction digits when `EvaluationContext.currencyFractionDigits` is
// absent, documenting that a later step (this one) resolves the real value from
// `currencies.Currency.decimalPlaces`. Best-effort: a lookup failure (currency not
// found, DB error) silently keeps the pre-existing default-2 behavior rather than
// failing the whole evaluation over a rounding-precision lookup.
async function resolveCurrencyFractionDigits(
  container: PromotionsServiceContainer,
  currency: string,
  scope: PromotionsServiceScope,
): Promise<number | undefined> {
  if (!currency) return undefined
  try {
    const em = resolvePromotionsEm(container)
    const row = await em.findOne(Currency, {
      code: currency,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    })
    return row?.decimalPlaces ?? undefined
  } catch {
    return undefined
  }
}

function buildEvaluateForProductItem(input: {
  productId: string
  variantId: string | null
  categoryIds: string[]
}): EnrichedEvaluateItem {
  return {
    lineId: 'evaluate-for-product',
    productId: input.productId,
    variantId: input.variantId,
    quantity: '1',
    // No real price data is available for a single-product badge check — this call
    // shape only needs rule matching, never discount computation, so these are inert.
    unitPriceNet: '0',
    unitPriceGross: '0',
    priceIsPromotional: false,
    categoryIds: input.categoryIds,
    attributes: resolveAttributesForProduct(input.productId),
  }
}

export class PromotionsServiceImpl implements PromotionsService {
  constructor(private readonly container: PromotionsServiceContainer) {}

  async evaluate(input: EvaluateInput): Promise<EvaluateResult> {
    const scope = resolvePromotionsServiceScope(this.container)
    const promotionCacheService = this.container.resolve<PromotionCacheService>('promotionCacheService')
    const promotions = await promotionCacheService.getActivePromotions(scope.tenantId, scope.organizationId)

    const items = await enrichEvaluateItems(this.container, input.items, scope)
    const currencyFractionDigits = await resolveCurrencyFractionDigits(this.container, input.currency, scope)

    // `input.buyer` is already a fully-formed `BuyerContext` by the time it reaches this
    // facade (§Public TypeScript Contract: `EvaluateInput.buyer: BuyerContext`) — D-R4-28
    // cites D3/D3a (person-wins union identity) only to explain WHY the caller's
    // `BuyerContext` is shaped the way it is, not as work this method performs. The
    // caller (eventually `cart`, reading fresh from the DB per D3) resolves identity;
    // this facade passes it straight through into the pure engine's `EvaluationInput`.
    const evaluationInput: EvaluationInput = {
      items,
      currency: input.currency,
      evaluatedAt: input.evaluatedAt,
      buyer: input.buyer,
      customerOrderCount: input.customerOrderCount,
      cartWeight: input.cartWeight,
      codes: input.codes,
      ...(currencyFractionDigits !== undefined ? { currencyFractionDigits } : {}),
    }

    return evaluatePromotions(promotions, evaluationInput)
  }

  async evaluateForProduct(input: {
    productId: string
    variantId: string | null
    buyer: BuyerContext
    evaluatedAt: string
  }): Promise<{ badges: Array<{ promotionId: string; promotionName: string; label: Record<string, string> }> }> {
    const scope = resolvePromotionsServiceScope(this.container)
    const promotionCacheService = this.container.resolve<PromotionCacheService>('promotionCacheService')
    const promotions = await promotionCacheService.getActivePromotions(scope.tenantId, scope.organizationId)

    const categoryIdsByProduct = await resolveCategoryIdsForProducts(this.container, [input.productId], scope)
    const item = buildEvaluateForProductItem({
      productId: input.productId,
      variantId: input.variantId,
      categoryIds: categoryIdsByProduct.get(input.productId) ?? [],
    })

    // Deliberately no real `currency` — a single-product badge check has none to supply
    // and the type signature carries none. The one observable consequence: a promotion
    // that restricts `eligibleCurrencies` never badges here, the same fail-closed
    // behavior `isPromotionEligible` already applies to a currency it does not
    // recognize. `customerOrderCount`/`cartWeight` are `null` for the same reason —
    // there is no real cart behind this call, so any rule reading them evaluates false
    // rather than guessing a cart that does not exist.
    const evaluationInput: EvaluationInput = {
      items: [item],
      currency: '',
      evaluatedAt: input.evaluatedAt,
      buyer: input.buyer,
      customerOrderCount: null,
      cartWeight: null,
      codes: [],
    }

    const result = evaluatePromotions(promotions, evaluationInput)
    return {
      badges: result.appliedPromotions.map((applied) => ({
        promotionId: applied.promotionId,
        promotionName: applied.promotionName,
        // A promotion may resolve several effects (e.g. a capped benefit covering
        // several lines); a single-product badge shows one label, so the first
        // resolved effect's label wins — documented judgment call, not a spec rule.
        label: applied.effects[0]?.label ?? {},
      })),
    }
  }

  async reserveCode(_input: ReserveCodeInput): Promise<CodeReservationResult> {
    throw new Error('[internal] reserveCode not implemented until Phase 3')
  }

  async extendReservation(_codeId: string, _cartId: string): Promise<void> {
    throw new Error('[internal] extendReservation not implemented until Phase 3')
  }

  async validateCode(_input: ReserveCodeInput): Promise<CodeValidationResult> {
    throw new Error('[internal] validateCode not implemented until Phase 3')
  }

  async useCode(_input: UseCodeInput): Promise<CodeUseResult> {
    throw new Error('[internal] useCode not implemented until Phase 3')
  }

  async releaseCode(_codeId: string, _cartId: string): Promise<void> {
    throw new Error('[internal] releaseCode not implemented until Phase 3')
  }

  async registerUsage(_input: RegisterUsageInput): Promise<{ ok: true; budgetExceeded: string[] }> {
    throw new Error('[internal] registerUsage not implemented until Phase 3')
  }

  async revertUsage(_input: RevertUsageInput): Promise<{ ok: true; revertedCount: number }> {
    throw new Error('[internal] revertUsage not implemented until Phase 3')
  }
}
