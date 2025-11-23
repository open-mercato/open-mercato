import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { buildCustomFieldFiltersFromQuery, extractAllCustomFieldEntries } from '@open-mercato/shared/lib/crud/custom-fields'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CatalogProduct, CatalogProductVariant } from '../../data/entities'
import { variantCreateSchema, variantUpdateSchema } from '../../data/validators'
import { parseScopedCommandInput, resolveCrudRecordId } from '../utils'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import * as FV from '@open-mercato/core/generated/entities/catalog_product_variant'
import { parseBooleanFlag, sanitizeSearchTerm } from '../helpers'

const rawBodySchema = z.object({}).passthrough()

const SENTINEL_ID_VALUES = new Set(['', 'create', 'new', 'null', 'undefined'])

export function stripPlaceholderId(source: Record<string, unknown>): void {
  if (!Object.prototype.hasOwnProperty.call(source, 'id')) return
  const value = source.id
  if (value === undefined || value === null) {
    delete source.id
    return
  }
  if (typeof value === 'string') {
    const raw = value.trim()
    if (!raw || SENTINEL_ID_VALUES.has(raw.toLowerCase())) {
      delete source.id
    } else {
      source.id = raw
    }
  }
}

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    id: z.string().uuid().optional(),
    search: z.string().optional(),
    productId: z.string().uuid().optional(),
    sku: z.string().optional(),
    isActive: z.string().optional(),
    isDefault: z.string().optional(),
    withDeleted: z.coerce.boolean().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

type VariantQuery = z.infer<typeof listSchema>

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['catalog.products.view'] },
  POST: { requireAuth: true, requireFeatures: ['catalog.variants.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['catalog.variants.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['catalog.variants.manage'] },
}

export const metadata = routeMetadata

export async function buildVariantFilters(
  query: VariantQuery
): Promise<Record<string, unknown>> {
  const filters: Record<string, unknown> = {}
  const term = sanitizeSearchTerm(query.search)
  if (query.id) {
    filters.id = { $eq: query.id }
  }
  if (term) {
    const like = `%${term}%`
    filters.$or = [
      { name: { $ilike: like } },
      { sku: { $ilike: like } },
      { barcode: { $ilike: like } },
    ]
  }
  if (query.productId) {
    filters.product_id = { $eq: query.productId }
  }
  if (query.sku && query.sku.trim()) {
    filters.sku = { $eq: query.sku.trim() }
  }
  const isActive = parseBooleanFlag(query.isActive)
  if (isActive !== undefined) filters.is_active = isActive
  const isDefault = parseBooleanFlag(query.isDefault)
  if (isDefault !== undefined) filters.is_default = isDefault
  return filters
}

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: CatalogProductVariant,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  list: {
    schema: listSchema,
    entityId: E.catalog.catalog_product_variant,
    fields: [
      FV.id,
      'product_id',
      FV.name,
      FV.sku,
      FV.barcode,
      FV.status_entry_id,
      FV.is_default,
      FV.is_active,
      FV.weight_value,
      FV.weight_unit,
      FV.dimensions,
      FV.metadata,
      FV.option_values,
      'custom_fieldset_code',
      FV.created_at,
      FV.updated_at,
    ],
    sortFieldMap: {
      name: FV.name,
      sku: FV.sku,
      createdAt: FV.created_at,
      updatedAt: FV.updated_at,
    },
    buildFilters: async (query, ctx) => {
      const filters = await buildVariantFilters(query)
      const tenantId = ctx.auth?.tenantId ?? null
      try {
        const em = ctx.container.resolve('em') as EntityManager
        const cfFilters = await buildCustomFieldFiltersFromQuery({
          entityIds: [E.catalog.catalog_product_variant],
          query,
          em,
          tenantId,
        })
        Object.assign(filters, cfFilters)
      } catch {
        // ignore
      }
      return filters
    },
    transformItem: (item: any) => {
      if (!item) return item
      const normalized = { ...item }
      const cfEntries = extractAllCustomFieldEntries(item)
      for (const key of Object.keys(normalized)) {
        if (key.startsWith('cf:')) delete normalized[key]
      }
      return { ...normalized, ...cfEntries }
    },
  },
  actions: {
    create: {
      commandId: 'catalog.variants.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const payload =
          raw && typeof raw === 'object'
            ? { ...(raw as Record<string, unknown>) }
            : ({} as Record<string, unknown>)
        stripPlaceholderId(payload)
        const productId = typeof payload.productId === 'string' ? payload.productId : null
        if (productId) {
          try {
            const em = ctx.container.resolve('em') as EntityManager
            const product = await em.findOne(
              CatalogProduct,
              { id: productId, deletedAt: null },
              { fields: ['id', 'organizationId', 'tenantId'] }
            )
            if (product) {
              payload.organizationId = product.organizationId
              payload.tenantId = product.tenantId
            }
          } catch {
            // Scope hints are best-effort; command will enforce access
          }
        }
        return parseScopedCommandInput(variantCreateSchema, payload, ctx, translate)
      },
      response: ({ result }) => ({ id: result?.variantId ?? result?.id ?? null }),
      status: 201,
    },
    update: {
      commandId: 'catalog.variants.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const payload =
          raw && typeof raw === 'object'
            ? { ...(raw as Record<string, unknown>) }
            : ({} as Record<string, unknown>)
        stripPlaceholderId(payload)
        const variantId = typeof payload.id === 'string' ? payload.id : null
        if (variantId) {
          try {
            const em = ctx.container.resolve('em') as EntityManager
            const variant = await em.findOne(
              CatalogProductVariant,
              { id: variantId, deletedAt: null },
              { fields: ['id', 'organizationId', 'tenantId'] }
            )
            if (variant) {
              payload.organizationId = variant.organizationId
              payload.tenantId = variant.tenantId
            }
          } catch {
            // Ignore prefetch failures; command layer validates access
          }
        }
        return parseScopedCommandInput(variantUpdateSchema, payload, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'catalog.variants.delete',
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => {
        const { translate } = await resolveTranslations()
        const id = resolveCrudRecordId(parsed, ctx, translate)
        if (!id) throw new CrudHttpError(400, { error: translate('catalog.errors.id_required', 'Variant id is required.') })
        return { id }
      },
      response: () => ({ ok: true }),
    },
  },
})

export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE
