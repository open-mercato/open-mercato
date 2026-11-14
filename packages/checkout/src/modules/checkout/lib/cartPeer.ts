import type { EntityManager } from '@mikro-orm/postgresql'
import { hashCartTokenForLookup } from './sessionToken'

/** The cart's own header name (`cart/lib/currentCartRoute.ts#CART_TOKEN_HEADER`, D-R4-6),
 * reproduced here as a literal — not imported, same "checkout imports nothing from
 * cart/lib" reasoning as this file's other helpers. */
export const CART_TOKEN_HEADER = 'X-Cart-Token'

export function readCartTokenHeader(request: Request): string | null {
  const value = request.headers.get(CART_TOKEN_HEADER)
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

/**
 * Minimal, read-only, scope-free peek at another module's `carts` table by its globally
 * unique `token_hash` (cart's own `@Unique(['tokenHash'])`, `cart/data/entities.ts`) — a
 * raw Kysely select against the table name, never an import of `cart`'s `Cart` entity or
 * any `cart/lib` function (the spec's own "checkout imports nothing from cart/lib" rule,
 * §6). This is the "FK-id + snapshot" coupling `packages/core/AGENTS.md` § Cross-Module
 * Coupling sanctions, the SAME style `ecommerce/lib/storeContextService.ts#
 * lookupStoreTenantId` already uses for its own one-column cross-table read.
 *
 * Only called after the caller's own `tryResolve('cartService')` gate has already
 * confirmed the `cart` module is active (D-R5-18) — so the table is guaranteed to exist.
 *
 * Scope-free by design: a bare cart token is the ONLY credential a guest buyer holds
 * (§9.0), so the lookup has no tenant/organization to filter by until AFTER it resolves —
 * exactly how `cart`'s own token resolves a basket with no a-priori scope either. The
 * returned row's own `tenantId`/`organizationId` become the new session's ground truth.
 */
export type CartPeerDatabase = {
  carts: {
    id: string
    tenant_id: string
    organization_id: string
    store_id: string | null
    channel: string
    kind: string
    status: string
    currency_code: string
    locale: string
    customer_id: string | null
    customer_user_id: string | null
    // Release 5, Step 2.13 (C8/D-R5-17): the buyer-context columns `promotionsService
    // .evaluate()`'s `BuyerContext` needs (`cart/lib/promotionContext.ts`'s own
    // `buyer` builder reads these same two columns off the real `Cart` entity).
    customer_ids: string[] | null
    customer_group_ids: string[] | null
    token_hash: string
  }
}

export type CartPeerRow = {
  id: string
  tenantId: string
  organizationId: string
  storeId: string | null
  channel: string
  kind: string
  status: string
  currencyCode: string
  locale: string
  customerId: string | null
  customerUserId: string | null
  customerIds: string[]
  customerGroupIds: string[]
}

const CART_PEER_SELECT_COLUMNS = [
  'id',
  'tenant_id',
  'organization_id',
  'store_id',
  'channel',
  'kind',
  'status',
  'currency_code',
  'locale',
  'customer_id',
  'customer_user_id',
  'customer_ids',
  'customer_group_ids',
] as const

type CartPeerSelectedRow = Pick<CartPeerDatabase['carts'], (typeof CART_PEER_SELECT_COLUMNS)[number]>

function toCartPeerRow(row: CartPeerSelectedRow): CartPeerRow {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    organizationId: row.organization_id,
    storeId: row.store_id,
    channel: row.channel,
    kind: row.kind,
    status: row.status,
    currencyCode: row.currency_code,
    locale: row.locale,
    customerId: row.customer_id,
    customerUserId: row.customer_user_id,
    customerIds: row.customer_ids ?? [],
    customerGroupIds: row.customer_group_ids ?? [],
  }
}

export async function lookupCartPeerByToken(em: EntityManager, cartToken: string): Promise<CartPeerRow | null> {
  const tokenHash = hashCartTokenForLookup(cartToken)
  const row = await em
    .getKysely<CartPeerDatabase>()
    .selectFrom('carts')
    .select(CART_PEER_SELECT_COLUMNS)
    .where('token_hash', '=', tokenHash)
    .executeTakeFirst()
  if (!row) return null
  return toCartPeerRow(row)
}

/**
 * Same scope-free "FK-id + snapshot" read as `lookupCartPeerByToken`, but by the cart's
 * own id (scoped by tenant/organization — unlike the token lookup, the caller already
 * knows the scope here, from the `CheckoutSession` row). Used by the delivery-rate
 * quoting and delivery-promotion-evaluation paths (§5.3/§5.4) to re-read the cart's
 * buyer context without importing anything from `cart/lib`.
 */
export async function lookupCartPeerById(
  em: EntityManager,
  cartId: string,
  scope: { tenantId: string; organizationId: string },
): Promise<CartPeerRow | null> {
  const row = await em
    .getKysely<CartPeerDatabase>()
    .selectFrom('carts')
    .select(CART_PEER_SELECT_COLUMNS)
    .where('id', '=', cartId)
    .where('tenant_id', '=', scope.tenantId)
    .where('organization_id', '=', scope.organizationId)
    .executeTakeFirst()
  if (!row) return null
  return toCartPeerRow(row)
}

