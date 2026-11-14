import { createHash } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import {
  hashEffectiveScope,
  intersectScopes,
  type AssortmentScope,
  type EffectiveAssortmentScope,
} from '@open-mercato/shared/lib/catalog-visibility'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { CustomerUser } from '@open-mercato/core/modules/customer_accounts/data/entities'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
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

export type BuyerIdentity = Pick<BuyerContext, 'customerUserId' | 'customerId' | 'companyId' | 'customerIds' | 'isAuthenticated'>

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

type TenantOrganizationScope = { tenantId: string; organizationId: string }

async function lookupPriceKindDisplayMode(
  em: EntityManager,
  priceKindId: string,
  scope: TenantOrganizationScope,
): Promise<EcommercePriceDisplayMode | null> {
  const priceKind = await findOneWithDecryption(
    em,
    CatalogPriceKind,
    {
      id: priceKindId,
      tenantId: scope.tenantId,
      deletedAt: null,
      $or: [{ organizationId: null }, { organizationId: scope.organizationId }],
    },
    undefined,
    scope,
  )
  return taxModeFromPriceKindDisplayMode(priceKind?.displayMode)
}

async function resolveTaxMode(
  em: EntityManager,
  priceKindId: string | null,
  store: ResolvedStore,
): Promise<EcommercePriceDisplayMode> {
  const fallback = store.store.settings.display.priceDisplayModeDefault
  if (!priceKindId) return fallback
  const resolved = await lookupPriceKindDisplayMode(em, priceKindId, {
    tenantId: store.tenantId,
    organizationId: store.organizationId,
  })
  return resolved ?? fallback
}

/**
 * Trusted-path variant of `resolveTaxMode` (SPEC-029 §6.3, D-R5-22): `resolveForBuyer` has no
 * `ResolvedStore` to fall back to when no store is given, so `fallback` and the return are both
 * nullable — `taxMode` is `null` only when neither a price kind nor a store resolves (§6.3).
 */
async function resolveTrustedTaxMode(
  em: EntityManager,
  priceKindId: string | null,
  scope: TenantOrganizationScope,
  fallback: EcommercePriceDisplayMode | null,
): Promise<EcommercePriceDisplayMode | null> {
  if (!priceKindId) return fallback
  const resolved = await lookupPriceKindDisplayMode(em, priceKindId, scope)
  return resolved ?? fallback
}

async function resolveCustomerOverlayId(
  em: EntityManager,
  customerIds: string[],
  scope: TenantOrganizationScope,
): Promise<string | null> {
  if (customerIds.length === 0) return null
  const rows = await em
    .getKysely<CustomerOverlayDatabase>()
    .selectFrom('catalog_product_variant_prices')
    .select('customer_id')
    .distinct()
    .where('customer_id', 'in', customerIds)
    .where('tenant_id', '=', scope.tenantId)
    .where('organization_id', '=', scope.organizationId)
    .execute()
  const withOwnRows = new Set(rows.map((row) => row.customer_id).filter((id): id is string => typeof id === 'string'))
  const overlayIds = customerIds.filter((id) => withOwnRows.has(id))
  return overlayIds.length > 0 ? overlayIds.join(',') : null
}

/**
 * Effective assortment for this buyer: the customer-groups OR-list (groups plus the customer's
 * own override) AND-ed with the channel scope.
 */
async function resolveEffectiveAssortment(
  service: CustomerGroupsService,
  tenantId: string,
  channelAssortmentScope: AssortmentScope | null,
  identity: BuyerIdentity,
): Promise<EffectiveAssortmentScope> {
  const buyerScope = await service.resolveAssortmentScope({
    customerId: identity.customerId,
    customerIds: identity.customerIds,
    tenantId,
  })
  return intersectScopes(channelAssortmentScope, buyerScope.scope)
}

/**
 * The effective assortment an anonymous buyer gets on a channel, resolved exactly as
 * `resolveBuyerContext` resolves it: a channel that requires authentication is deny-all (`[]`),
 * otherwise the channel scope intersected with the default customer group's scope. Lets the admin
 * assortment count reuse the storefront's resolution instead of re-deriving it.
 */
