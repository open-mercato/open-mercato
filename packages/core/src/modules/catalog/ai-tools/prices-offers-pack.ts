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
 */
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CatalogOffer, CatalogPriceKind, CatalogProductPrice } from '../data/entities'
import { assertTenantScope, type CatalogAiToolDefinition, type CatalogToolContext } from './types'

function resolveEm(ctx: CatalogToolContext): EntityManager {
  return ctx.container.resolve<EntityManager>('em')
}

function buildScope(ctx: CatalogToolContext, tenantId: string) {
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

const listPricesTool: CatalogAiToolDefinition = {
  name: 'catalog.list_prices',
  displayName: 'List prices',
  description:
    'List catalog prices (base + offer-scoped) for the caller tenant + organization. Filters: product, variant, or price kind.',
  inputSchema: listPricesInput,
  requiredFeatures: ['catalog.products.view'],
  tags: ['read', 'catalog'],
  handler: async (rawInput, ctx) => {
    const { tenantId } = assertTenantScope(ctx)
    const input = listPricesInput.parse(rawInput)
    const em = resolveEm(ctx)
    const limit = input.limit ?? 50
    const offset = input.offset ?? 0
    const where: Record<string, unknown> = { tenantId }
    if (ctx.organizationId) where.organizationId = ctx.organizationId
    if (input.productId) where.product = input.productId
    if (input.variantId) where.variant = input.variantId
    if (input.priceKindId) where.priceKind = input.priceKindId
    const [rows, total] = await Promise.all([
      findWithDecryption<CatalogProductPrice>(
        em,
        CatalogProductPrice,
        where as any,
        { limit, offset, orderBy: { createdAt: 'asc' } as any } as any,
        buildScope(ctx, tenantId),
      ),
      em.count(CatalogProductPrice, where as any),
    ])
    const filtered = rows.filter((row) => row.tenantId === tenantId)
    return {
      items: filtered.map((row) => ({
        id: row.id,
        priceKindId: (row as any).priceKind && typeof (row as any).priceKind === 'object'
          ? (row as any).priceKind.id
          : (row as any).priceKind ?? null,
        productId: (row as any).product && typeof (row as any).product === 'object'
          ? (row as any).product.id
          : (row as any).product ?? null,
        variantId: (row as any).variant && typeof (row as any).variant === 'object'
          ? (row as any).variant.id
          : (row as any).variant ?? null,
        offerId: (row as any).offer && typeof (row as any).offer === 'object'
          ? (row as any).offer.id
          : (row as any).offer ?? null,
        currencyCode: row.currencyCode,
        kind: row.kind,
        minQuantity: row.minQuantity,
        maxQuantity: row.maxQuantity ?? null,
        unitPriceNet: row.unitPriceNet ?? null,
        unitPriceGross: row.unitPriceGross ?? null,
        taxRate: row.taxRate ?? null,
        taxAmount: row.taxAmount ?? null,
        channelId: row.channelId ?? null,
        userId: row.userId ?? null,
        userGroupId: row.userGroupId ?? null,
        customerId: row.customerId ?? null,
        customerGroupId: row.customerGroupId ?? null,
        startsAt: row.startsAt ? new Date(row.startsAt).toISOString() : null,
        endsAt: row.endsAt ? new Date(row.endsAt).toISOString() : null,
        organizationId: row.organizationId ?? null,
        tenantId: row.tenantId ?? null,
        createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
      })),
      total,
      limit,
      offset,
    }
  },
}

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
    const em = resolveEm(ctx)
    const limit = input.limit ?? 50
    const offset = input.offset ?? 0
    const where: Record<string, unknown> = { tenantId, deletedAt: null }
    if (ctx.organizationId) {
      where.$or = [{ organizationId: ctx.organizationId }, { organizationId: null }]
    }
    const [rows, total] = await Promise.all([
      findWithDecryption<CatalogPriceKind>(
        em,
        CatalogPriceKind,
        where as any,
        { limit, offset, orderBy: { code: 'asc' } as any } as any,
        buildScope(ctx, tenantId),
      ),
      em.count(CatalogPriceKind, where as any),
    ])
    const filtered = rows.filter((row) => row.tenantId === tenantId)
    return {
      items: filtered.map((row) => ({
        id: row.id,
        code: row.code,
        title: row.title,
        displayMode: row.displayMode,
        currencyCode: row.currencyCode ?? null,
        isPromotion: !!row.isPromotion,
        isActive: !!row.isActive,
        organizationId: row.organizationId ?? null,
        tenantId: row.tenantId ?? null,
      })),
      total,
      limit,
      offset,
    }
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

const listOffersTool: CatalogAiToolDefinition = {
  name: 'catalog.list_offers',
  displayName: 'List offers',
  description:
    'List catalog offers for the caller tenant + organization, optionally narrowed to a product (or a variant via its prices).',
  inputSchema: listOffersInput,
  requiredFeatures: ['catalog.products.view'],
  tags: ['read', 'catalog'],
  handler: async (rawInput, ctx) => {
    const { tenantId } = assertTenantScope(ctx)
    const input = listOffersInput.parse(rawInput)
    const em = resolveEm(ctx)
    const limit = input.limit ?? 50
    const offset = input.offset ?? 0
    const scope = buildScope(ctx, tenantId)
    if (input.variantId) {
      const priceWhere: Record<string, unknown> = { tenantId, variant: input.variantId }
      if (ctx.organizationId) priceWhere.organizationId = ctx.organizationId
      const prices = await findWithDecryption<CatalogProductPrice>(
        em,
        CatalogProductPrice,
        priceWhere as any,
        undefined,
        scope,
      )
      const offerIds = prices
        .map((price) => (price as any).offer)
        .map((offer) => (offer && typeof offer === 'object' ? offer.id : offer))
        .filter((value: string | null): value is string => typeof value === 'string' && value.length > 0)
      if (!offerIds.length) return { items: [], total: 0, limit, offset }
      const where: Record<string, unknown> = {
        tenantId,
        id: { $in: Array.from(new Set(offerIds)) },
        deletedAt: null,
      }
      if (ctx.organizationId) where.organizationId = ctx.organizationId
      if (input.productId) where.product = input.productId
      if (input.active === true) where.isActive = true
      const [rows, total] = await Promise.all([
        findWithDecryption<CatalogOffer>(
          em,
          CatalogOffer,
          where as any,
          { limit, offset, orderBy: { createdAt: 'desc' } as any } as any,
          scope,
        ),
        em.count(CatalogOffer, where as any),
      ])
      const filtered = rows.filter((row) => row.tenantId === tenantId)
      return {
        items: filtered.map((row) => ({
          id: row.id,
          title: row.title,
          description: row.description ?? null,
          channelId: row.channelId,
          productId: (row as any).product && typeof (row as any).product === 'object'
            ? (row as any).product.id
            : (row as any).product ?? null,
          defaultMediaId: row.defaultMediaId ?? null,
          defaultMediaUrl: row.defaultMediaUrl ?? null,
          isActive: !!row.isActive,
          organizationId: row.organizationId ?? null,
          tenantId: row.tenantId ?? null,
          createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
        })),
        total,
        limit,
        offset,
      }
    }
    const where: Record<string, unknown> = { tenantId, deletedAt: null }
    if (ctx.organizationId) where.organizationId = ctx.organizationId
    if (input.productId) where.product = input.productId
    if (input.active === true) where.isActive = true
    const [rows, total] = await Promise.all([
      findWithDecryption<CatalogOffer>(
        em,
        CatalogOffer,
        where as any,
        { limit, offset, orderBy: { createdAt: 'desc' } as any } as any,
        scope,
      ),
      em.count(CatalogOffer, where as any),
    ])
    const filtered = rows.filter((row) => row.tenantId === tenantId)
    return {
      items: filtered.map((row) => ({
        id: row.id,
        title: row.title,
        description: row.description ?? null,
        channelId: row.channelId,
        productId: (row as any).product && typeof (row as any).product === 'object'
          ? (row as any).product.id
          : (row as any).product ?? null,
        defaultMediaId: row.defaultMediaId ?? null,
        defaultMediaUrl: row.defaultMediaUrl ?? null,
        isActive: !!row.isActive,
        organizationId: row.organizationId ?? null,
        tenantId: row.tenantId ?? null,
        createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
      })),
      total,
      limit,
      offset,
    }
  },
}

export const pricesOffersAiTools: CatalogAiToolDefinition[] = [
  listPricesTool,
  listPriceKindsTool,
  listOffersTool,
]

export default pricesOffersAiTools
