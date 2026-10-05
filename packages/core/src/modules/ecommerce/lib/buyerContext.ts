import { createHash } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import {
  hashEffectiveScope,
  intersectScopes,
  type EffectiveAssortmentScope,
} from '@open-mercato/shared/lib/catalog-visibility'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { getCustomerAuthFromRequest } from '@open-mercato/core/modules/customer_accounts/lib/customerAuth'
import { CustomerUser } from '@open-mercato/core/modules/customer_accounts/data/entities'
import { CatalogPriceKind } from '@open-mercato/core/modules/catalog/data/entities'
import type { CustomerGroupsService } from '@open-mercato/core/modules/customer_groups/services/customerGroupsService'
import type { EcommercePriceDisplayMode } from '../data/validators'
import { emitEcommerceEvent } from '../events'
import { buyerContextCache, ecommerceResolutionCache, type CacheContainer } from './cacheKeys'
import { StorefrontResolutionError, type ResolvedStore } from './storeContext'
import type { BuyerContext, StoreContext } from './types'

/**
 * Buyer layer of storefront resolution (SPEC-029 v4.6 §4.1 step 6, §6, §6.0, §6.1, §6.1a, §8).
 *
 * The portal session only proves WHO is asking; identity ids are read fresh from
 * `customer_accounts.CustomerUser` (D3), never from JWT claims. A session issued for another
 * tenant or organization answers `401` (D4). The buyer layer is locale-independent and cached
 * for 60 s per (store, customerUserId | anonymous); `digest` is computed per request by
 * `composeStoreContext` because it includes the effective locale.
 */

export type BuyerContextContainer = CacheContainer

export const ASSORTMENT_EMPTY_THROTTLE_MS = 3_600_000

const DIGEST_LENGTH = 16
const NULL_SEGMENT = '-'

const logger = createLogger('ecommerce').child({ component: 'buyer-context' })

type BuyerIdentity = Pick<BuyerContext, 'customerUserId' | 'customerId' | 'companyId' | 'customerIds' | 'isAuthenticated'>

type CustomerOverlayDatabase = {
  catalog_product_variant_prices: {
    customer_id: string | null
    tenant_id: string
    organization_id: string
  }
}

const ANONYMOUS_IDENTITY: BuyerIdentity = {
  customerUserId: null,
  customerId: null,
  companyId: null,
  customerIds: [],
  isAuthenticated: false,
}

function tryResolve<T>(container: BuyerContextContainer, name: string): T | null {
  try {
    const resolved = container.resolve(name) as T | null | undefined
    return resolved ?? null
  } catch {
    return null
  }
}

function requireService<T>(container: BuyerContextContainer, name: string): T {
  const service = tryResolve<T>(container, name)
  if (!service) throw new Error(`[internal] ecommerce buyer context requires the DI service ${name}`)
  return service
}

function sha256Truncated(segments: string[]): string {
  return createHash('sha256').update(segments.join('|')).digest('hex').slice(0, DIGEST_LENGTH)
}

export function computePriceScopeKey(input: {
  channelId: string
  currencyCode: string
  priceKindId: string | null
  customerGroupIds: string[]
}): string {
  const sortedGroupIds = [...input.customerGroupIds].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
  return sha256Truncated([
    input.channelId,
    input.currencyCode,
    input.priceKindId ?? NULL_SEGMENT,
    sortedGroupIds.join(','),
  ])
}

export function computeStoreContextDigest(input: {
  storeId: string
  effectiveLocale: string
  taxMode: EcommercePriceDisplayMode
  priceScopeKey: string
  assortmentScopeHash: string
  customerOverlayId: string | null
}): string {
  return sha256Truncated([
    input.storeId,
    input.effectiveLocale,
    input.taxMode,
    input.priceScopeKey,
    input.assortmentScopeHash,
    input.customerOverlayId ?? NULL_SEGMENT,
  ])
}

export function buyerIdentityFromCustomerUser(user: {
  id: string
  personEntityId?: string | null
  customerEntityId?: string | null
}): BuyerIdentity {
  const personId = user.personEntityId ?? null
  const companyId = user.customerEntityId ?? null
  const customerIds = Array.from(
    new Set([personId, companyId].filter((id): id is string => typeof id === 'string' && id.length > 0)),
  )
  return {
    customerUserId: user.id,
    customerId: personId ?? companyId,
    companyId,
    customerIds,
    isAuthenticated: true,
  }
}

