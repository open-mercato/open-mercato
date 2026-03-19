import { z } from 'zod'
import { makeCrudRoute, type CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  buildCustomFieldFiltersFromQuery,
  extractAllCustomFieldEntries,
} from '@open-mercato/shared/lib/crud/custom-fields'
import {
  canonicalizeUnitCode,
  REFERENCE_UNIT_CODES,
} from '@open-mercato/shared/lib/units/unitCodes'
import {
  createPagedListResponseSchema,
  createSalesCrudOpenApi,
  defaultOkResponseSchema,
} from '../api/openapi'
import { withScopedPayload } from '../api/utils'

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- MikroORM entity class constructor
type EntityClass = new (...args: any[]) => unknown

interface SalesLineRouteConfig {
  entity: EntityClass
  entityId: string
  fieldConstants: Record<string, string>
  parentFkColumn: string
  parentFkParam: string
  createSchema: z.ZodObject<z.ZodRawShape>
  features: { view: string; manage: string }
  commandPrefix: string
  openApi: {
    resourceName: string
    description: string
  }
}

const rawBodySchema = z.object({}).passthrough()

function resolveRawBody(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') return {}
  if ('body' in raw) {
    const payload = raw as { body?: unknown }
    if (payload.body && typeof payload.body === 'object') {
      return payload.body as Record<string, unknown>
    }
  }
  return raw as Record<string, unknown>
}

function transformItem(item: Record<string, unknown> | null | undefined) {
  if (!item) return item
  const normalized = { ...item }
  const cfEntries = extractAllCustomFieldEntries(item)
  for (const key of Object.keys(normalized)) {
    if (key.startsWith('cf:')) delete normalized[key]
  }
  const quantityUnit = canonicalizeUnitCode(
    normalized['quantity_unit'] ?? normalized['quantityUnit'],
  )
  const normalizedUnit =
    canonicalizeUnitCode(
      normalized['normalized_unit'] ?? normalized['normalizedUnit'],
    ) ?? quantityUnit
  return {
    ...normalized,
    quantity_unit: quantityUnit,
    normalized_unit: normalizedUnit,
    ...cfEntries,
  }
}

const uomSnapshotOpenApiSchema = z
  .object({
    version: z.literal(1),
    productId: z.string().nullable(),
    productVariantId: z.string().nullable(),
    baseUnitCode: z.string().nullable(),
    enteredUnitCode: z.string().nullable(),
    enteredQuantity: z.string(),
    toBaseFactor: z.string(),
    normalizedQuantity: z.string(),
    rounding: z.object({
      mode: z.enum(['half_up', 'down', 'up']),
      scale: z.number().int(),
    }),
    source: z.object({
      conversionId: z.string().nullable(),
      resolvedAt: z.string(),
    }),
    unitPriceReference: z
      .object({
        enabled: z.boolean(),
        referenceUnitCode: z.enum(REFERENCE_UNIT_CODES).nullable(),
        baseQuantity: z.string().nullable(),
        grossPerReference: z.string().nullable().optional(),
        netPerReference: z.string().nullable().optional(),
      })
      .optional(),
  })
  .nullable()
  .optional()

