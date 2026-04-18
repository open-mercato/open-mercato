/**
 * `catalog.list_option_schemas` + `catalog.list_unit_conversions` (Phase 1
 * WS-C, Step 3.10).
 *
 * Product-configuration surface: option schemas (variant axes) and unit
 * conversions (UoM factors).
 */
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CatalogOptionSchemaTemplate, CatalogProductUnitConversion } from '../data/entities'
import { assertTenantScope, type CatalogAiToolDefinition, type CatalogToolContext } from './types'

function resolveEm(ctx: CatalogToolContext): EntityManager {
  return ctx.container.resolve<EntityManager>('em')
}

function buildScope(ctx: CatalogToolContext, tenantId: string) {
  return { tenantId, organizationId: ctx.organizationId }
}

const listOptionSchemasInput = z
  .object({
    limit: z.number().int().min(1).max(100).optional().describe('Max rows (default 50, max 100).'),
    offset: z.number().int().min(0).optional().describe('Rows to skip (default 0).'),
  })
  .passthrough()

const listOptionSchemasTool: CatalogAiToolDefinition = {
  name: 'catalog.list_option_schemas',
  displayName: 'List option schemas',
  description:
    'List product option schemas (variant axes, e.g. size/color definitions) for the caller tenant + organization.',
  inputSchema: listOptionSchemasInput,
  requiredFeatures: ['catalog.products.view'],
  tags: ['read', 'catalog'],
  handler: async (rawInput, ctx) => {
    const { tenantId } = assertTenantScope(ctx)
    const input = listOptionSchemasInput.parse(rawInput)
    const em = resolveEm(ctx)
    const limit = input.limit ?? 50
    const offset = input.offset ?? 0
    const where: Record<string, unknown> = { tenantId, deletedAt: null }
    if (ctx.organizationId) where.organizationId = ctx.organizationId
    const [rows, total] = await Promise.all([
      findWithDecryption<CatalogOptionSchemaTemplate>(
        em,
        CatalogOptionSchemaTemplate,
        where as any,
        { limit, offset, orderBy: { code: 'asc' } as any } as any,
        buildScope(ctx, tenantId),
      ),
      em.count(CatalogOptionSchemaTemplate, where as any),
    ])
    const filtered = rows.filter((row) => row.tenantId === tenantId)
    return {
      items: filtered.map((row) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        description: row.description ?? null,
        schema: row.schema,
        metadata: row.metadata ?? null,
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

const listUnitConversionsInput = z
  .object({
    productId: z.string().uuid().optional().describe('Restrict to unit conversions for this product.'),
    limit: z.number().int().min(1).max(100).optional().describe('Max rows (default 50, max 100).'),
    offset: z.number().int().min(0).optional().describe('Rows to skip (default 0).'),
  })
  .passthrough()

const listUnitConversionsTool: CatalogAiToolDefinition = {
  name: 'catalog.list_unit_conversions',
  displayName: 'List unit conversions',
  description:
    'List product unit conversions (alternate units with `toBaseFactor`) for the caller tenant + organization. Optionally narrow by product.',
  inputSchema: listUnitConversionsInput,
  requiredFeatures: ['catalog.products.view'],
  tags: ['read', 'catalog'],
  handler: async (rawInput, ctx) => {
    const { tenantId } = assertTenantScope(ctx)
    const input = listUnitConversionsInput.parse(rawInput)
    const em = resolveEm(ctx)
    const limit = input.limit ?? 50
    const offset = input.offset ?? 0
    const where: Record<string, unknown> = { tenantId, deletedAt: null }
    if (ctx.organizationId) where.organizationId = ctx.organizationId
    if (input.productId) where.product = input.productId
    const [rows, total] = await Promise.all([
      findWithDecryption<CatalogProductUnitConversion>(
        em,
        CatalogProductUnitConversion,
        where as any,
        { limit, offset, orderBy: { sortOrder: 'asc', createdAt: 'asc' } as any } as any,
        buildScope(ctx, tenantId),
      ),
      em.count(CatalogProductUnitConversion, where as any),
    ])
    const filtered = rows.filter((row) => row.tenantId === tenantId)
    return {
      items: filtered.map((row) => ({
        id: row.id,
        unitCode: row.unitCode,
        toBaseFactor: row.toBaseFactor,
        sortOrder: row.sortOrder,
        isActive: !!row.isActive,
        productId: (row as any).product && typeof (row as any).product === 'object'
          ? (row as any).product.id
          : (row as any).product ?? null,
        metadata: row.metadata ?? null,
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

export const configurationAiTools: CatalogAiToolDefinition[] = [
  listOptionSchemasTool,
  listUnitConversionsTool,
]

export default configurationAiTools
