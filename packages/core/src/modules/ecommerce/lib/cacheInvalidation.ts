import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import {
  catalogCategoryTag,
  catalogPriceTag,
  catalogProductTag,
  catalogProductsTag,
  ecommerceCustomerGroupTag,
  ecommerceCustomerTag,
  ecommerceCustomerUserTag,
  ecommerceDomainMappingTag,
  ecommerceDomainTag,
  ecommerceStoreTag,
  ecommerceUngroupedBuyerTag,
  invalidateEcommerceCacheTags,
  storefrontAvailabilityTag,
} from './cacheKeys'
import {
  asPayloadRecord,
  eventAction,
  readEventScope,
  readPayloadString,
  tryResolveService,
  type EcommerceSubscriberContext,
} from './subscriberSupport'

/**
 * Event → cache-tag mapping for the storefront caches (SPEC-029 §8 table). Every eviction goes
 * through `invalidateEcommerceCacheTags`, which clears the tenant-agnostic resolution cache and the
 * emitting tenant's buyer/storefront caches.
 */

const logger = createLogger('ecommerce').child({ component: 'cache-invalidation' })

type TagDeriver = (payload: Record<string, unknown>, action: string | null, tenantId: string | null) => string[]

const STORE_CACHE_ACTIONS: ReadonlySet<string> = new Set(['created', 'updated', 'deleted', 'branding_updated'])
const CUSTOMER_GROUP_CACHE_ACTIONS: ReadonlySet<string> = new Set(['created', 'updated', 'deleted'])
const CUSTOMER_GROUP_DEFAULT_CANDIDATE_ACTIONS: ReadonlySet<string> = new Set(['created', 'updated'])
const CATALOG_CRUD_ACTIONS: ReadonlySet<string> = new Set(['created', 'updated', 'deleted'])
const CUSTOMER_USER_CACHE_ACTIONS: ReadonlySet<string> = new Set(['updated', 'deleted'])

function tagsFrom(values: Array<string | null>, toTag: (value: string) => string): string[] {
  return values.filter((value): value is string => value !== null).map(toTag)
}

export const storeEventTags: TagDeriver = (payload, action) => {
  if (action && !STORE_CACHE_ACTIONS.has(action)) return []
  return tagsFrom([readPayloadString(payload, 'id')], ecommerceStoreTag)
}

export const storeDomainBindingEventTags: TagDeriver = (payload) => [
  ...tagsFrom(
    [readPayloadString(payload, 'storeId'), readPayloadString(payload, 'previousStoreId')],
    ecommerceStoreTag,
  ),
  ...tagsFrom(
    [readPayloadString(payload, 'domainMappingId'), readPayloadString(payload, 'previousDomainMappingId')],
    ecommerceDomainMappingTag,
  ),
]

export const storeChannelBindingEventTags: TagDeriver = (payload) =>
  tagsFrom([readPayloadString(payload, 'storeId'), readPayloadString(payload, 'previousStoreId')], ecommerceStoreTag)

export const domainMappingEventTags: TagDeriver = (payload) => [
  ...tagsFrom(
    [readPayloadString(payload, 'id'), readPayloadString(payload, 'replacedDomainId')],
    ecommerceDomainMappingTag,
  ),
  ...tagsFrom(
    [readPayloadString(payload, 'hostname'), readPayloadString(payload, 'replacedHostname')],
    ecommerceDomainTag,
  ),
]

/**
 * `customer_accounts.user.updated|deleted`: the user's buyer contexts, so a deactivated or deleted
 * portal user stops resolving to their cached identity (and contract prices) before the TTL ends.
 */
export const customerUserEventTags: TagDeriver = (payload, action) => {
  if (action && !CUSTOMER_USER_CACHE_ACTIONS.has(action)) return []
  return tagsFrom([readPayloadString(payload, 'id')], ecommerceCustomerUserTag)
}

export const customerGroupMembershipEventTags: TagDeriver = (payload) =>
  tagsFrom([readPayloadString(payload, 'customerId')], ecommerceCustomerTag)

/**
 * `customer_groups.group.*`: the group's buyer contexts. The payload carries no `isDefault`, so a
 * create or update also evicts the tenant's ungrouped buyer contexts, which would fall back to the
 * group if it became the tenant default; a replaced default is announced as its own update.
 */
export const customerGroupEventTags: TagDeriver = (payload, action, tenantId) => {
  if (action && !CUSTOMER_GROUP_CACHE_ACTIONS.has(action)) return []
  const tags = action === 'created' ? [] : tagsFrom([readPayloadString(payload, 'id')], ecommerceCustomerGroupTag)
  if (tenantId && (!action || CUSTOMER_GROUP_DEFAULT_CANDIDATE_ACTIONS.has(action))) {
    tags.push(ecommerceUngroupedBuyerTag(tenantId))
  }
  return tags
}

export const customerGroupTermsEventTags: TagDeriver = (payload) =>
  tagsFrom([readPayloadString(payload, 'groupId')], ecommerceCustomerGroupTag)

export async function invalidateForEvent(
  payload: unknown,
  ctx: EcommerceSubscriberContext,
  deriveTags: TagDeriver,
): Promise<number> {
  const record = asPayloadRecord(payload)
  const { tenantId } = readEventScope(record, ctx)
  const tags = deriveTags(record, eventAction(ctx.eventName), tenantId)
  if (tags.length === 0) return 0
  return invalidateEcommerceCacheTags(ctx, { tenantId, tags })
}

type CatalogLookupDatabase = {
  catalog_product_variant_prices: {
    id: string
    tenant_id: string
    organization_id: string
    customer_id: string | null
    product_id: string | null
    variant_id: string | null
  }
  catalog_product_variants: {
    id: string
    tenant_id: string
    organization_id: string
    product_id: string
  }
  availability_policies: {
    id: string
    tenant_id: string
    organization_id: string
    product_id: string | null
  }
}

type PriceOwner = { customerId: string | null; productId: string | null }

type LookupScope = { tenantId: string; organizationId: string | null }

async function readPriceOwner(em: EntityManager, priceId: string, scope: LookupScope): Promise<PriceOwner | null> {
  let query = em
    .getKysely<CatalogLookupDatabase>()
    .selectFrom('catalog_product_variant_prices as price')
    .leftJoin('catalog_product_variants as variant', 'variant.id', 'price.variant_id')
    .select(['price.customer_id as customerId', 'price.product_id as productId', 'variant.product_id as variantProductId'])
    .where('price.id', '=', priceId)
    .where('price.tenant_id', '=', scope.tenantId)
  if (scope.organizationId) query = query.where('price.organization_id', '=', scope.organizationId)
  const row = await query.executeTakeFirst()
  if (!row) return null
  return { customerId: row.customerId ?? null, productId: row.productId ?? row.variantProductId ?? null }
}

async function readVariantProductId(em: EntityManager, variantId: string, scope: LookupScope): Promise<string | null> {
  let query = em
    .getKysely<CatalogLookupDatabase>()
    .selectFrom('catalog_product_variants')
    .select('product_id')
    .where('id', '=', variantId)
    .where('tenant_id', '=', scope.tenantId)
  if (scope.organizationId) query = query.where('organization_id', '=', scope.organizationId)
  const row = await query.executeTakeFirst()
  return row?.product_id ?? null
}

async function readPolicyProductId(em: EntityManager, policyId: string, scope: LookupScope): Promise<string | null> {
  let query = em
    .getKysely<CatalogLookupDatabase>()
    .selectFrom('availability_policies')
    .select('product_id')
    .where('id', '=', policyId)
    .where('tenant_id', '=', scope.tenantId)
  if (scope.organizationId) query = query.where('organization_id', '=', scope.organizationId)
  const row = await query.executeTakeFirst()
  return row?.product_id ?? null
}

/**
 * Reads the row an id-only catalog/availability payload points at. A missing `em`, a missing row
 * and a failed lookup all answer `undefined`, so the caller falls back to its broader tag.
 */
async function lookupForEvent<T>(
  ctx: EcommerceSubscriberContext,
  id: string,
  scope: LookupScope,
  lookup: (em: EntityManager, id: string, scope: LookupScope) => Promise<T | null>,
  failureCode: string,
): Promise<T | undefined> {
  const em = tryResolveService<EntityManager>(ctx, 'em')
  if (!em) return undefined
  try {
    return (await lookup(em, id, scope)) ?? undefined
  } catch (error) {
    logger.warn('Storefront cache lookup failed; falling back to broader tags', { id, failureCode, err: error })
    getTelemetryRuntime()?.reportError(error, {
      module: 'ecommerce',
      code: failureCode,
      attributes: { id },
    })
    return undefined
  }
}

type ScopedEvent = { id: string; action: string | null; scope: LookupScope }