// Release 5, Step 4.1 (checkout §7.2 step 2, flagged by Step 2.13's own NOTIFY entry: "a
// combined code+delivery rule is a gap... flagged for Step 4.1's own submit-time
// re-evaluation to close for real"). `promotionsService.evaluate()`'s own `codes: CodeRef[]`
// input needs the cart's currently-entered codes — `cart`'s own `cart_promotion_applications`
// table (`code_id`/`code_type`, non-null only for an EXPLICITLY entered code; an automatic,
// codeless promotion's application row carries neither) is the same "FK-id + snapshot" read
// `lib/cartLinesPeer.ts`/`lib/cartPeer.ts` already establish for this module — never an
// import of `cart/lib`.
export type CartPromotionApplicationsDatabase = {
  cart_promotion_applications: {
    cart_id: string
    tenant_id: string
    organization_id: string
    promotion_id: string
    code: string | null
    code_id: string | null
    code_type: string | null
    effect: Record<string, unknown> | null
    amount_net: string | null
    amount_gross: string | null
  }
}

export type CartEnteredCodeRef = { id: string; type: 'static' | 'dynamic'; codeString: string | null }

export async function lookupCartEnteredCodes(
  em: EntityManager,
  cartId: string,
  scope: { tenantId: string; organizationId: string },
): Promise<CartEnteredCodeRef[]> {
  const rows = await em
    .getKysely<CartPromotionApplicationsDatabase>()
    .selectFrom('cart_promotion_applications')
    .select(['code_id', 'code_type', 'code'])
    .where('cart_id', '=', cartId)
    .where('tenant_id', '=', scope.tenantId)
    .where('organization_id', '=', scope.organizationId)
    .where('code_id', 'is not', null)
    .execute()

  const byId = new Map<string, CartEnteredCodeRef>()
  for (const row of rows) {
    if (!row.code_id) continue
    const type: 'static' | 'dynamic' = row.code_type === 'dynamic' ? 'dynamic' : 'static'
    byId.set(row.code_id, { id: row.code_id, type, codeString: row.code ?? null })
  }
  return Array.from(byId.values())
}

// Release 5, Step 4.2 (C5, §7.2 step 6c). `registerUsage`'s `appliedPromotions` needs
// every promotion that actually discounted this cart (code-triggered or automatic), each
// with its real `ResolvedEffect[]` — `cart_promotion_applications.effect` already stores
// exactly that jsonb shape verbatim (`cart/lib/promotionContext.ts#` persists
// `entry.effect` — the SAME object `promotionsService.evaluate()` returned), so this reads
// it back rather than reconstructing a synthetic effect. A row synced to "zeroed" (no
// longer active, `effect: {}`, `amount_net`/`amount_gross: null`) is excluded — only a row
// that actually carries an amount is a live adjustment, same filter
// `cart/lib/toSalesSnapshots.ts#buildCartSalesSnapshot` already applies to its own (order-
// scope-only) read of this table.
export type CartAppliedPromotionEffect = { promotionId: string; effects: Array<Record<string, unknown>> }

export async function lookupCartAppliedPromotionEffects(
  em: EntityManager,
  cartId: string,
  scope: { tenantId: string; organizationId: string },
): Promise<CartAppliedPromotionEffect[]> {
  const rows = await em
    .getKysely<CartPromotionApplicationsDatabase>()
    .selectFrom('cart_promotion_applications')
    .select(['promotion_id', 'effect'])
    .where('cart_id', '=', cartId)
    .where('tenant_id', '=', scope.tenantId)
    .where('organization_id', '=', scope.organizationId)
    .where('amount_net', 'is not', null)
    .where('amount_gross', 'is not', null)
    .execute()

  const byPromotion = new Map<string, Array<Record<string, unknown>>>()
  for (const row of rows) {
    const effect = row.effect
    if (!effect || Object.keys(effect).length === 0) continue
    const existing = byPromotion.get(row.promotion_id)
    if (existing) existing.push(effect)
    else byPromotion.set(row.promotion_id, [effect])
  }
  return Array.from(byPromotion.entries()).map(([promotionId, effects]) => ({ promotionId, effects }))
}

export type PromotionNameDatabase = {
  promotions: { id: string; tenant_id: string; organization_id: string; name: string }
}

/** FK-id + snapshot read of `promotions.Promotion.name` (never an import of `promotions`'
 * own entity) — `registerUsage`'s `AppliedPromotion.promotionName` needs it and nothing on
 * `cart_promotion_applications` carries it. */
export async function lookupPromotionNames(
  em: EntityManager,
  promotionIds: string[],
  scope: { tenantId: string; organizationId: string },
): Promise<Map<string, string>> {
  const result = new Map<string, string>()
  if (promotionIds.length === 0) return result
  const rows = await em
    .getKysely<PromotionNameDatabase>()
    .selectFrom('promotions')
    .select(['id', 'name'])
    .where('id', 'in', promotionIds)
    .where('tenant_id', '=', scope.tenantId)
    .where('organization_id', '=', scope.organizationId)
    .execute()
  for (const row of rows) result.set(row.id, row.name)
  return result
}