export function makeSalesLineRoute(config: SalesLineRouteConfig) {
  const {
    entity,
    entityId,
    fieldConstants: F,
    parentFkColumn,
    parentFkParam,
    createSchema,
    features,
    commandPrefix,
  } = config

  const listSchema = z
    .object({
      page: z.coerce.number().min(1).default(1),
      pageSize: z.coerce.number().min(1).max(100).default(50),
      id: z.string().uuid().optional(),
      [parentFkParam]: z.string().uuid().optional(),
      sortField: z.string().optional(),
      sortDir: z.enum(['asc', 'desc']).optional(),
    })
    .passthrough()

  const upsertSchema = createSchema.extend({
    id: z.string().uuid().optional(),
  })

  const deleteSchema = z.object({
    id: z.string().uuid(),
    [parentFkParam]: z.string().uuid(),
  })

  const routeMetadata = {
    GET: { requireAuth: true, requireFeatures: [features.view] },
    POST: { requireAuth: true, requireFeatures: [features.manage] },
    PUT: { requireAuth: true, requireFeatures: [features.manage] },
    DELETE: { requireAuth: true, requireFeatures: [features.manage] },
  }

  const crud = makeCrudRoute({
    metadata: routeMetadata,
    orm: {
      entity,
      idField: 'id',
      orgField: 'organizationId',
      tenantField: 'tenantId',
      softDeleteField: 'deletedAt',
    },
    indexer: {
      entityType: entityId,
    },
    enrichers: {
      entityId,
    },
    list: {
      schema: listSchema,
      entityId,
      fields: (() => {
        const fields: string[] = [
          F.id,
          parentFkColumn,
          F.line_number,
          F.kind,
          F.status_entry_id,
          F.status,
          F.product_id,
          F.product_variant_id,
          F.catalog_snapshot,
          F.name,
          F.description,
          F.comment,
          F.organization_id,
          F.tenant_id,
          F.quantity,
          F.quantity_unit,
          F.normalized_quantity,
          F.normalized_unit,
          F.uom_snapshot,
          F.currency_code,
          F.unit_price_net,
          F.unit_price_gross,
          F.discount_amount,
          F.discount_percent,
          F.tax_rate,
          F.tax_amount,
          F.total_net_amount,
          F.total_gross_amount,
          F.configuration,
          F.promotion_code,
          F.promotion_snapshot,
          F.metadata,
          F.custom_field_set_id,
          F.created_at,
          F.updated_at,
        ]
        const returnedQuantity = F['returned_quantity']
        if (typeof returnedQuantity === 'string') fields.push(returnedQuantity)
        return fields
      })(),
      sortFieldMap: {
        createdAt: F.created_at,
        updatedAt: F.updated_at,
        lineNumber: F.line_number,
      },
      buildFilters: async (query: Record<string, unknown>, ctx: CrudCtx) => {
        const filters: Record<string, unknown> = {}
        if (query.id) filters.id = { $eq: query.id }
        if (query[parentFkParam]) filters[parentFkColumn] = { $eq: query[parentFkParam] }
        try {
          const em = ctx.container.resolve('em')
          const cfFilters = await buildCustomFieldFiltersFromQuery({
            entityId,
            query,
            em,
            tenantId: ctx.auth?.tenantId ?? null,
          })
          Object.assign(filters, cfFilters)
        } catch {
          // ignore
        }
        return filters
      },
      transformItem,
    },
    actions: {
      create: {
        commandId: `${commandPrefix}.upsert`,
        schema: rawBodySchema,
        mapInput: async ({ raw, ctx }: { raw: unknown; ctx: CrudCtx }) => {
          const { translate } = await resolveTranslations()
          const payload = upsertSchema.parse(
            withScopedPayload(resolveRawBody(raw) ?? {}, ctx, translate),
          )
          return { body: payload }
        },
        response: ({ result }: { result: Record<string, unknown> | null }) => ({
          id: result?.lineId ?? null,
          [parentFkParam]: result?.[parentFkParam] ?? null,
        }),
        status: 201,
      },
      update: {
        commandId: `${commandPrefix}.upsert`,
        schema: rawBodySchema,
        mapInput: async ({ raw, ctx }: { raw: unknown; ctx: CrudCtx }) => {
          const { translate } = await resolveTranslations()
          const payload = upsertSchema.parse(
            withScopedPayload(resolveRawBody(raw) ?? {}, ctx, translate),
          )
          return { body: payload }
        },
        response: ({ result }: { result: Record<string, unknown> | null }) => ({
          id: result?.lineId ?? null,
          [parentFkParam]: result?.[parentFkParam] ?? null,
        }),
      },
      delete: {
        commandId: `${commandPrefix}.delete`,
        schema: rawBodySchema,
        mapInput: async ({ raw, ctx }: { raw: unknown; ctx: CrudCtx }) => {
          const { translate } = await resolveTranslations()
          const payload = deleteSchema.parse(
            withScopedPayload(resolveRawBody(raw) ?? {}, ctx, translate),
          )
          if (!payload.id || !payload[parentFkParam]) {
            throw new CrudHttpError(400, {
              error: translate(
                'sales.documents.detail.error',
                'Document not found or inaccessible.',
              ),
            })
          }
          return { body: payload }
        },
        response: () => ({ ok: true }),
      },
    },
  })

  const lineItemSchema = z.object({
    id: z.string().uuid(),
    [parentFkColumn]: z.string().uuid(),
    line_number: z.number(),
    kind: z.string(),
    status_entry_id: z.string().uuid().nullable().optional(),
    status: z.string().nullable().optional(),
    product_id: z.string().uuid().nullable().optional(),
    product_variant_id: z.string().uuid().nullable().optional(),
    catalog_snapshot: z.record(z.string(), z.unknown()).nullable().optional(),
    name: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    comment: z.string().nullable().optional(),
    quantity: z.number(),
    quantity_unit: z.string().nullable().optional(),
    normalized_quantity: z.number(),
    normalized_unit: z.string().nullable().optional(),
    uom_snapshot: uomSnapshotOpenApiSchema,
    currency_code: z.string(),
    unit_price_net: z.number(),
    unit_price_gross: z.number(),
    discount_amount: z.number(),
    discount_percent: z.number(),
    tax_rate: z.number(),
    tax_amount: z.number(),
    total_net_amount: z.number(),
    total_gross_amount: z.number(),
    configuration: z.record(z.string(), z.unknown()).nullable().optional(),
    promotion_code: z.string().nullable().optional(),
    promotion_snapshot: z.record(z.string(), z.unknown()).nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).nullable().optional(),
    custom_field_set_id: z.string().uuid().nullable().optional(),
    created_at: z.string(),
    updated_at: z.string(),
  })

  const upsertResponseSchema = z.object({
    id: z.string().uuid().nullable(),
    [parentFkParam]: z.string().uuid().nullable(),
  })

  const openApi = createSalesCrudOpenApi({
    resourceName: config.openApi.resourceName,
    querySchema: listSchema,
    listResponseSchema: createPagedListResponseSchema(lineItemSchema),
    create: {
      schema: upsertSchema,
      responseSchema: upsertResponseSchema,
      description: `Creates ${config.openApi.description}.`,
    },
    update: {
      schema: upsertSchema,
      responseSchema: upsertResponseSchema,
      description: `Updates ${config.openApi.description}.`,
    },
    del: {
      schema: deleteSchema,
      responseSchema: defaultOkResponseSchema,
      description: `Deletes ${config.openApi.description}.`,
    },
  })

  return {
    metadata: routeMetadata,
    openApi,
    GET: crud.GET,
    POST: crud.POST,
    PUT: crud.PUT,
    DELETE: crud.DELETE,
  }
}