async function loadBuyerIdentity(em: EntityManager, customerUserId: string, store: ResolvedStore): Promise<BuyerIdentity> {
  const scope = { tenantId: store.tenantId, organizationId: store.organizationId }
  const user = await findOneWithDecryption(
    em,
    CustomerUser,
    { id: customerUserId, ...scope, isActive: true, deletedAt: null },
    undefined,
    scope,
  )
  if (!user) {
    logger.debug('Portal session points at a missing or inactive customer user', { storeId: store.store.id })
    throw new StorefrontResolutionError(401, 'portal_session_invalid')
  }
  return buyerIdentityFromCustomerUser(user)
}

export function taxModeFromPriceKindDisplayMode(displayMode: string | null | undefined): EcommercePriceDisplayMode | null {
  if (displayMode === 'excluding-tax') return 'net'
  if (displayMode === 'including-tax') return 'gross'
  return null
}

async function resolveTaxMode(
  em: EntityManager,
  priceKindId: string | null,
  store: ResolvedStore,
): Promise<EcommercePriceDisplayMode> {
  const fallback = store.store.settings.display.priceDisplayModeDefault
  if (!priceKindId) return fallback
  const scope = { tenantId: store.tenantId, organizationId: store.organizationId }
  const priceKind = await findOneWithDecryption(
    em,
    CatalogPriceKind,
    {
      id: priceKindId,
      tenantId: store.tenantId,
      deletedAt: null,
      $or: [{ organizationId: null }, { organizationId: store.organizationId }],
    },
    undefined,
    scope,
  )
  return taxModeFromPriceKindDisplayMode(priceKind?.displayMode) ?? fallback
}

async function resolveCustomerOverlayId(
  em: EntityManager,
  customerIds: string[],
  store: ResolvedStore,
): Promise<string | null> {
  if (customerIds.length === 0) return null
  const rows = await em
    .getKysely<CustomerOverlayDatabase>()
    .selectFrom('catalog_product_variant_prices')
    .select('customer_id')
    .distinct()
    .where('customer_id', 'in', customerIds)
    .where('tenant_id', '=', store.tenantId)
    .where('organization_id', '=', store.organizationId)
    .execute()
  const withOwnRows = new Set(rows.map((row) => row.customer_id).filter((id): id is string => typeof id === 'string'))
  const overlayIds = customerIds.filter((id) => withOwnRows.has(id))
  return overlayIds.length > 0 ? overlayIds.join(',') : null
}

/**
 * Effective assortment for this buyer: the customer-groups OR-list (groups plus the customer's
 * own override) AND-ed with the channel scope. This is the seam where the channel binding's
 * `require_authentication` deny-all short-circuit (Step 5.1) is applied before `customer_groups`
 * is consulted.
 */
async function resolveEffectiveAssortment(
  service: CustomerGroupsService,
  store: ResolvedStore,
  identity: BuyerIdentity,
): Promise<EffectiveAssortmentScope> {
  const buyerScope = await service.resolveAssortmentScope({
    customerId: identity.customerId,
    customerIds: identity.customerIds,
    tenantId: store.tenantId,
  })
  return intersectScopes(store.channel.assortmentScope, buyerScope.scope)
}

async function reportEmptyAssortment(
  container: BuyerContextContainer,
  store: ResolvedStore,
  assortmentScopeHash: string,
): Promise<void> {
  const cache = ecommerceResolutionCache(container)
  const key = ['assortment-empty', store.store.id, store.channel.channelBindingId, assortmentScopeHash]
  const alreadyReported = await cache.get<{ reportedAt: string }>(key)
  if (alreadyReported) return
  await cache.set(key, { reportedAt: new Date().toISOString() }, { ttlMs: ASSORTMENT_EMPTY_THROTTLE_MS })
  logger.warn('Authenticated buyer resolved to an empty assortment', {
    storeId: store.store.id,
    channelBindingId: store.channel.channelBindingId,
    assortmentScopeHash,
  })
  try {
    await emitEcommerceEvent(
      'ecommerce.assortment.empty_detected',
      {
        id: store.store.id,
        storeId: store.store.id,
        channelBindingId: store.channel.channelBindingId,
        assortmentScopeHash,
        tenantId: store.tenantId,
        organizationId: store.organizationId,
      },
      { persistent: true, tenantId: store.tenantId, organizationId: store.organizationId },
    )
  } catch (error) {
    logger.warn('Failed to emit empty assortment event', { storeId: store.store.id, err: error })
    getTelemetryRuntime()?.reportError(error, {
      module: 'ecommerce',
      code: 'ecommerce.assortment_empty_emit_failed',
      attributes: { storeId: store.store.id },
    })
  }
}

