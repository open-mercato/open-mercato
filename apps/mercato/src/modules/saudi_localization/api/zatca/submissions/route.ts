import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { createPagedListResponseSchema } from '@open-mercato/shared/lib/openapi/crud'
import {
  SAUDI_EINVOICE_SUBMISSION_STATUSES,
  SaudiEinvoiceSubmission,
} from '../../../data/entities'

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  id: z.string().uuid().optional(),
  ids: z.string().optional(),
  orderId: z.string().uuid().optional(),
  status: z.enum(SAUDI_EINVOICE_SUBMISSION_STATUSES).optional(),
  search: z.string().optional(),
  sortField: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
}).passthrough()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['saudi_localization.einvoicing.view'] },
}

export const metadata = { path: '/saudi_localization/zatca/submissions', ...routeMetadata }

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: SaudiEinvoiceSubmission,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: 'saudi_localization:saudi_einvoice_submission' },
  list: {
    schema: listSchema,
    entityId: 'saudi_localization:saudi_einvoice_submission',
    fields: ['id', 'organization_id', 'tenant_id', 'order_id', 'invoice_number', 'invoice_uuid', 'icv', 'invoice_hash', 'previous_invoice_hash', 'status', 'submitted_at', 'cleared_at', 'error_message', 'created_at', 'updated_at'],
    sortFieldMap: {
      icv: 'icv',
      invoiceNumber: 'invoice_number',
      status: 'status',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    buildFilters: (query) => ({
      ...(query.id ? { id: { $eq: query.id } } : {}),
      ...(query.ids ? { id: { $in: query.ids.split(',').map((value) => value.trim()).filter(Boolean) } } : {}),
      ...(query.orderId ? { order_id: { $eq: query.orderId } } : {}),
      ...(query.status ? { status: { $eq: query.status } } : {}),
      ...(query.search ? { invoice_number: { $ilike: `%${escapeLikePattern(query.search)}%` } } : {}),
    }),
    transformItem: (item) => ({ ...item, updatedAt: item.updated_at ?? null }),
  },
})

export const GET = crud.GET

const itemSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  order_id: z.string().uuid(),
  invoice_number: z.string(),
  invoice_uuid: z.string(),
  icv: z.number(),
  invoice_hash: z.string(),
  previous_invoice_hash: z.string(),
  status: z.string(),
  submitted_at: z.string().nullable().optional(),
  cleared_at: z.string().nullable().optional(),
  error_message: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
})

export const openApi = {
  tag: 'Saudi Localization',
  summary: 'ZATCA submission history',
  methods: {
    GET: {
      summary: 'Persisted issuance attempts',
      responses: [{
        status: 200,
        description: 'Submissions',
        schema: createPagedListResponseSchema(itemSchema),
      }],
    },
  },
}
