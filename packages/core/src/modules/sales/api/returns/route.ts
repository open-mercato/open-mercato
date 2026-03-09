import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { splitCustomFieldPayload } from '@open-mercato/shared/lib/crud/custom-fields'
import { withScopedPayload } from '../utils'
import { SalesReturn, SalesReturnLine } from '../../data/entities'
import { returnCreateSchema } from '../../data/validators'
import { E } from '#generated/entities.ids.generated'
import * as F from '#generated/entities/sales_return'
import { createPagedListResponseSchema } from '../openapi'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

const rawBodySchema = z.object({}).passthrough()

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(200).default(50),
    orderId: z.string().uuid().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['sales.returns.view'] },
  POST: { requireAuth: true, requireFeatures: ['sales.returns.create'] },
}

const toNumber = (value: unknown): number => {
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (!Number.isNaN(parsed)) return parsed
  }
  return 0
}

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: SalesReturn,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: {
    entityType: E.sales.sales_return,
  },
  list: {
    schema: listSchema,
    entityId: E.sales.sales_return,
    fields: [
      F.id,
      'order_id',
      F.return_number,
      F.status_entry_id,
      F.status,
      F.reason,
      F.notes,
      F.returned_at,
      F.created_at,
      F.updated_at,
    ],
    sortFieldMap: {
      createdAt: F.created_at,
      updatedAt: F.updated_at,
      returnedAt: F.returned_at,
    },
    buildFilters: async (query: Record<string, unknown>) => {
      const filters: Record<string, unknown> = {}
      if (typeof query.orderId === 'string' && query.orderId.length > 0) {
        filters.order_id = { $eq: query.orderId }
      }
      return filters
    },
  },
  actions: {
    create: {
      commandId: 'sales.returns.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const scoped = withScopedPayload(raw ?? {}, ctx, translate)
        const { base } = splitCustomFieldPayload(scoped)
        return returnCreateSchema.parse(base)
      },
      response: ({ result }) => ({ id: result?.returnId ?? null }),
      status: 201,
    },
  },
  hooks: {
    afterList: async (payload, ctx) => {
      const items = Array.isArray(payload.items) ? payload.items : []
      if (!items.length) return
      const returnIds = items
        .map((item: unknown) => (item && typeof item === 'object' ? (item as Record<string, unknown>).id : null))
        .filter((value: string | null): value is string => typeof value === 'string')
      if (!returnIds.length) return
      const em = ctx.container.resolve('em') as EntityManager
      const lines = await findWithDecryption(
        em,
        SalesReturnLine,
        { salesReturn: { $in: returnIds }, deletedAt: null },
        {},
        { tenantId: ctx.auth?.tenantId ?? null, organizationId: ctx.auth?.orgId ?? null },
      )
      const totals = lines.reduce<Map<string, { net: number; gross: number }>>((acc, line) => {
        const returnId = typeof line.salesReturn === 'string' ? line.salesReturn : line.salesReturn?.id ?? null
        if (!returnId) return acc
        const current = acc.get(returnId) ?? { net: 0, gross: 0 }
        current.net += toNumber(line.totalNetAmount)
        current.gross += toNumber(line.totalGrossAmount)
        acc.set(returnId, current)
        return acc
      }, new Map())
      items.forEach((item: unknown) => {
        if (!item || typeof item !== 'object') return
        const map = item as Record<string, unknown>
        const id = map.id
        if (typeof id !== 'string') return
        const sum = totals.get(id)
        if (!sum) return
        map['total_net_amount'] = sum.net
        map['total_gross_amount'] = sum.gross
      })
    },
  },
})

const { GET, POST } = crud

export { GET, POST }

const returnSchema = z
  .object({
    id: z.string().uuid(),
    order_id: z.string().uuid(),
    return_number: z.string(),
    status_entry_id: z.string().uuid().nullable().optional(),
    status: z.string().nullable().optional(),
    reason: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    returned_at: z.string().nullable().optional(),
    created_at: z.string(),
    updated_at: z.string(),
    total_net_amount: z.number().optional(),
    total_gross_amount: z.number().optional(),
  })
  .passthrough()

export const openApi: OpenApiRouteDoc = {
  tag: 'Sales',
  summary: 'Manage order returns',
  methods: {
    GET: {
      summary: 'List returns',
      query: listSchema,
      responses: [{ status: 200, description: 'Returns list', schema: createPagedListResponseSchema(returnSchema) }],
    },
    POST: {
      summary: 'Create return',
      requestBody: { schema: returnCreateSchema },
      responses: [{ status: 201, description: 'Return created', schema: z.object({ id: z.string().uuid().nullable() }) }],
    },
  },
}

