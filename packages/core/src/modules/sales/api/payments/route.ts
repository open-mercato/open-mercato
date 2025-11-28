import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { SalesPayment, SalesPaymentMethod } from '../../data/entities'
import { paymentCreateSchema, paymentUpdateSchema } from '../../data/validators'
import { withScopedPayload } from '../utils'
import {
  createPagedListResponseSchema,
  createSalesCrudOpenApi,
} from '../openapi'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import * as F from '@open-mercato/core/generated/entities/sales_payment'

const rawBodySchema = z.object({}).passthrough()

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    orderId: z.string().uuid().optional(),
    paymentMethodId: z.string().uuid().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['sales.orders.view'] },
  POST: { requireAuth: true, requireFeatures: ['sales.payments.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['sales.payments.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['sales.payments.manage'] },
}

const deleteSchema = paymentUpdateSchema.pick({
  id: true,
  organizationId: true,
  tenantId: true,
  orderId: true,
})

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: SalesPayment,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  list: {
    schema: listSchema,
    entityId: E.sales.sales_payment,
    fields: [
      F.id,
      'order_id',
      'payment_method_id',
      F.payment_reference,
      F.status_entry_id,
      F.status,
      F.amount,
      F.currency_code,
      F.captured_amount,
      F.refunded_amount,
      F.received_at,
      F.captured_at,
      F.metadata,
      F.created_at,
      F.updated_at,
    ],
    sortFieldMap: {
      createdAt: F.created_at,
      updatedAt: F.updated_at,
      receivedAt: F.received_at,
      amount: F.amount,
    },
    buildFilters: async (query: any) => {
      const filters: Record<string, any> = {}
      if (query.orderId) filters.order_id = { $eq: query.orderId }
      if (query.paymentMethodId) filters.payment_method_id = { $eq: query.paymentMethodId }
      return filters
    },
  },
  actions: {
    create: {
      commandId: 'sales.payments.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return paymentCreateSchema.parse(withScopedPayload(raw ?? {}, ctx, translate))
      },
      response: ({ result }) => ({
        id: result?.paymentId ?? null,
        orderTotals: result?.orderTotals ?? null,
      }),
      status: 201,
    },
    update: {
      commandId: 'sales.payments.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return paymentUpdateSchema.parse(withScopedPayload(raw ?? {}, ctx, translate))
      },
      response: ({ result }) => ({
        id: result?.paymentId ?? null,
        orderTotals: result?.orderTotals ?? null,
      }),
    },
    delete: {
      commandId: 'sales.payments.delete',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const payload = deleteSchema.parse(withScopedPayload(raw ?? {}, ctx, translate))
        if (!payload.id) {
          throw new CrudHttpError(400, {
            error: translate('sales.payments.not_found', 'Payment not found.'),
          })
        }
        return payload
      },
      response: ({ result }) => ({
        id: result?.paymentId ?? null,
        orderTotals: result?.orderTotals ?? null,
      }),
    },
  },
  hooks: {
    afterList: async (payload, ctx) => {
      const items = Array.isArray(payload.items) ? payload.items : []
      if (!items.length) return
      const methodIds: string[] = Array.from(
        new Set(
          items
            .map((item: unknown) =>
              item && typeof item === 'object' && typeof (item as any).payment_method_id === 'string'
                ? ((item as any).payment_method_id as string)
                : null
            )
            .filter((value: string | null): value is string => typeof value === 'string' && value.length > 0)
        )
      )
      if (!methodIds.length) return
      const em = ctx.container.resolve('em') as EntityManager
      const methods = await em.find(SalesPaymentMethod, { id: { $in: methodIds } })
      const map = new Map(methods.map((method) => [method.id, method]))
      items.forEach((item: unknown) => {
        if (!item || typeof item !== 'object') return
        const id = (item as Record<string, unknown>).payment_method_id
        const method = typeof id === 'string' ? map.get(id) : null
        if (method) {
          ;(item as Record<string, unknown>).payment_method_name = method.name ?? method.code ?? method.id
          ;(item as Record<string, unknown>).payment_method_code = method.code ?? null
        }
      })
    },
  },
})

const { GET, POST, PUT, DELETE } = crud

export { GET, POST, PUT, DELETE }

const paymentSchema = z.object({
  id: z.string().uuid(),
  order_id: z.string().uuid().nullable().optional(),
  payment_method_id: z.string().uuid().nullable().optional(),
  payment_method_name: z.string().nullable().optional(),
  payment_method_code: z.string().nullable().optional(),
  payment_reference: z.string().nullable().optional(),
  status_entry_id: z.string().uuid().nullable().optional(),
  status: z.string().nullable().optional(),
  amount: z.number(),
  currency_code: z.string(),
  captured_amount: z.number().nullable().optional(),
  refunded_amount: z.number().nullable().optional(),
  received_at: z.string().nullable().optional(),
  captured_at: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  created_at: z.string(),
  updated_at: z.string().nullable().optional(),
})

const orderTotalsSchema = z.object({
  paidTotalAmount: z.number().nullable().optional(),
  refundedTotalAmount: z.number().nullable().optional(),
  outstandingAmount: z.number().nullable().optional(),
})

const paymentActionResponseSchema = z.object({
  id: z.string().uuid().nullable(),
  orderTotals: orderTotalsSchema.nullable().optional(),
})

export const openApi = createSalesCrudOpenApi({
  resourceName: 'Payment',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(paymentSchema),
  create: {
    schema: paymentCreateSchema,
    responseSchema: paymentActionResponseSchema,
    description: 'Creates a payment for a sales order.',
  },
  update: {
    schema: paymentUpdateSchema,
    responseSchema: paymentActionResponseSchema,
    description: 'Updates a payment.',
  },
  del: {
    schema: deleteSchema.pick({ id: true }),
    responseSchema: paymentActionResponseSchema,
    description: 'Deletes a payment.',
  },
})

export const metadata = routeMetadata
