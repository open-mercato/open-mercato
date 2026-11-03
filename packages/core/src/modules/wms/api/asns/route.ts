import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { parseScopedCommandInput, resolveCrudRecordId } from '@open-mercato/shared/lib/api/scoped'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { E } from '#generated/entities.ids.generated'
import { Asn } from '../../data/entities'
import { asnCreatePublicSchema, asnUpdateSchema } from '../../data/validators'
import { buildAsnStatusFilter } from '../../lib/asnReceiving'
import { attachVendorLabelsToListItems, attachWarehouseLabelsToListItems } from '../listEnrichers'
import { createPagedListResponseSchema, createWmsCrudOpenApi, defaultOkResponseSchema } from '../openapi'

const F = {
  id: 'id',
  organization_id: 'organization_id',
  tenant_id: 'tenant_id',
  warehouse_id: 'warehouse_id',
  vendor_id: 'vendor_id',
  status: 'status',
  expected_at: 'expected_at',
  reference_number: 'reference_number',
  notes: 'notes',
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
  search: z.string().optional(),
  ids: z.string().optional(),
  warehouseId: z.string().uuid().optional(),
  vendorId: z.string().uuid().optional(),
  // Single status or comma-separated (e.g. draft,in_transit for open receiving queue).
  status: z.string().optional(),
  sortField: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
}).passthrough()

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: Asn,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: E.wms.asn },
  list: {
    schema: listSchema,
    disableListCache: true,
    entityId: E.wms.asn,
    fields: [
      F.id,
      F.organization_id,
      F.tenant_id,
      F.warehouse_id,
      F.vendor_id,
      F.status,
      F.expected_at,
      F.reference_number,
      F.notes,
      F.created_at,
      F.updated_at,
    ],
    sortFieldMap: {
      status: F.status,
      expectedAt: F.expected_at,
      createdAt: F.created_at,
      updatedAt: F.updated_at,
      referenceNumber: F.reference_number,
    },
    buildFilters: async (query) => {
      const filters: Record<string, unknown> = {}
      if (typeof query.ids === 'string' && query.ids.trim().length > 0) {
        filters[F.id] = {
          $in: query.ids.split(',').map((value) => value.trim()).filter((value) => value.length > 0),
        }
      }
      if (typeof query.warehouseId === 'string' && query.warehouseId.length > 0) {
        filters[F.warehouse_id] = { $eq: query.warehouseId }
      }
      if (typeof query.vendorId === 'string' && query.vendorId.length > 0) {
        filters[F.vendor_id] = { $eq: query.vendorId }
      }
      if (typeof query.status === 'string' && query.status.length > 0) {
        const statusFilter = buildAsnStatusFilter(query.status)
        if (statusFilter) filters[F.status] = statusFilter
      }
      const term = query.search?.trim()
      if (term) {
        const like = `%${escapeLikePattern(term)}%`
        filters.$or = [
          { [F.reference_number]: { $ilike: like } },
          { [F.notes]: { $ilike: like } },
        ]
      }
      return filters
    },
  },
  hooks: {
    afterList: async (payload, ctx) => {
      await Promise.all([
        attachWarehouseLabelsToListItems(payload, ctx),
        attachVendorLabelsToListItems(payload, ctx),
      ])
    },
  },
  actions: {
    create: {
      commandId: 'wms.asns.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        // Public create strips sourceKey — procurement/system sets it via command with auth: null.
        return parseScopedCommandInput(asnCreatePublicSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({
        id: result?.asnId ?? null,
        lineIds: result?.lineIds ?? [],
      }),
      status: 201,
    },
    update: {
      commandId: 'wms.asns.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(asnUpdateSchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'wms.asns.delete',
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

const asnListItemSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  organization_id: z.string().uuid().nullable().optional(),
  tenant_id: z.string().uuid().nullable().optional(),
  warehouse_id: z.string().uuid().nullable().optional(),
  warehouse_name: z.string().nullable().optional(),
  warehouse_code: z.string().nullable().optional(),
  vendor_id: z.string().uuid().nullable().optional(),
  vendor_name: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  expected_at: z.string().nullable().optional(),
  reference_number: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
})

export const openApi = createWmsCrudOpenApi({
  resourceName: 'ASN',
  pluralName: 'ASNs',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(asnListItemSchema),
  create: {
    schema: asnCreatePublicSchema,
    description:
      'Creates an ASN with optional expected receiving lines. `sourceKey` is server-only (procurement/system path) and is not accepted on this public API.',
  },
  update: {
    schema: asnUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description:
      'Updates an ASN by id while status is draft or in_transit and no receiving line has receipt/QC activity. Received/closed ASNs, or ASNs with line receipt/QC activity, return 409 invalid_receipt_state (status demotion and warehouse/header changes are not allowed). Status may only be set to draft or in_transit; received/closed are set via receive/complete flows.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Soft-deletes an ASN by id.',
  },
})
