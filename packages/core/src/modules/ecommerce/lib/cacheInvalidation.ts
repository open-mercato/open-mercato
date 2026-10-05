import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import {
  ecommerceCustomerGroupTag,
  ecommerceCustomerTag,
  ecommerceDomainMappingTag,
  ecommerceDomainTag,
  ecommerceStoreTag,
  invalidateEcommerceCacheTags,
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

type TagDeriver = (payload: Record<string, unknown>, action: string | null) => string[]

const STORE_CACHE_ACTIONS: ReadonlySet<string> = new Set(['created', 'updated', 'deleted', 'branding_updated'])
const CUSTOMER_GROUP_CACHE_ACTIONS: ReadonlySet<string> = new Set(['updated', 'deleted'])

function tagsFrom(values: Array<string | null>, toTag: (value: string) => string): string[] {
  return values.filter((value): value is string => value !== null).map(toTag)
}

export const storeEventTags: TagDeriver = (payload, action) => {
  if (action && !STORE_CACHE_ACTIONS.has(action)) return []
  return tagsFrom([readPayloadString(payload, 'id')], ecommerceStoreTag)
}

export const storeDomainBindingEventTags: TagDeriver = (payload) => [
  ...tagsFrom([readPayloadString(payload, 'storeId')], ecommerceStoreTag),
  ...tagsFrom([readPayloadString(payload, 'domainMappingId')], ecommerceDomainMappingTag),
]

export const storeChannelBindingEventTags: TagDeriver = (payload) =>
  tagsFrom([readPayloadString(payload, 'storeId')], ecommerceStoreTag)

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

export const customerGroupMembershipEventTags: TagDeriver = (payload) =>
  tagsFrom([readPayloadString(payload, 'customerId')], ecommerceCustomerTag)

export const customerGroupEventTags: TagDeriver = (payload, action) => {
  if (action && !CUSTOMER_GROUP_CACHE_ACTIONS.has(action)) return []
  return tagsFrom([readPayloadString(payload, 'id')], ecommerceCustomerGroupTag)
}

export const customerGroupTermsEventTags: TagDeriver = (payload) =>
  tagsFrom([readPayloadString(payload, 'groupId')], ecommerceCustomerGroupTag)

export async function invalidateForEvent(
  payload: unknown,
  ctx: EcommerceSubscriberContext,
  deriveTags: TagDeriver,
): Promise<number> {
  const record = asPayloadRecord(payload)
  const tags = deriveTags(record, eventAction(ctx.eventName))
  if (tags.length === 0) return 0
  return invalidateEcommerceCacheTags(ctx, { tenantId: readEventScope(record, ctx).tenantId, tags })
}

type PriceOwnerDatabase = {
  catalog_product_variant_prices: {
    id: string
    tenant_id: string
    organization_id: string
    customer_id: string | null
  }
}

async function readPriceCustomerId(
  em: EntityManager,
  priceId: string,
  tenantId: string,
  organizationId: string | null,
): Promise<string | null> {
  let query = em
    .getKysely<PriceOwnerDatabase>()
    .selectFrom('catalog_product_variant_prices')
    .select('customer_id')
    .where('id', '=', priceId)
    .where('tenant_id', '=', tenantId)
  if (organizationId) query = query.where('organization_id', '=', organizationId)
  const row = await query.executeTakeFirst()
  return row?.customer_id ?? null
}

/**
 * `catalog.price.*` changes `customerOverlayId` only for a price row owned by a customer. The
 * payload carries ids only, so the row is read back; a deleted row is gone, and catalog declares no
 * price-kind events, so those cases rely on the buyer-context TTL (§8).
 */
export async function invalidateForPriceEvent(payload: unknown, ctx: EcommerceSubscriberContext): Promise<number> {
  if (eventAction(ctx.eventName) === 'deleted') return 0
  const record = asPayloadRecord(payload)
  const priceId = readPayloadString(record, 'id')
  const scope = readEventScope(record, ctx)
  if (!priceId || !scope.tenantId) return 0
  const em = tryResolveService<EntityManager>(ctx, 'em')
  if (!em) return 0
  let customerId: string | null = null
  try {
    customerId = await readPriceCustomerId(em, priceId, scope.tenantId, scope.organizationId)
  } catch (error) {
    logger.warn('Price owner lookup failed; buyer context falls back to its TTL', { priceId, err: error })
    getTelemetryRuntime()?.reportError(error, {
      module: 'ecommerce',
      code: 'ecommerce.price_cache_invalidation_failed',
      attributes: { priceId },
    })
    return 0
  }
  if (!customerId) return 0
  return invalidateEcommerceCacheTags(ctx, { tenantId: scope.tenantId, tags: [ecommerceCustomerTag(customerId)] })
}
