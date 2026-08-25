import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { parseScopedCommandInput, resolveCrudRecordId } from '@open-mercato/shared/lib/api/scoped'
import { E } from '#generated/entities.ids.generated'
import { PutawayTask } from '../../data/entities'
import { putawayTaskCreateSchema, putawayTaskUpdateSchema } from '../../data/validators'
import {
  assertPutawayLifecycleFieldsForbidden,
  buildPutawayTaskStatusFilter,
} from '../../lib/putaway'
import { createPagedListResponseSchema, createWmsCrudOpenApi, defaultOkResponseSchema } from '../openapi'

const F = {
  id: 'id',
  organization_id: 'organization_id',
  tenant_id: 'tenant_id',
  warehouse_id: 'warehouse_id',
  source_location_id: 'source_location_id',
  target_location_id: 'target_location_id',
  catalog_variant_id: 'catalog_variant_id',
  lot_id: 'lot_id',
  quantity: 'quantity',
  status: 'status',
  assigned_to: 'assigned_to',
  priority: 'priority',
  created_at: 'created_at',
  updated_at: 'updated_at',
} as const

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['wms.view'] },
  POST: { requireAuth: true, requireFeatures: ['wms.manage_putaway'] },
  PUT: { requireAuth: true, requireFeatures: ['wms.manage_putaway'] },
  DELETE: { requireAuth: true, requireFeatures: ['wms.manage_putaway'] },
}

export const metadata = routeMetadata

const rawBodySchema = z.object({}).passthrough()

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(25),
    ids: z.string().optional(),
    warehouseId: z.string().uuid().optional(),
    // Single status or comma-separated (e.g. open,in_progress for the active queue).
    status: z.string().optional(),
    assignedTo: z.string().uuid().optional(),
    catalogVariantId: z.string().uuid().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: PutawayTask,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: E.wms.putaway_task },
  list: {
    schema: listSchema,
    disableListCache: true,
    entityId: E.wms.putaway_task,
    fields: [
      F.id,
      F.organization_id,
      F.tenant_id,
      F.warehouse_id,
      F.source_location_id,
      F.target_location_id,
      F.catalog_variant_id,
      F.lot_id,
      F.quantity,
      F.status,
      F.assigned_to,
      F.priority,
      F.created_at,
      F.updated_at,
    ],
    sortFieldMap: {
      status: F.status,
      priority: F.priority,
      createdAt: F.created_at,
      updatedAt: F.updated_at,
      quantity: F.quantity,
    },
    buildFilters: async (query) => {
      const filters: Record<string, unknown> = {}
      if (typeof query.ids === 'string' && query.ids.trim().length > 0) {
        filters[F.id] = {
          $in: query.ids
            .split(',')
            .map((value) => value.trim())
            .filter((value) => value.length > 0),
        }
      }
      if (typeof query.warehouseId === 'string' && query.warehouseId.length > 0) {
        filters[F.warehouse_id] = { $eq: query.warehouseId }
      }
      if (typeof query.status === 'string' && query.status.length > 0) {
        const statusFilter = buildPutawayTaskStatusFilter(query.status)
        if (statusFilter) filters[F.status] = statusFilter
      }
      if (typeof query.assignedTo === 'string' && query.assignedTo.length > 0) {
        filters[F.assigned_to] = { $eq: query.assignedTo }
      }
      if (typeof query.catalogVariantId === 'string' && query.catalogVariantId.length > 0) {
        filters[F.catalog_variant_id] = { $eq: query.catalogVariantId }
      }
      return filters
    },
  },
  actions: {
    create: {
      commandId: 'wms.putaway-tasks.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(putawayTaskCreateSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({ id: result?.taskId ?? null }),
      status: 201,
    },
    update: {
      commandId: 'wms.putaway-tasks.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        assertPutawayLifecycleFieldsForbidden(raw)
        return parseScopedCommandInput(putawayTaskUpdateSchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'wms.putaway-tasks.delete',
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

const putawayTaskListItemSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  organization_id: z.string().uuid().nullable().optional(),
  tenant_id: z.string().uuid().nullable().optional(),
  warehouse_id: z.string().uuid().nullable().optional(),
  source_location_id: z.string().uuid().nullable().optional(),
  target_location_id: z.string().uuid().nullable().optional(),
  catalog_variant_id: z.string().uuid().nullable().optional(),
  lot_id: z.string().uuid().nullable().optional(),
  quantity: z.union([z.string(), z.number()]).nullable().optional(),
  status: z.string().nullable().optional(),
  assigned_to: z.string().uuid().nullable().optional(),
  priority: z.union([z.string(), z.number()]).nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
})

export const openApi = createWmsCrudOpenApi({
  resourceName: 'PutawayTask',
  pluralName: 'Putaway tasks',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(putawayTaskListItemSchema),
  create: {
    schema: putawayTaskCreateSchema,
    description:
      'Creates an open putaway task after verifying available staging balance (on-hand minus reserved/allocated minus open/in-progress putaway commitments). Target location may be null until completion. Assignee changes use POST .../assign.',
  },
  update: {
    schema: putawayTaskUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description:
      'Updates putaway task fields (locations, quantity, priority, metadata). Status and assignedTo are lifecycle-only — use POST .../{assign,start,complete,cancel}.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Soft-deletes a putaway task by id.',
  },
})
