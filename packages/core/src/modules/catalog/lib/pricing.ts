import type { EventBus } from '@open-mercato/events'
import type { FilterQuery } from '@mikro-orm/postgresql'
import type {
  CatalogOffer,
  CatalogPriceKind,
  CatalogProduct,
  CatalogProductPrice,
  CatalogProductVariant,
} from '../data/entities'

export type PricingContext = {
  channelId?: string | null
  offerId?: string | null
  userId?: string | null
  userGroupId?: string | null
  customerId?: string | null
  /** @deprecated use `customerGroupIds` — kept for backward compatibility, read as a one-element set when `customerGroupIds` is absent. */
  customerGroupId?: string | null
  /** Set membership: a row's `customerGroupId` matches when it appears in this list. Falls back to `customerGroupId` (above) when omitted. */
  customerGroupIds?: string[]
  /** When set, only rows in this currency match. Omitted (the default): no currency filtering, unchanged legacy behavior. */
  currencyCode?: string | null
  quantity: number
  date: Date
}

export type PriceRow = CatalogProductPrice & {
  product?: CatalogProduct | string | null
  variant?: CatalogProductVariant | string | null
  offer?: CatalogOffer | string | null
  priceKind?: CatalogPriceKind | string | null
}

export function resolvePriceVariantId(row: PriceRow): string | null {
  if (!row.variant) return null
  return typeof row.variant === 'string' ? row.variant : row.variant.id
}

export function resolvePriceOfferId(row: PriceRow): string | null {
  if (!row.offer) return null
  return typeof row.offer === 'string' ? row.offer : row.offer.id
}

export function resolvePriceChannelId(row: PriceRow): string | null {
  if (!row.offer) return row.channelId ?? null
  if (typeof row.offer === 'string') return row.channelId ?? null
  return row.channelId ?? row.offer.channelId ?? null
}

export function resolvePriceKindCode(row: PriceRow): string {
  if (row.priceKind) {
    if (typeof row.priceKind === 'string') return row.priceKind
    return row.priceKind.code ?? row.kind ?? ''
  }
  return row.kind ?? ''
}

function matchesContext(row: PriceRow, ctx: PricingContext): boolean {
  const { quantity, date } = ctx
  if (row.minQuantity && quantity < row.minQuantity) return false
  if (row.maxQuantity && quantity > row.maxQuantity) return false
  if (row.startsAt && date < row.startsAt) return false
  if (row.endsAt && date > row.endsAt) return false
  if (row.channelId || (row.offer && resolvePriceChannelId(row))) {
    const channel = resolvePriceChannelId(row)
    if (channel && ctx.channelId && channel !== ctx.channelId) return false
    if (channel && !ctx.channelId) return false
  }
  if (row.userId && ctx.userId !== row.userId) return false
  if (row.userGroupId && ctx.userGroupId !== row.userGroupId) return false
  if (row.customerId && ctx.customerId !== row.customerId) return false
  if (row.customerGroupId) {
    const candidateGroupIds = ctx.customerGroupIds ?? (ctx.customerGroupId ? [ctx.customerGroupId] : [])
    if (!candidateGroupIds.includes(row.customerGroupId)) return false
  }
  if (ctx.currencyCode && row.currencyCode !== ctx.currencyCode) return false
  if (ctx.offerId && resolvePriceOfferId(row) && resolvePriceOfferId(row) !== ctx.offerId) return false
  return true
}

/**
 * The narrowing half of `matchesContext` expressed as a MikroORM filter, for
 * callers that fetch `CatalogProductPrice` rows by product/variant today and
 * would otherwise load every contracted customer's rows just to discard
 * almost all of them (per-customer pricing at scale — see
 * `.ai/specs/2026-08-21-pricing-engine.md` § Row narrowing).
 *
 * Covers only the dimensions that are plain column comparisons: customer,
 * customer-group, user, user-group, channel, currency. Quantity bounds,
 * validity windows, and offer-derived channel resolution stay in
 * `matchesContext` — they are cheap over an already-narrowed set and are not
 * expressible as one column predicate (offer's own `channelId` lives on a
 * different table).
 *
 * **Invariant (one-directional, this is the whole point of the helper):**
 * `matchesContext(row, ctx)` implies this filter admits `row`. The filter
 * MAY admit rows `matchesContext` later rejects (a slightly wide fetch) —
 * it MUST NEVER exclude a row `matchesContext` would have accepted, because
 * that is a silently wrong price with no error anywhere. Verified by the
 * property-based test in `lib/__tests__/buildPriceRowFilter.property.test.ts`.
 */
