import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { parseScopedCommandInput, resolveCrudRecordId } from '@open-mercato/shared/lib/api/scoped'
import { E } from '#generated/entities.ids.generated'
import { ReceivingLine } from '../../data/entities'
import { receivingLineCreateSchema, receivingLineUpdateSchema } from '../../data/validators'
import { assertReceivingLineLifecycleFieldsForbidden } from '../../lib/asnReceiving'
import { createPagedListResponseSchema, createWmsCrudOpenApi, defaultOkResponseSchema } from '../openapi'

const F = {
  id: 'id',
  organization_id: 'organization_id',
  tenant_id: 'tenant_id',
  asn_id: 'asn_id',
  catalog_variant_id: 'catalog_variant_id',
  expected_qty: 'expected_qty',
  received_qty: 'received_qty',
  lot_number: 'lot_number',
  serial_numbers: 'serial_numbers',
  qc_status: 'qc_status',
  target_staging_location_id: 'target_staging_location_id',
  rejection_reason: 'rejection_reason',
  created_at: 'created_at',
  updated_at: 'updated_at',
} as const

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['wms.view'] },
  POST: { requireAuth: true, requireFeatures: ['wms.manage_asn'] },
  PUT: { requireAuth: true, requireFeatures: ['wms.manage_asn'] },
  DELETE: { requireAuth: true, requireFeatures: ['wms.manage_asn'] },
}

export const metadata = routeMetadata

const rawBodySchema = z.object({}).passthrough()

const listSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(25),
  ids: z.string().optional(),
  asnId: z.string().uuid().optional(),
  catalogVariantId: z.string().uuid().optional(),
  qcStatus: z.enum(['pending', 'passed', 'failed']).optional(),
  sortField: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
}).passthrough()

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: ReceivingLine,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: E.wms.receiving_line },
  list: {
    schema: listSchema,
    disableListCache: true,
    entityId: E.wms.receiving_line,
    fields: [
      F.id,
      F.organization_id,
      F.tenant_id,
      F.asn_id,
      F.catalog_variant_id,
      F.expected_qty,
      F.received_qty,
      F.lot_number,
      F.serial_numbers,
      F.qc_status,
      F.target_staging_location_id,
      F.rejection_reason,
      F.created_at,
      F.updated_at,
    ],
    sortFieldMap: {
      expectedQty: F.expected_qty,
      receivedQty: F.received_qty,
      qcStatus: F.qc_status,
      createdAt: F.created_at,
      updatedAt: F.updated_at,
    },
    buildFilters: async (query) => {
      const filters: Record<string, unknown> = {}
      if (typeof query.ids === 'string' && query.ids.trim().length > 0) {
        filters[F.id] = {
          $in: query.ids.split(',').map((value) => value.trim()).filter((value) => value.length > 0),
        }
      }
      if (typeof query.asnId === 'string' && query.asnId.length > 0) {
        filters[F.asn_id] = { $eq: query.asnId }
      }
      if (typeof query.catalogVariantId === 'string' && query.catalogVariantId.length > 0) {
        filters[F.catalog_variant_id] = { $eq: query.catalogVariantId }
      }
      if (typeof query.qcStatus === 'string' && query.qcStatus.length > 0) {
        filters[F.qc_status] = { $eq: query.qcStatus }
      }
      return filters
    },
  },
  actions: {
    create: {
      commandId: 'wms.receiving-lines.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(receivingLineCreateSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({ id: result?.lineId ?? null }),
      status: 201,
    },
    update: {
      commandId: 'wms.receiving-lines.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        assertReceivingLineLifecycleFieldsForbidden(raw)
        return parseScopedCommandInput(receivingLineUpdateSchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'wms.receiving-lines.delete',
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => {
        const { translate } = await resolveTranslations()
        return { id: resolveCrudRecordId(parsed, ctx, translate) }
      },
      response: () => ({ ok: true }),
    },
  },
})

export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE

const receivingLineListItemSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  organization_id: z.string().uuid().nullable().optional(),
  tenant_id: z.string().uuid().nullable().optional(),
  asn_id: z.string().uuid().nullable().optional(),
  catalog_variant_id: z.string().uuid().nullable().optional(),
  expected_qty: z.union([z.string(), z.number()]).nullable().optional(),
  received_qty: z.union([z.string(), z.number()]).nullable().optional(),
  lot_number: z.string().nullable().optional(),
  serial_numbers: z.array(z.string()).nullable().optional(),
  qc_status: z.string().nullable().optional(),
  target_staging_location_id: z.string().uuid().nullable().optional(),
  rejection_reason: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
})

export const openApi = createWmsCrudOpenApi({
  resourceName: 'ReceivingLine',
  pluralName: 'Receiving lines',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(receivingLineListItemSchema),
  create: {
    schema: receivingLineCreateSchema,
    description: 'Creates a receiving line against an ASN.',
  },
  update: {
    schema: receivingLineUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates a receiving line by id.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Soft-deletes a receiving line by id.',
  },
})
