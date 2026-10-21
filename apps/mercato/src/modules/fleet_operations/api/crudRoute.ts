import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { parseScopedCommandInput, resolveCrudRecordId } from '@open-mercato/shared/lib/api/scoped'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { Where } from '@open-mercato/shared/lib/query/types'

const rawBodySchema = z.object({}).passthrough()

export type OperationsResourceDescriptor = {
  entity: unknown
  entityId: string
  resource: string
  fields: string[]
  sortFieldMap: Record<string, string>
  buildExtraFilters?: (query: Record<string, unknown>) => Record<string, unknown>
  transformItem?: (item: Record<string, unknown>) => Record<string, unknown>
}

const commonListSchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    id: z.string().uuid().optional(),
    vehicleId: z.string().uuid().optional(),
    status: z.string().optional(),
    workOrderId: z.string().uuid().optional(),
    dateFrom: z.string().optional(),
    dateTo: z.string().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

export const operationsListSchema = commonListSchema

export function buildOperationsCrudRoute(descriptor: OperationsResourceDescriptor) {
  return makeCrudRoute({
    metadata: {
      GET: { requireAuth: true, requireFeatures: ['fleet.read'] },
      POST: { requireAuth: true, requireFeatures: ['fleet.write'] },
      PUT: { requireAuth: true, requireFeatures: ['fleet.write'] },
      DELETE: { requireAuth: true, requireFeatures: ['fleet.write'] },
    },
    orm: {
      entity: descriptor.entity as never,
      idField: 'id',
      orgField: 'organizationId',
      tenantField: 'tenantId',
      softDeleteField: 'deletedAt',
    },
    indexer: { entityType: descriptor.entityId },
    list: {
      schema: commonListSchema,
      entityId: descriptor.entityId,
      fields: descriptor.fields,
      sortFieldMap: descriptor.sortFieldMap,
      buildFilters: async (query): Promise<Where<Record<string, unknown>>> => {
        const filters: Record<string, unknown> = {}
        if (query.id) filters.id = { $eq: query.id }
        if (query.vehicleId) filters.vehicle_id = { $eq: query.vehicleId }
        if (query.status) filters.status = { $eq: query.status }
        if (query.workOrderId) filters.work_order_id = { $eq: query.workOrderId }
        if (query.dateFrom) filters.created_at = { ...(filters.created_at as object ?? {}), $gte: new Date(String(query.dateFrom)) }
        if (query.dateTo) filters.created_at = { ...(filters.created_at as object ?? {}), $lte: new Date(String(query.dateTo)) }
        Object.assign(filters, descriptor.buildExtraFilters?.(query) ?? {})
        return filters as Where<Record<string, unknown>>
      },
      transformItem: (item) => ({
        ...item,
        ...(descriptor.transformItem ? descriptor.transformItem(item) : {}),
        updatedAt: item.updated_at ?? null,
      }),
    },
    actions: {
      create: {
        commandId: `fleet_operations.${descriptor.resource}.create`,
        schema: rawBodySchema,
        mapInput: async ({ raw, ctx }) => {
          const { translate } = await resolveTranslations()
          return parseScopedCommandInput(rawBodySchema, raw ?? {}, ctx, translate)
        },
        response: ({ result }) => ({
          id: (result as { id?: string } | null)?.id ?? null,
          updatedAt: (result as { updatedAt?: Date } | null)?.updatedAt?.toISOString?.() ?? null,
        }),
        status: 201,
      },
      update: {
        commandId: `fleet_operations.${descriptor.resource}.update`,
        schema: rawBodySchema,
        mapInput: async ({ raw, ctx }) => {
          const { translate } = await resolveTranslations()
          return parseScopedCommandInput(rawBodySchema, raw ?? {}, ctx, translate)
        },
        response: () => ({ ok: true }),
      },
      delete: {
        commandId: `fleet_operations.${descriptor.resource}.delete`,
        schema: rawBodySchema,
        mapInput: async ({ parsed, ctx }) => {
          const { translate } = await resolveTranslations()
          return { id: resolveCrudRecordId(parsed, ctx, translate) }
        },
        response: () => ({ ok: true }),
      },
    },
  })
}