export function buildPriceRowFilter(ctx: PricingContext): FilterQuery<CatalogProductPrice> {
  const customerGroupIds = ctx.customerGroupIds ?? (ctx.customerGroupId ? [ctx.customerGroupId] : [])

  const clauses: FilterQuery<CatalogProductPrice>[] = [
    ctx.customerId
      ? { $or: [{ customerId: null }, { customerId: ctx.customerId }] }
      : { customerId: null },
    customerGroupIds.length
      ? { $or: [{ customerGroupId: null }, { customerGroupId: { $in: customerGroupIds } }] }
      : { customerGroupId: null },
    ctx.userId
      ? { $or: [{ userId: null }, { userId: ctx.userId }] }
      : { userId: null },
    ctx.userGroupId
      ? { $or: [{ userGroupId: null }, { userGroupId: ctx.userGroupId }] }
      : { userGroupId: null },
    ctx.channelId
      ? { $or: [{ channelId: null }, { channelId: ctx.channelId }] }
      : { channelId: null },
  ]

  if (ctx.currencyCode) {
    clauses.push({ currencyCode: ctx.currencyCode })
  }

  return { $and: clauses } as FilterQuery<CatalogProductPrice>
}

function scorePrice(row: PriceRow): number {
  const resolvedKind = resolvePriceKindCode(row)
  let score = 0
  if (resolvedKind === 'custom') score += 5
  else if (resolvedKind === 'tier') score += 3
  else if (resolvedKind === 'promotion' || row.priceKind?.isPromotion) score += 4
  else score += 2
  if (row.variant) score += 8
  if (row.offer) score += 6
  if (row.channelId) score += 5
  if (row.userId) score += 5
  if (row.userGroupId) score += 4
  if (row.customerId) score += 4
  if (row.customerGroupId) score += 3
  if (row.minQuantity && row.minQuantity > 1) score += 1
  return score
}

export function selectBestPrice(rows: PriceRow[], ctx: PricingContext): PriceRow | null {
  const candidates = rows.filter((row) => matchesContext(row, ctx))
  if (!candidates.length) return null
  candidates.sort((a, b) => {
    const scoreDiff = scorePrice(b) - scorePrice(a)
    if (scoreDiff !== 0) return scoreDiff
    const startA = a.startsAt ? a.startsAt.getTime() : 0
    const startB = b.startsAt ? b.startsAt.getTime() : 0
    if (startA !== startB) return startB - startA
    // minQuantity tie-break is direction-dependent on the resolved kind.
    // Within the same kind we pick the more specific tier (higher minQuantity wins — issue #1706).
    // Across kinds we keep the pre-#1706 ascending order so a row whose kind has a higher
    // scoreBase still wins when scorePrice's "+1 for minQuantity > 1" bonus produces a
    // cross-kind collision (e.g. promotion[minQty=1]=4 vs tier[minQty=3]=4).
    if (resolvePriceKindCode(a) === resolvePriceKindCode(b)) {
      return (b.minQuantity ?? 1) - (a.minQuantity ?? 1)
    }
    return (a.minQuantity ?? 1) - (b.minQuantity ?? 1)
  })
  return candidates[0]
}

export type CatalogPricingResolver = (
  rows: PriceRow[],
  ctx: PricingContext
) => PriceRow | null | undefined | Promise<PriceRow | null | undefined>

type RegisteredResolver = {
  id?: string
  resolver: CatalogPricingResolver
  priority: number
}