async function buildBuyerContext(
  container: BuyerContextContainer,
  store: ResolvedStore,
  identity: BuyerIdentity,
): Promise<BuyerContext> {
  const em = requireService<EntityManager>(container, 'em')
  const customerGroupsService = requireService<CustomerGroupsService>(container, 'customerGroupsService')
  const groups = await customerGroupsService.resolveGroups({
    customerId: identity.customerId,
    customerIds: identity.customerIds,
    tenantId: store.tenantId,
  })
  const customerGroupIds = groups.groupIds
  const terms = await customerGroupsService.resolveTerms({
    customerId: identity.customerId,
    customerIds: identity.customerIds,
    tenantId: store.tenantId,
    groupIds: customerGroupIds,
  })
  const priceKindId = terms.priceKindId ?? store.channel.priceKindId ?? null
  const taxMode = await resolveTaxMode(em, priceKindId, store)
  const assortmentScope = await resolveEffectiveAssortment(customerGroupsService, store, identity)
  const assortmentScopeHash = hashEffectiveScope(assortmentScope)
  if (identity.isAuthenticated && Array.isArray(assortmentScope) && assortmentScope.length === 0) {
    await reportEmptyAssortment(container, store, assortmentScopeHash)
  }
  const customerOverlayId = await resolveCustomerOverlayId(em, identity.customerIds, store)
  return {
    ...identity,
    customerGroupIds,
    taxMode,
    priceKindId,
    allowPurchaseOnAccount: terms.allowPurchaseOnAccount,
    approvalRequiredAbove: terms.approvalRequiredAbove,
    assortmentScope,
    assortmentScopeHash,
    priceScopeKey: computePriceScopeKey({
      channelId: store.channel.salesChannelId,
      currencyCode: store.currencyCode,
      priceKindId,
      customerGroupIds,
    }),
    customerOverlayId,
  }
}

export async function resolveBuyerContext(
  container: BuyerContextContainer,
  store: ResolvedStore,
  request: Request | null,
): Promise<BuyerContext> {
  const auth = request ? await getCustomerAuthFromRequest(request) : null
  if (auth && (auth.tenantId !== store.tenantId || auth.orgId !== store.organizationId)) {
    logger.debug('Portal session scope does not match the resolved store', { storeId: store.store.id })
    throw new StorefrontResolutionError(401, 'portal_session_scope_mismatch')
  }
  const customerUserId = auth?.sub ?? null
  const cache = buyerContextCache(container, { tenantId: store.tenantId, storeId: store.store.id })
  const cached = await cache.get(customerUserId)
  if (cached && cached.customerUserId === customerUserId) return cached
  const identity = customerUserId
    ? await loadBuyerIdentity(requireService<EntityManager>(container, 'em'), customerUserId, store)
    : ANONYMOUS_IDENTITY
  const buyer = await buildBuyerContext(container, store, identity)
  await cache.set(buyer)
  return buyer
}

export function composeStoreContext(store: ResolvedStore, buyer: BuyerContext): StoreContext {
  return {
    store: store.store,
    tenantId: store.tenantId,
    organizationId: store.organizationId,
    channel: {
      channelBindingId: store.channel.channelBindingId,
      salesChannelId: store.channel.salesChannelId,
      priceKindId: store.channel.priceKindId,
      priceSortFallback: store.channel.priceSortFallback,
    },
    buyer,
    effectiveLocale: store.effectiveLocale,
    requestedLocale: store.requestedLocale,
    currencyCode: store.currencyCode,
    digest: computeStoreContextDigest({
      storeId: store.store.id,
      effectiveLocale: store.effectiveLocale,
      taxMode: buyer.taxMode,
      priceScopeKey: buyer.priceScopeKey,
      assortmentScopeHash: buyer.assortmentScopeHash,
      customerOverlayId: buyer.customerOverlayId,
    }),
  }
}
