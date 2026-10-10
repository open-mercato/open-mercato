import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { FreightTripAbstract, ABSTRACT_STATUSES, ABSTRACT_APPROVAL_MODES } from '../../data/entities'
import { withOrConditions } from '../../lib/crudFilters'
import { createPagedListResponseSchema, createFreightCrudOpenApi } from '../openapi'
import { FREIGHT_ABSTRACT_ENTITY_ID } from '../../commands/entities'

/**
 * Trip abstracts are generated, never created by hand, so this route is the
 * read side only: the list screen (with its filters) and the detail screen,
 * which loads one abstract by `id`. The lifecycle verbs live on their own
 * routes under `/abstracts/<action>`.
 */
const listSchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    id: z.string().uuid().optional(),
    ids: z.string().optional(),
    status: z.enum(ABSTRACT_STATUSES).optional(),
    approvalMode: z.enum(ABSTRACT_APPROVAL_MODES).optional(),
    contractId: z.string().uuid().optional(),
    customerId: z.string().uuid().optional(),
    periodFrom: z.string().optional(),
    periodTo: z.string().optional(),
    search: z.string().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['freight.read'] },
}
export const metadata = { path: '/freight_operations/abstracts', ...routeMetadata }

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: { entity: FreightTripAbstract, idField: 'id', orgField: 'organizationId', tenantField: 'tenantId', softDeleteField: 'deletedAt' },
  indexer: { entityType: FREIGHT_ABSTRACT_ENTITY_ID },
  list: {
    schema: listSchema,
    entityId: FREIGHT_ABSTRACT_ENTITY_ID,
    fields: [
      'id', 'organization_id', 'tenant_id', 'abstract_number', 'contract_id', 'customer_id', 'customer_snapshot',
      'period_from', 'period_to', 'billing_cycle_snapshot', 'currency_code', 'vat_rate',
      'status', 'requires_customer_approval', 'approval_mode', 'trip_count',
      'subtotal_net_amount', 'tax_total_amount', 'grand_total_gross_amount',
      'submitted_at', 'submitted_by', 'customer_approved_at', 'offline_approved_at', 'offline_approval_reference',
      'staff_finalized_at', 'staff_finalize_note', 'disputed_at', 'resolved_at',
      'cancelled_at', 'cancellation_reason',
      'sales_order_id', 'sales_invoice_id', 'sales_invoice_number', 'invoice_issued_at', 'due_date',
      'paid_total_amount', 'outstanding_amount', 'notes',
      'created_at', 'updated_at',
    ],
    sortFieldMap: {
      abstractNumber: 'abstract_number',
      periodFrom: 'period_from',
      periodTo: 'period_to',
      status: 'status',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    buildFilters: (query) =>
      withOrConditions(
        {
          ...(query.id ? { id: { $eq: query.id } } : {}),
          ...(query.ids ? { id: { $in: query.ids.split(',').map((value) => value.trim()).filter(Boolean) } } : {}),
          ...(query.status ? { status: { $eq: query.status } } : {}),
          ...(query.approvalMode ? { approval_mode: { $eq: query.approvalMode } } : {}),
          ...(query.contractId ? { contract_id: { $eq: query.contractId } } : {}),
          ...(query.customerId ? { customer_id: { $eq: query.customerId } } : {}),
          ...(query.periodFrom ? { period_to: { $gte: query.periodFrom } } : {}),
          ...(query.periodTo ? { period_from: { $lte: query.periodTo } } : {}),
        },
        query.search
          ? [
              {
                $or: [
                  { abstract_number: { $ilike: `%${escapeLikePattern(query.search)}%` } },
                  { sales_invoice_number: { $ilike: `%${escapeLikePattern(query.search)}%` } },
                ],
              },
            ]
          : [],
      ),
    transformItem: (item) => ({ ...item, updatedAt: item.updated_at ?? null }),
  },
})

export const GET = crud.GET

const abstractListItemSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  abstract_number: z.string(),
  contract_id: z.string().uuid(),
  customer_id: z.string().uuid(),
  customer_snapshot: z.record(z.string(), z.unknown()).nullable().optional(),
  period_from: z.string(),
  period_to: z.string(),
  billing_cycle_snapshot: z.string().nullable().optional(),
  currency_code: z.string(),
  vat_rate: z.string(),
  status: z.enum(ABSTRACT_STATUSES),
  requires_customer_approval: z.boolean(),
  approval_mode: z.enum(ABSTRACT_APPROVAL_MODES).nullable().optional(),
  trip_count: z.number(),
  subtotal_net_amount: z.string(),
  tax_total_amount: z.string(),
  grand_total_gross_amount: z.string(),
  submitted_at: z.string().nullable().optional(),
  customer_approved_at: z.string().nullable().optional(),
  offline_approved_at: z.string().nullable().optional(),
  staff_finalized_at: z.string().nullable().optional(),
  disputed_at: z.string().nullable().optional(),
  resolved_at: z.string().nullable().optional(),
  cancelled_at: z.string().nullable().optional(),
  cancellation_reason: z.string().nullable().optional(),
  sales_order_id: z.string().uuid().nullable().optional(),
  sales_invoice_id: z.string().uuid().nullable().optional(),
  sales_invoice_number: z.string().nullable().optional(),
  invoice_issued_at: z.string().nullable().optional(),
  due_date: z.string().nullable().optional(),
  paid_total_amount: z.string(),
  outstanding_amount: z.string(),
  notes: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
})

export const openApi = createFreightCrudOpenApi({
  resourceName: 'FreightTripAbstract',
  pluralName: 'Freight Trip Abstracts',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(abstractListItemSchema),
})
