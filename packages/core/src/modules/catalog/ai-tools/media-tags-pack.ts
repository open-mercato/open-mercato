/**
 * `catalog.list_product_media` + `catalog.list_product_tags` (Phase 1 WS-C,
 * Step 3.10).
 *
 * Media tool returns metadata only — bytes flow through the Step 3.7
 * attachment bridge, not this enumeration. Tags tool mirrors the existing
 * `/api/catalog/tags` GET surface (feature-gated the same way).
 */
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { E } from '#generated/entities.ids.generated'
import { Attachment } from '@open-mercato/core/modules/attachments/data/entities'
import { CatalogProductTag, CatalogProductTagAssignment } from '../data/entities'
import { assertTenantScope, type CatalogAiToolDefinition, type CatalogToolContext } from './types'

function resolveEm(ctx: CatalogToolContext): EntityManager {
  return ctx.container.resolve<EntityManager>('em')
}

function buildScope(ctx: CatalogToolContext, tenantId: string) {
  return { tenantId, organizationId: ctx.organizationId }
}

const listProductMediaInput = z
  .object({
    productId: z.string().uuid().describe('Catalog product id (UUID).'),
    limit: z.number().int().min(1).max(100).optional().describe('Max rows (default 50, max 100).'),
    offset: z.number().int().min(0).optional().describe('Rows to skip (default 0).'),
  })
  .passthrough()

const listProductMediaTool: CatalogAiToolDefinition = {
  name: 'catalog.list_product_media',
  displayName: 'List product media',
  description:
    'Enumerate media attachments (metadata only) associated with a catalog product. Use the attachment bridge (Step 3.7) to fetch bytes.',
  inputSchema: listProductMediaInput,
  requiredFeatures: ['catalog.products.view'],
  tags: ['read', 'catalog'],
  handler: async (rawInput, ctx) => {
    const { tenantId } = assertTenantScope(ctx)
    const input = listProductMediaInput.parse(rawInput)
    const em = resolveEm(ctx)
    const limit = input.limit ?? 50
    const offset = input.offset ?? 0
    const where: Record<string, unknown> = {
      tenantId,
      entityId: E.catalog.catalog_product,
      recordId: input.productId,
    }
    if (ctx.organizationId) where.organizationId = ctx.organizationId
    const [rows, total] = await Promise.all([
      findWithDecryption<Attachment>(
        em,
        Attachment,
        where as any,
        { limit, offset, orderBy: { createdAt: 'asc' } as any } as any,
        buildScope(ctx, tenantId),
      ),
      em.count(Attachment, where as any),
    ])
    const filtered = rows.filter((row) => (row.tenantId ?? null) === tenantId)
    return {
      items: filtered.map((row) => ({
        id: row.id,
        fileName: row.fileName,
        mimeType: row.mimeType,
        fileSize: row.fileSize,
        url: row.url,
        storageDriver: row.storageDriver,
        partitionCode: row.partitionCode,
        entityId: row.entityId,
        recordId: row.recordId,
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

const listProductTagsInput = z
  .object({
    productId: z.string().uuid().describe('Catalog product id (UUID).'),
  })
  .passthrough()

const listProductTagsTool: CatalogAiToolDefinition = {
  name: 'catalog.list_product_tags',
  displayName: 'List product tags',
  description:
    'Enumerate tags assigned to a catalog product (label + slug). Returns { items, total }.',
  inputSchema: listProductTagsInput,
  requiredFeatures: ['catalog.products.view'],
  tags: ['read', 'catalog'],
  handler: async (rawInput, ctx) => {
    const { tenantId } = assertTenantScope(ctx)
    const input = listProductTagsInput.parse(rawInput)
    const em = resolveEm(ctx)
    const where: Record<string, unknown> = { tenantId, product: input.productId }
    if (ctx.organizationId) where.organizationId = ctx.organizationId
    const assignments = await findWithDecryption<CatalogProductTagAssignment>(
      em,
      CatalogProductTagAssignment,
      where as any,
      { populate: ['tag'] as any } as any,
      buildScope(ctx, tenantId),
    )
    const filtered = assignments.filter((assignment) => assignment.tenantId === tenantId)
    const items = filtered
      .map((assignment) => {
        const tag = (assignment as any).tag as CatalogProductTag | string | null
        if (!tag || typeof tag === 'string') return null
        return { id: tag.id, label: tag.label, slug: tag.slug }
      })
      .filter((value): value is { id: string; label: string; slug: string } => value !== null)
    return { items, total: items.length }
  },
}

export const mediaTagsAiTools: CatalogAiToolDefinition[] = [listProductMediaTool, listProductTagsTool]

export default mediaTagsAiTools