function readScopedEvent(payload: unknown, ctx: EcommerceSubscriberContext): ScopedEvent | null {
  const record = asPayloadRecord(payload)
  const id = readPayloadString(record, 'id')
  const scope = readEventScope(record, ctx)
  if (!id || !scope.tenantId) return null
  return { id, action: eventAction(ctx.eventName), scope: { tenantId: scope.tenantId, organizationId: scope.organizationId } }
}

function isCatalogCrudAction(action: string | null): boolean {
  return action === null || CATALOG_CRUD_ACTIONS.has(action)
}

/**
 * `catalog.price.*` (§8 buyer context, Storefront Public API §9): evicts the product's
 * `catalog-price` tag and every listing of the tenant, plus the owning customer's buyer context
 * when the row is customer-specific (`customerOverlayId`). The payload carries ids only, so the row
 * is read back; a deleted row is gone, so a delete evicts the listings only and the product detail
 * and buyer context fall back to their TTLs (catalog declares no price-kind events either).
 */
export async function invalidateForPriceEvent(payload: unknown, ctx: EcommerceSubscriberContext): Promise<number> {
  const event = readScopedEvent(payload, ctx)
  if (!event || !isCatalogCrudAction(event.action)) return 0
  const owner =
    event.action === 'deleted'
      ? undefined
      : await lookupForEvent(ctx, event.id, event.scope, readPriceOwner, 'ecommerce.price_cache_invalidation_failed')
  const tags = [catalogProductsTag(event.scope.tenantId)]
  if (owner?.productId) tags.push(catalogPriceTag(owner.productId))
  if (owner?.customerId) tags.push(ecommerceCustomerTag(owner.customerId))
  return invalidateEcommerceCacheTags(ctx, { tenantId: event.scope.tenantId, tags })
}

/** `catalog.product.created|updated|deleted`: the product's detail entries and every listing of the tenant. */
export async function invalidateForProductEvent(payload: unknown, ctx: EcommerceSubscriberContext): Promise<number> {
  const event = readScopedEvent(payload, ctx)
  if (!event || !isCatalogCrudAction(event.action)) return 0
  return invalidateEcommerceCacheTags(ctx, {
    tenantId: event.scope.tenantId,
    tags: [catalogProductTag(event.id), catalogProductsTag(event.scope.tenantId)],
  })
}

/**
 * `catalog.variant.*`: the variant's product (read back — the payload carries ids only) and every
 * listing of the tenant. A deleted variant row is gone, so its product detail falls back to its TTL.
 */
export async function invalidateForVariantEvent(payload: unknown, ctx: EcommerceSubscriberContext): Promise<number> {
  const event = readScopedEvent(payload, ctx)
  if (!event || !isCatalogCrudAction(event.action)) return 0
  const productId =
    event.action === 'deleted'
      ? undefined
      : await lookupForEvent(ctx, event.id, event.scope, readVariantProductId, 'ecommerce.variant_cache_invalidation_failed')
  const tags = [catalogProductsTag(event.scope.tenantId)]
  if (productId) tags.push(catalogProductTag(productId))
  return invalidateEcommerceCacheTags(ctx, { tenantId: event.scope.tenantId, tags })
}

/** `catalog.category.*`: details showing the category and every listing (category names, filters, assortment). */
export async function invalidateForCategoryEvent(payload: unknown, ctx: EcommerceSubscriberContext): Promise<number> {
  const event = readScopedEvent(payload, ctx)
  if (!event || !isCatalogCrudAction(event.action)) return 0
  return invalidateEcommerceCacheTags(ctx, {
    tenantId: event.scope.tenantId,
    tags: [catalogCategoryTag(event.id), catalogProductsTag(event.scope.tenantId)],
  })
}

/**
 * `availability.policy.*`: a policy tied to a product evicts that product and every listing; a
 * store- or tenant-wide policy (or one that cannot be read back) evicts every storefront product
 * entry of the tenant. Policies are soft-deleted, so a delete still reads back its product.
 */
export async function invalidateForAvailabilityPolicyEvent(
  payload: unknown,
  ctx: EcommerceSubscriberContext,
): Promise<number> {
  const event = readScopedEvent(payload, ctx)
  if (!event || !isCatalogCrudAction(event.action)) return 0
  const productId = await lookupForEvent(
    ctx,
    event.id,
    event.scope,
    readPolicyProductId,
    'ecommerce.availability_policy_cache_invalidation_failed',
  )
  const tags = productId
    ? [catalogProductTag(productId), catalogProductsTag(event.scope.tenantId)]
    : [storefrontAvailabilityTag(event.scope.tenantId)]
  return invalidateEcommerceCacheTags(ctx, { tenantId: event.scope.tenantId, tags })
}
