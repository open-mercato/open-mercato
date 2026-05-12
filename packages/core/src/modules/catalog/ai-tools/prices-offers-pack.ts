/**
 * `catalog.list_prices`, `catalog.list_price_kinds_base`, `catalog.list_offers`
 * (Phase 1 WS-C, Step 3.10).
 *
 * Read-only enumeration of prices (base + offer-bound), price kinds, and
 * offers for the caller tenant + organization. Mutation tools land in Step
 * 5.14 under the pending-action contract.
 *
 * `catalog.list_price_kinds_base` uses a distinct name on purpose — Step
 * 3.11 (D18) will own `catalog.list_price_kinds` verbatim; we keep both
 * names available so the D18 tool can layer merchandising-specific shape
 * over the base enumerator.
 *
 * Phase 3b of `.ai/specs/2026-04-27-ai-tools-api-backed-dry-refactor.md`:
 * `catalog.list_prices` and `catalog.list_offers` are now API-backed wrappers
 * over `GET /api/catalog/prices` and `GET /api/catalog/offers`. Tool names,
 * schemas, requiredFeatures, and output shapes are unchanged. The offers
 * route does not expose a `variantId` filter; the AI input is pre-resolved
 * via `CatalogProductPrice` to the matching offer ids and threaded through
 * the route's `id` filter (or post-filtered when more than one matches),
 * mirroring Phase 3a's `companyId` → `ids` trick for `customers.list_people`.
 */
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { defineApiBackedAiTool } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/api-backed-tool'
import type {
  AiApiOperationRequest,
  AiToolExecutionContext,
} from '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-api-operation-runner'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CatalogProductPrice } from '../data/entities'
import { assertTenantScope, type CatalogAiToolDefinition, type CatalogToolContext } from './types'
import { listPriceKindsCore } from './_shared'

function resolveEm(ctx: CatalogToolContext | AiToolExecutionContext): EntityManager {
  return ctx.container.resolve<EntityManager>('em')
}

function buildScope(ctx: CatalogToolContext | AiToolExecutionContext, tenantId: string) {
  return { tenantId, organizationId: ctx.organizationId }
}

const listPricesInput = z
  .object({
    productId: z.string().uuid().optional().describe('Restrict to prices attached to this product.'),
    variantId: z.string().uuid().optional().describe('Restrict to prices attached to this variant.'),
    priceKindId: z.string().uuid().optional().describe('Restrict to this price kind.'),
    limit: z.number().int().min(1).max(100).optional().describe('Max rows (default 50, max 100).'),
    offset: z.number().int().min(0).optional().describe('Rows to skip (default 0).'),
  })
  .passthrough()

type ListPricesInput = z.infer<typeof listPricesInput>

type ListPricesApiItem = {
  id?: string
  product_id?: string | null
  productId?: string | null
  variant_id?: string | null
  variantId?: string | null
  offer_id?: string | null
  offerId?: string | null
  price_kind_id?: string | null
  priceKindId?: string | null
  currency_code?: string | null
  currencyCode?: string | null
  kind?: string | null
  min_quantity?: number | null
  minQuantity?: number | null
  max_quantity?: number | null
  maxQuantity?: number | null
  unit_price_net?: string | number | null
  unitPriceNet?: string | number | null
  unit_price_gross?: string | number | null
  unitPriceGross?: string | number | null
  tax_rate?: string | number | null
  taxRate?: string | number | null
  tax_amount?: string | number | null
  taxAmount?: string | number | null
  channel_id?: string | null
  channelId?: string | null
  user_id?: string | null
  userId?: string | null
  user_group_id?: string | null
  userGroupId?: string | null
  customer_id?: string | null
  customerId?: string | null
  customer_group_id?: string | null
  customerGroupId?: string | null
  starts_at?: string | null
  startsAt?: string | null
  ends_at?: string | null
  endsAt?: string | null
  organization_id?: string | null
  organizationId?: string | null
  tenant_id?: string | null
  tenantId?: string | null
  created_at?: string | null
  createdAt?: string | null
}

type ListPricesApiResponse = {
  items?: ListPricesApiItem[]
  total?: number
}

type ListPricesOutput = {
  items: Array<Record<string, unknown>>
  total: number
  limit: number
  offset: number
}

const listPricesTool = defineApiBackedAiTool<
  ListPricesInput,
  ListPricesApiResponse,
  ListPricesOutput