type PricingRegistryState = {
  resolvers: RegisteredResolver[]
}

// `globalThis`-keyed so the registry survives duplicated module instances
// (a standalone app built from this monorepo, or any dev/build setup that
// loads `catalog` through more than one chunk) — the same failure class
// already fixed once for the ORM entity registry
// (see `packages/shared/src/modules/integrations/types.ts` for the identical
// pattern). A module-local array is invisible across instances: a resolver
// registered from one instance would silently never run for resolution
// happening in another.
const GLOBAL_PRICING_REGISTRY_KEY = '__openMercatoCatalogPricingRegistry__' as const

type GlobalPricingRegistry = typeof globalThis & {
  [GLOBAL_PRICING_REGISTRY_KEY]?: PricingRegistryState
}

function getPricingRegistryState(): PricingRegistryState {
  const globalRegistry = globalThis as GlobalPricingRegistry
  if (!globalRegistry[GLOBAL_PRICING_REGISTRY_KEY]) {
    globalRegistry[GLOBAL_PRICING_REGISTRY_KEY] = { resolvers: [] }
  }
  return globalRegistry[GLOBAL_PRICING_REGISTRY_KEY]
}

function sortResolvers(state: PricingRegistryState): void {
  // `Array.prototype.sort` is stable (ES2019+): resolvers registered at the
  // same priority keep their registration order. This is the documented,
  // tested same-priority tie-break — see `catalog/AGENTS.md` § Price
  // selection order and the registry test in `lib/__tests__/pricing.test.ts`.
  state.resolvers.sort((a, b) => b.priority - a.priority)
}

export function registerCatalogPricingResolver(
  resolver: CatalogPricingResolver,
  options?: { priority?: number; id?: string }
): void {
  const state = getPricingRegistryState()
  const id = options?.id
  // Dedupe by id so a documented extension point stays HMR-safe for every
  // future registrant, not just one caller: re-registering the same id is a
  // no-op instead of appending a duplicate entry on every module reload.
  if (id && state.resolvers.some((entry) => entry.id === id)) return
  state.resolvers.push({ id, resolver, priority: options?.priority ?? 0 })
  sortResolvers(state)
}

export function resetCatalogPricingResolvers(): void {
  getPricingRegistryState().resolvers.splice(0)
}

export async function resolveCatalogPrice(
  rows: PriceRow[],
  ctx: PricingContext,
  options?: { eventBus?: EventBus | null }
): Promise<PriceRow | null> {
  let workingRows = rows
  let workingContext = ctx
  const eventBus = options?.eventBus ?? null
  let resolved: PriceRow | null | undefined

  if (eventBus) {
    await eventBus.emitEvent('catalog.pricing.resolve.before', {
      rows: workingRows,
      context: workingContext,
      setRows(next: PriceRow[]) {
        if (Array.isArray(next)) workingRows = next
      },
      setContext(next: PricingContext) {
        if (next) workingContext = next
      },
      setResult(next: PriceRow | null) {
        resolved = next
      },
    })
    if (resolved !== undefined) return resolved
  }

  for (const { resolver } of getPricingRegistryState().resolvers) {
    const result = await resolver(workingRows, workingContext)
    if (result !== undefined) {
      resolved = result ?? null
      break
    }
  }

  if (resolved === undefined) {
    resolved = selectBestPrice(workingRows, workingContext)
  }

  if (eventBus) {
    await eventBus.emitEvent('catalog.pricing.resolve.after', {
      rows: workingRows,
      context: workingContext,
      result: resolved ?? null,
      setResult(next: PriceRow | null) {
        resolved = next
      },
    })
  }

  return resolved ?? null
}

export async function resolveCatalogPriceBatch(
  entries: Array<{ rows: PriceRow[]; context: PricingContext }>,
  options?: { eventBus?: EventBus | null }
): Promise<Array<PriceRow | null>> {
  return Promise.all(
    entries.map(({ rows, context }) => resolveCatalogPrice(rows, context, options))
  )
}