export async function resolveAnonymousAssortmentScope(
  container: BuyerContextContainer,
  input: { tenantId: string; channelAssortmentScope: AssortmentScope | null; requireAuthentication: boolean },
): Promise<EffectiveAssortmentScope> {
  if (input.requireAuthentication) return []
  const service = requireService<CustomerGroupsService>(container, 'customerGroupsService')
  return resolveEffectiveAssortment(service, input.tenantId, input.channelAssortmentScope, ANONYMOUS_IDENTITY)
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

type BuyerGroupLayer = {
  customerGroupIds: string[]
  priceKindId: string | null
  allowPurchaseOnAccount: boolean
  approvalRequiredAbove: number | null
  assortmentScope: EffectiveAssortmentScope
}

function isClosedToBuyer(store: ResolvedStore, identity: BuyerIdentity): boolean {
  return store.channel.requireAuthentication && !identity.isAuthenticated
}

async function resolveBuyerGroupLayer(
  container: BuyerContextContainer,
  store: ResolvedStore,
  identity: BuyerIdentity,
): Promise<BuyerGroupLayer> {
  if (isClosedToBuyer(store, identity)) {
    return {
      customerGroupIds: [],
      priceKindId: store.channel.priceKindId ?? null,
      allowPurchaseOnAccount: false,
      approvalRequiredAbove: null,
      assortmentScope: [],
    }
  }
  const service = requireService<CustomerGroupsService>(container, 'customerGroupsService')
  const groups = await service.resolveGroups({
    customerId: identity.customerId,
    customerIds: identity.customerIds,
    tenantId: store.tenantId,
  })
  const terms = await service.resolveTerms({
    customerId: identity.customerId,
    customerIds: identity.customerIds,
    tenantId: store.tenantId,
    groupIds: groups.groupIds,
  })
  return {
    customerGroupIds: groups.groupIds,
    priceKindId: terms.priceKindId ?? store.channel.priceKindId ?? null,
    allowPurchaseOnAccount: terms.allowPurchaseOnAccount,
    approvalRequiredAbove: terms.approvalRequiredAbove,
    assortmentScope: await resolveEffectiveAssortment(
      service,
      store.tenantId,
      store.channel.assortmentScope,
      identity,
    ),
  }
}

async function buildBuyerContext(
  container: BuyerContextContainer,
  store: ResolvedStore,
  identity: BuyerIdentity,
): Promise<BuyerContext> {
  const em = requireService<EntityManager>(container, 'em')
  const { customerGroupIds, priceKindId, allowPurchaseOnAccount, approvalRequiredAbove, assortmentScope } =
    await resolveBuyerGroupLayer(container, store, identity)
  const taxMode = await resolveTaxMode(em, priceKindId, store)
  const assortmentScopeHash = hashEffectiveScope(assortmentScope)
  if (identity.isAuthenticated && Array.isArray(assortmentScope) && assortmentScope.length === 0) {
    await reportEmptyAssortment(container, store, assortmentScopeHash)
  }
  const customerOverlayId = await resolveCustomerOverlayId(em, identity.customerIds, {
    tenantId: store.tenantId,
    organizationId: store.organizationId,
  })
  return {
    ...identity,
    customerGroupIds,
    taxMode,
    priceKindId,
    allowPurchaseOnAccount,
    approvalRequiredAbove,
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

async function readPortalSession(request: Request) {
  const { getCustomerAuthFromRequest } = await import('@open-mercato/core/modules/customer_accounts/lib/customerAuth')
  return getCustomerAuthFromRequest(request)
}

export type ResolveBuyerContextOptions = {
  /** Bypasses the 60 s buyer-context cache and re-resolves the buyer directly (D-R4-22). */
  fresh?: boolean
}

export async function resolveBuyerContext(
  container: BuyerContextContainer,
  store: ResolvedStore,
  request: Request | null,
  opts: ResolveBuyerContextOptions = {},
): Promise<BuyerContext> {
  const auth = request ? await readPortalSession(request) : null
  if (auth && (auth.tenantId !== store.tenantId || auth.orgId !== store.organizationId)) {
    logger.debug('Portal session scope does not match the resolved store', { storeId: store.store.id })
    throw new StorefrontResolutionError(401, 'portal_session_scope_mismatch')
  }
  const customerUserId = auth?.sub ?? null
  const cache = buyerContextCache(container, { tenantId: store.tenantId, storeId: store.store.id })
  if (!opts.fresh) {
    const cached = await cache.get(customerUserId)
    if (cached && cached.customerUserId === customerUserId) return cached
  }
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

/**
 * Trusted buyer resolution (SPEC-029 §6.3, D-R5-22). `resolveForBuyer`'s own layer: unlike
 * `resolveBuyerContext`, the identity is supplied by a trusted caller instead of read from a
 * portal session, so there is no `ResolvedStore` and no cache — `storeContextService.resolveForBuyer`
 * composes `resolveTrustedBuyerIdentity` + `composeTrustedBuyer` directly, never touching
 * `buyerContextCache`.
 */

type TrustedPersonCompanyDatabase = {
  customer_people: {
    entity_id: string
    tenant_id: string
    organization_id: string
    company_entity_id: string | null
  }
}

async function loadPersonCompanyEntityId(
  em: EntityManager,
  personEntityId: string,
  scope: TenantOrganizationScope,
): Promise<string | null> {
  const row = await em
    .getKysely<TrustedPersonCompanyDatabase>()
    .selectFrom('customer_people')
    .select('company_entity_id')
    .where('entity_id', '=', personEntityId)
    .where('tenant_id', '=', scope.tenantId)
    .where('organization_id', '=', scope.organizationId)
    .executeTakeFirst()
  return row?.company_entity_id ?? null
}

async function resolveTrustedCustomerIdentity(
  em: EntityManager,
  customerId: string,
  scope: TenantOrganizationScope,
): Promise<BuyerIdentity> {
  const entity = await findOneWithDecryption(em, CustomerEntity, { id: customerId, ...scope, deletedAt: null }, undefined, scope)
  if (!entity) throw new StorefrontResolutionError(403, 'buyer_out_of_scope')
  const companyId = entity.kind === 'company' ? customerId : await loadPersonCompanyEntityId(em, customerId, scope)
  const customerIds = Array.from(
    new Set([customerId, companyId].filter((id): id is string => typeof id === 'string' && id.length > 0)),
  )
  return {
    customerUserId: null,
    customerId,
    companyId,
    customerIds,
    isAuthenticated: true,
  }
}

export type ResolveTrustedBuyerIdentityInput = {
  tenantId: string
  organizationId: string
  customerUserId?: string | null
  customerId?: string | null
}

/**
 * Builds the `BuyerIdentity` `resolveForBuyer` runs the rest of its composition over (§6.3
 * "Inputs"). Every branch is tenant/organization scoped and throws `buyer_out_of_scope` rather
 * than silently falling back to anonymous — a trusted caller handing in an id that does not
 * resolve in scope is a bug in the caller, not a guest.
 */
export async function resolveTrustedBuyerIdentity(
  container: BuyerContextContainer,
  input: ResolveTrustedBuyerIdentityInput,
): Promise<BuyerIdentity> {
  const { tenantId, organizationId, customerUserId = null, customerId = null } = input
  const scope = { tenantId, organizationId }
  const em = requireService<EntityManager>(container, 'em')
  if (customerUserId) {
    const user = await findOneWithDecryption(
      em,
      CustomerUser,
      { id: customerUserId, ...scope, isActive: true, deletedAt: null },
      undefined,
      scope,
    )
    if (!user) throw new StorefrontResolutionError(403, 'buyer_out_of_scope')
    const identity = buyerIdentityFromCustomerUser(user)
    if (customerId && !identity.customerIds.includes(customerId)) {
      throw new StorefrontResolutionError(403, 'buyer_out_of_scope')
    }
    return identity
  }
  if (customerId) return resolveTrustedCustomerIdentity(em, customerId, scope)
  return ANONYMOUS_IDENTITY
}

export type TrustedBuyerChannel = {
  priceKindId: string | null
  assortmentScope: AssortmentScope | null
  requireAuthentication: boolean
}

export type TrustedBuyerComposition = {
  customerGroupIds: string[]
  priceKindId: string | null
  taxMode: EcommercePriceDisplayMode | null
  buyerDigest: string
  /** Present only when `storeId` was given (§6.3 "assortmentScope only with a store"). */
  assortmentScope?: EffectiveAssortmentScope
}

export type ComposeTrustedBuyerInput = {
  tenantId: string
  organizationId: string
  /** Null when the caller gave no `storeId`; gates `assortmentScope`'s presence below. */
  storeId: string | null
  identity: BuyerIdentity
  /** Null when no store was given, or the store has no default channel binding. */
  channel: TrustedBuyerChannel | null
  /** Null when no store was given; `ecommerce_stores.settings.display.priceDisplayModeDefault`. */
  priceDisplayModeDefault: EcommercePriceDisplayMode | null
}

/**
 * Runs the same group/terms/tax/assortment composition `buildBuyerContext` runs for a session
 * buyer (§6.3 "It runs the same composition as `resolve()`"), fed by a trusted identity instead
 * of a `ResolvedStore`. Reads are always fresh and nothing is written to `buyerContextCache` —
 * structurally impossible to pollute or read the buyer's own 60 s cache, since that cache is never
 * referenced here.
 */
export async function composeTrustedBuyer(
  container: BuyerContextContainer,
  input: ComposeTrustedBuyerInput,
): Promise<TrustedBuyerComposition> {
  const { tenantId, organizationId, storeId, identity, channel, priceDisplayModeDefault } = input
  const em = requireService<EntityManager>(container, 'em')
  const scope = { tenantId, organizationId }

  let customerGroupIds: string[] = []
  let priceKindId: string | null = channel?.priceKindId ?? null
  if (identity.isAuthenticated) {
    const service = requireService<CustomerGroupsService>(container, 'customerGroupsService')
    const groups = await service.resolveGroups({
      customerId: identity.customerId,
      customerIds: identity.customerIds,
      tenantId,
    })
    customerGroupIds = groups.groupIds
    const terms = await service.resolveTerms({
      customerId: identity.customerId,
      customerIds: identity.customerIds,
      tenantId,
      groupIds: groups.groupIds,
    })
    priceKindId = terms.priceKindId ?? channel?.priceKindId ?? null
  }

  const taxMode = await resolveTrustedTaxMode(em, priceKindId, scope, priceDisplayModeDefault)

  let assortmentScope: EffectiveAssortmentScope | undefined
  let assortmentScopeHash: string | null = null
  if (storeId) {
    const closed = !!channel?.requireAuthentication && !identity.isAuthenticated
    if (closed) {
      assortmentScope = []
    } else {
      const service = requireService<CustomerGroupsService>(container, 'customerGroupsService')
      assortmentScope = await resolveEffectiveAssortment(service, tenantId, channel?.assortmentScope ?? null, identity)
    }
    assortmentScopeHash = hashEffectiveScope(assortmentScope)
  }

  const customerOverlayId =
    identity.customerIds.length > 0 ? await resolveCustomerOverlayId(em, identity.customerIds, scope) : null

  const sortedGroupIds = [...customerGroupIds].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
  const buyerDigest = sha256Truncated([
    storeId ?? NULL_SEGMENT,
    taxMode ?? NULL_SEGMENT,
    priceKindId ?? NULL_SEGMENT,
    sortedGroupIds.join(','),
    assortmentScopeHash ?? NULL_SEGMENT,
    customerOverlayId ?? NULL_SEGMENT,
  ])

  return {
    customerGroupIds,
    priceKindId,
    taxMode,
    buyerDigest,
    ...(storeId ? { assortmentScope } : {}),
  }
}