>({
  name: 'catalog.list_prices',
  displayName: 'List prices',
  description:
    'List catalog prices (base + offer-scoped) for the caller tenant + organization. Filters: product, variant, or price kind.',
  inputSchema: listPricesInput,
  requiredFeatures: ['catalog.products.view'],
  toOperation: (input, ctx) => {
    assertTenantScope(ctx as unknown as CatalogToolContext)
    const limit = input.limit ?? 50
    const offset = input.offset ?? 0
    const page = Math.floor(offset / limit) + 1

    const query: Record<string, string | number | boolean | null | undefined> = {
      page,
      pageSize: limit,
    }
    if (input.productId) query.productId = input.productId
    if (input.variantId) query.variantId = input.variantId
    if (input.priceKindId) query.priceKindId = input.priceKindId

    const operation: AiApiOperationRequest = {
      method: 'GET',
      path: '/catalog/prices',
      query,
    }
    return operation
  },
  mapResponse: (response, input) => {
    const limit = input.limit ?? 50
    const offset = input.offset ?? 0
    const data = (response.data ?? {}) as ListPricesApiResponse
    const rawItems: ListPricesApiItem[] = Array.isArray(data.items) ? data.items : []
    return {
      items: rawItems.map((row) => {
        const startsAtRaw = row.starts_at ?? row.startsAt ?? null
        const startsAt = startsAtRaw ? new Date(String(startsAtRaw)).toISOString() : null
        const endsAtRaw = row.ends_at ?? row.endsAt ?? null
        const endsAt = endsAtRaw ? new Date(String(endsAtRaw)).toISOString() : null
        const createdAtRaw = row.created_at ?? row.createdAt ?? null
        const createdAt = createdAtRaw ? new Date(String(createdAtRaw)).toISOString() : null
        return {
          id: row.id,
          priceKindId: row.price_kind_id ?? row.priceKindId ?? null,
          productId: row.product_id ?? row.productId ?? null,
          variantId: row.variant_id ?? row.variantId ?? null,
          offerId: row.offer_id ?? row.offerId ?? null,
          currencyCode: row.currency_code ?? row.currencyCode ?? null,
          kind: row.kind ?? null,
          minQuantity: row.min_quantity ?? row.minQuantity ?? null,
          maxQuantity: row.max_quantity ?? row.maxQuantity ?? null,
          unitPriceNet: row.unit_price_net ?? row.unitPriceNet ?? null,
          unitPriceGross: row.unit_price_gross ?? row.unitPriceGross ?? null,
          taxRate: row.tax_rate ?? row.taxRate ?? null,
          taxAmount: row.tax_amount ?? row.taxAmount ?? null,
          channelId: row.channel_id ?? row.channelId ?? null,
          userId: row.user_id ?? row.userId ?? null,
          userGroupId: row.user_group_id ?? row.userGroupId ?? null,
          customerId: row.customer_id ?? row.customerId ?? null,
          customerGroupId: row.customer_group_id ?? row.customerGroupId ?? null,
          startsAt,
          endsAt,
          organizationId: row.organization_id ?? row.organizationId ?? null,
          tenantId: row.tenant_id ?? row.tenantId ?? null,
          createdAt,
        }
      }),
      total: typeof data.total === 'number' ? data.total : 0,
      limit,
      offset,
    }
  },
}) as unknown as CatalogAiToolDefinition

const listPriceKindsInput = z
  .object({
    limit: z.number().int().min(1).max(100).optional().describe('Max rows (default 50, max 100).'),
    offset: z.number().int().min(0).optional().describe('Rows to skip (default 0).'),
  })
  .passthrough()

const listPriceKindsTool: CatalogAiToolDefinition = {
  name: 'catalog.list_price_kinds_base',
  displayName: 'List price kinds (base)',
  description:
    'Enumerate the tenant price kinds. Base coverage tool — Step 3.11 (D18) owns `catalog.list_price_kinds` verbatim; this tool uses a distinct name to avoid collision.',
  inputSchema: listPriceKindsInput,
  requiredFeatures: ['catalog.settings.manage'],
  tags: ['read', 'catalog'],
  handler: async (rawInput, ctx) => {
    const { tenantId } = assertTenantScope(ctx)
    const input = listPriceKindsInput.parse(rawInput)
    // Shared helper; Step 3.11 `catalog.list_price_kinds` uses the same core
    // so both tools cannot drift.
    return listPriceKindsCore(ctx, input, tenantId)
  },
}

const listOffersInput = z
  .object({
    productId: z.string().uuid().optional().describe('Restrict to offers for this product.'),
    variantId: z.string().uuid().optional().describe('Restrict to offers whose prices are variant-scoped.'),
    active: z.boolean().optional().describe('When true, only active (non-archived) offers are returned.'),
    limit: z.number().int().min(1).max(100).optional().describe('Max rows (default 50, max 100).'),
    offset: z.number().int().min(0).optional().describe('Rows to skip (default 0).'),
  })
  .passthrough()

const NIL_UUID = '00000000-0000-0000-0000-000000000000'

type ListOffersInput = z.infer<typeof listOffersInput>

