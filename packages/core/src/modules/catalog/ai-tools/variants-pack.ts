/**
 * `catalog.list_variants` (Phase 1 WS-C, Step 3.10).
 *
 * Enumerate variants for a single product with option values + media refs.
 */
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CatalogProductVariant } from '../data/entities'
import { assertTenantScope, type CatalogAiToolDefinition, type CatalogToolContext } from './types'

function resolveEm(ctx: CatalogToolContext): EntityManager {
  return ctx.container.resolve<EntityManager>('em')
}

function buildScope(ctx: CatalogToolContext, tenantId: string) {
  return { tenantId, organizationId: ctx.organizationId }
}

const listVariantsInput = z
  .object({
    productId: z.string().uuid().describe('Parent product id (UUID).'),
    limit: z.number().int().min(1).max(100).optional().describe('Max rows (default 50, max 100).'),
    offset: z.number().int().min(0).optional().describe('Rows to skip (default 0).'),
  })
  .passthrough()

const listVariantsTool: CatalogAiToolDefinition = {
  name: 'catalog.list_variants',
  displayName: 'List variants',
  description:
    'List the variants of a catalog product (including option values, SKU, barcode, default media ref). Returns { items, total, limit, offset }.',
  inputSchema: listVariantsInput,
  requiredFeatures: ['catalog.products.view'],
  tags: ['read', 'catalog'],
  handler: async (rawInput, ctx) => {
    const { tenantId } = assertTenantScope(ctx)
    const input = listVariantsInput.parse(rawInput)
    const em = resolveEm(ctx)
    const limit = input.limit ?? 50
    const offset = input.offset ?? 0
    const where: Record<string, unknown> = {
      tenantId,
      product: input.productId,
      deletedAt: null,
    }
    if (ctx.organizationId) where.organizationId = ctx.organizationId
    const [rows, total] = await Promise.all([
      findWithDecryption<CatalogProductVariant>(
        em,
        CatalogProductVariant,
        where as any,
        { limit, offset, orderBy: { createdAt: 'asc' } as any } as any,
        buildScope(ctx, tenantId),
      ),
      em.count(CatalogProductVariant, where as any),
    ])
    const filtered = rows.filter((row) => row.tenantId === tenantId)
    return {
      items: filtered.map((row) => ({
        id: row.id,
        name: row.name ?? null,
        sku: row.sku ?? null,
        barcode: row.barcode ?? null,
        statusEntryId: row.statusEntryId ?? null,
        optionValues: row.optionValues ?? null,
        defaultMediaId: row.defaultMediaId ?? null,
        defaultMediaUrl: row.defaultMediaUrl ?? null,
        weightValue: row.weightValue ?? null,
        weightUnit: row.weightUnit ?? null,
        dimensions: row.dimensions ?? null,
        taxRate: row.taxRate ?? null,
        taxRateId: row.taxRateId ?? null,
        isDefault: !!row.isDefault,
        isActive: !!row.isActive,
        productId: (row as any).product && typeof (row as any).product === 'object'
          ? (row as any).product.id
          : (row as any).product ?? null,
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

export const variantsAiTools: CatalogAiToolDefinition[] = [listVariantsTool]

export default variantsAiTools
