/**
 * `catalog.list_categories` + `catalog.get_category` (Phase 1 WS-C, Step 3.10).
 *
 * Read-only category tools scoped by tenant + organization. `parentId: null`
 * returns root nodes; any concrete UUID restricts to direct children.
 */
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { loadCustomFieldValues } from '@open-mercato/shared/lib/crud/custom-fields'
import { E } from '#generated/entities.ids.generated'
import { CatalogProductCategory } from '../data/entities'
import { assertTenantScope, type CatalogAiToolDefinition, type CatalogToolContext } from './types'

function resolveEm(ctx: CatalogToolContext): EntityManager {
  return ctx.container.resolve<EntityManager>('em')
}

function buildScope(ctx: CatalogToolContext, tenantId: string) {
  return { tenantId, organizationId: ctx.organizationId }
}

const listCategoriesInput = z
  .object({
    parentId: z
      .union([z.string().uuid(), z.null()])
      .optional()
      .describe('Parent category id; pass `null` to list root nodes. Omit to list every category in scope.'),
    limit: z.number().int().min(1).max(100).optional().describe('Max rows (default 50, max 100).'),
    offset: z.number().int().min(0).optional().describe('Rows to skip (default 0).'),
    includeArchived: z
      .boolean()
      .optional()
      .describe('When true, include soft-deleted categories. Defaults to active-only.'),
  })
  .passthrough()

const listCategoriesTool: CatalogAiToolDefinition = {
  name: 'catalog.list_categories',
  displayName: 'List categories',
  description:
    'List catalog categories scoped to tenant + organization. Use `parentId: null` to list roots or a specific uuid to fetch direct children.',
  inputSchema: listCategoriesInput,
  requiredFeatures: ['catalog.categories.view'],
  tags: ['read', 'catalog'],
  handler: async (rawInput, ctx) => {
    const { tenantId } = assertTenantScope(ctx)
    const input = listCategoriesInput.parse(rawInput)
    const em = resolveEm(ctx)
    const limit = input.limit ?? 50
    const offset = input.offset ?? 0
    const where: Record<string, unknown> = { tenantId }
    if (ctx.organizationId) where.organizationId = ctx.organizationId
    if (!input.includeArchived) where.deletedAt = null
    if ('parentId' in input) {
      where.parentId = input.parentId ?? null
    }
    const [rows, total] = await Promise.all([
      findWithDecryption<CatalogProductCategory>(
        em,
        CatalogProductCategory,
        where as any,
        { limit, offset, orderBy: { depth: 'asc', name: 'asc' } as any } as any,
        buildScope(ctx, tenantId),
      ),
      em.count(CatalogProductCategory, where as any),
    ])
    const filtered = rows.filter((row) => row.tenantId === tenantId)
    return {
      items: filtered.map((row) => ({
        id: row.id,
        name: row.name,
        slug: row.slug ?? null,
        description: row.description ?? null,
        parentId: row.parentId ?? null,
        rootId: row.rootId ?? null,
        treePath: row.treePath ?? null,
        depth: row.depth,
        childIds: Array.isArray(row.childIds) ? row.childIds : [],
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

const getCategoryInput = z.object({
  categoryId: z.string().uuid().describe('Category id (UUID).'),
  includeRelated: z
    .boolean()
    .optional()
    .describe(
      'When true, include direct children (capped at 100) and inherited ancestor refs. Custom fields are always included.',
    ),
})

const getCategoryTool: CatalogAiToolDefinition = {
  name: 'catalog.get_category',
  displayName: 'Get category',
  description:
    'Fetch a catalog category by id with core fields and (optionally) children + ancestor inheritance + custom fields. Returns { found: false } when missing or cross-tenant.',
  inputSchema: getCategoryInput,
  requiredFeatures: ['catalog.categories.view'],
  tags: ['read', 'catalog'],
  handler: async (rawInput, ctx) => {
    const { tenantId } = assertTenantScope(ctx)
    const input = getCategoryInput.parse(rawInput)
    const em = resolveEm(ctx)
    const where: Record<string, unknown> = {
      id: input.categoryId,
      tenantId,
      deletedAt: null,
    }
    if (ctx.organizationId) where.organizationId = ctx.organizationId
    const category = await findOneWithDecryption<CatalogProductCategory>(
      em,
      CatalogProductCategory,
      where as any,
      undefined,
      buildScope(ctx, tenantId),
    )
    if (!category || category.tenantId !== tenantId) {
      return { found: false as const, categoryId: input.categoryId }
    }
    const customFieldValues = await loadCustomFieldValues({
      em,
      entityId: E.catalog.catalog_product_category,
      recordIds: [category.id],
      tenantIdByRecord: { [category.id]: category.tenantId ?? null },
      organizationIdByRecord: { [category.id]: category.organizationId ?? null },
      tenantFallbacks: [category.tenantId ?? tenantId].filter((value): value is string => !!value),
    })
    const customFields = customFieldValues[category.id] ?? {}
    let related: Record<string, unknown> | null = null
    if (input.includeRelated) {
      const scope = buildScope(ctx, tenantId)
      const children = await findWithDecryption<CatalogProductCategory>(
        em,
        CatalogProductCategory,
        { tenantId, parentId: category.id, deletedAt: null } as any,
        { limit: 100, orderBy: { name: 'asc' } as any } as any,
        scope,
      )
      related = {
        children: children
          .filter((row) => row.tenantId === tenantId)
          .map((row) => ({
            id: row.id,
            name: row.name,
            slug: row.slug ?? null,
            depth: row.depth,
            isActive: !!row.isActive,
          })),
        ancestorIds: Array.isArray(category.ancestorIds) ? [...category.ancestorIds] : [],
        descendantIds: Array.isArray(category.descendantIds) ? [...category.descendantIds] : [],
      }
    }
    return {
      found: true as const,
      category: {
        id: category.id,
        name: category.name,
        slug: category.slug ?? null,
        description: category.description ?? null,
        parentId: category.parentId ?? null,
        rootId: category.rootId ?? null,
        treePath: category.treePath ?? null,
        depth: category.depth,
        childIds: Array.isArray(category.childIds) ? [...category.childIds] : [],
        ancestorIds: Array.isArray(category.ancestorIds) ? [...category.ancestorIds] : [],
        descendantIds: Array.isArray(category.descendantIds) ? [...category.descendantIds] : [],
        metadata: category.metadata ?? null,
        isActive: !!category.isActive,
        organizationId: category.organizationId ?? null,
        tenantId: category.tenantId ?? null,
        createdAt: category.createdAt ? new Date(category.createdAt).toISOString() : null,
        updatedAt: category.updatedAt ? new Date(category.updatedAt).toISOString() : null,
      },
      customFields,
      related,
    }
  },
}

export const categoriesAiTools: CatalogAiToolDefinition[] = [listCategoriesTool, getCategoryTool]

export default categoriesAiTools