type ListOffersApiItem = {
  id?: string
  product_id?: string | null
  productId?: string | null
  channel_id?: string | null
  channelId?: string | null
  title?: string | null
  description?: string | null
  default_media_id?: string | null
  defaultMediaId?: string | null
  default_media_url?: string | null
  defaultMediaUrl?: string | null
  is_active?: boolean | null
  isActive?: boolean | null
  organization_id?: string | null
  organizationId?: string | null
  tenant_id?: string | null
  tenantId?: string | null
  created_at?: string | null
  createdAt?: string | null
}

type ListOffersApiResponse = {
  items?: ListOffersApiItem[]
  total?: number
}

type ListOffersOutput = {
  items: Array<Record<string, unknown>>
  total: number
  limit: number
  offset: number
}

async function resolveOfferIdsForVariant(
  ctx: AiToolExecutionContext | CatalogToolContext,
  tenantId: string,
  variantId: string,
): Promise<string[]> {
  const em = resolveEm(ctx)
  const priceWhere: Record<string, unknown> = { tenantId, variant: variantId }
  if (ctx.organizationId) priceWhere.organizationId = ctx.organizationId
  const prices = await findWithDecryption<CatalogProductPrice>(
    em,
    CatalogProductPrice,
    priceWhere as any,
    undefined,
    buildScope(ctx, tenantId),
  )
  const offerIds = prices
    .map((price) => (price as any).offer)
    .map((offer) => (offer && typeof offer === 'object' ? offer.id : offer))
    .filter((value: string | null): value is string => typeof value === 'string' && value.length > 0)
  return Array.from(new Set(offerIds))
}

const listOffersTool = defineApiBackedAiTool<
  ListOffersInput,
  ListOffersApiResponse,
  ListOffersOutput
>({
  name: 'catalog.list_offers',
  displayName: 'List offers',
  description:
    'List catalog offers for the caller tenant + organization, optionally narrowed to a product (or a variant via its prices).',
  inputSchema: listOffersInput,
  requiredFeatures: ['catalog.products.view'],
  toOperation: async (input, ctx) => {
    const { tenantId } = assertTenantScope(ctx as unknown as CatalogToolContext)
    const limit = input.limit ?? 50
    const offset = input.offset ?? 0
    const page = Math.floor(offset / limit) + 1

    const query: Record<string, string | number | boolean | null | undefined> = {
      page,
      pageSize: limit,
    }
    if (input.productId) query.productId = input.productId
    if (input.active === true) query.isActive = 'true'

    if (input.variantId) {
      const offerIds = await resolveOfferIdsForVariant(ctx, tenantId, input.variantId)
      if (offerIds.length === 0) {
        // Empty match — feed a non-existent uuid so the route returns an
        // empty page without us bypassing the API.
        query.id = NIL_UUID
      } else if (offerIds.length === 1) {
        query.id = offerIds[0]
      }
      // For >1 offer ids the route's single-id filter cannot narrow; the
      // mapper post-filters the unfiltered response by the resolved ids.
    }

    const operation: AiApiOperationRequest = {
      method: 'GET',
      path: '/catalog/offers',
      query,
    }
    return operation
  },
  mapResponse: async (response, input, ctx) => {
    const limit = input.limit ?? 50
    const offset = input.offset ?? 0
    const data = (response.data ?? {}) as ListOffersApiResponse
    let rawItems: ListOffersApiItem[] = Array.isArray(data.items) ? data.items : []
    let total = typeof data.total === 'number' ? data.total : 0

    if (input.variantId) {
      const { tenantId } = assertTenantScope(ctx as unknown as CatalogToolContext)
      const offerIds = await resolveOfferIdsForVariant(ctx, tenantId, input.variantId)
      const offerIdSet = new Set(offerIds)
      rawItems = rawItems.filter((row) => typeof row.id === 'string' && offerIdSet.has(row.id))
      total = rawItems.length
    }

    return {
      items: rawItems.map((row) => {
        const createdAtRaw = row.created_at ?? row.createdAt ?? null
        const createdAt = createdAtRaw ? new Date(String(createdAtRaw)).toISOString() : null
        return {
          id: row.id,
          title: row.title ?? '',
          description: row.description ?? null,
          channelId: row.channel_id ?? row.channelId ?? null,
          productId: row.product_id ?? row.productId ?? null,
          defaultMediaId: row.default_media_id ?? row.defaultMediaId ?? null,
          defaultMediaUrl: row.default_media_url ?? row.defaultMediaUrl ?? null,
          isActive: !!(row.is_active ?? row.isActive),
          organizationId: row.organization_id ?? row.organizationId ?? null,
          tenantId: row.tenant_id ?? row.tenantId ?? null,
          createdAt,
        }
      }),
      total,
      limit,
      offset,
    }
  },
}) as unknown as CatalogAiToolDefinition

export const pricesOffersAiTools: CatalogAiToolDefinition[] = [
  listPricesTool,
  listPriceKindsTool,
  listOffersTool,
]

export default pricesOffersAiTools
