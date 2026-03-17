import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { parseIdsParam, mergeIdFilter } from '@open-mercato/shared/lib/crud/ids'
import { PaymentLinkTemplate } from '../../data/entities'
import { templateCreateSchema, templateUpdateSchema, templateListSchema } from '../../data/validators'
import { createTemplatesCrudOpenApi, createPagedListResponseSchema, defaultOkResponseSchema } from '../openapi'
import { emitPaymentLinkPageEvent } from '../../events'

const routeMetadata = {
  path: '/payment_link_pages/templates',
  GET: { requireAuth: true, requireFeatures: ['payment_link_pages.templates.view'] },
  POST: { requireAuth: true, requireFeatures: ['payment_link_pages.templates.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['payment_link_pages.templates.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['payment_link_pages.templates.manage'] },
}

export const metadata = routeMetadata

const itemSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable().optional(),
  isDefault: z.boolean(),
  branding: z.record(z.string(), z.unknown()).nullable().optional(),
  defaultTitle: z.string().nullable().optional(),
  defaultDescription: z.string().nullable().optional(),
  customFields: z.record(z.string(), z.unknown()).nullable().optional(),
  customFieldsetCode: z.string().nullable().optional(),
  customerCapture: z.record(z.string(), z.unknown()).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: PaymentLinkTemplate,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  list: {
    schema: templateListSchema,
    fields: [
      'id',
      'name',
      'description',
      'is_default',
      'branding',
      'default_title',
      'default_description',
      'custom_fields',
      'custom_fieldset_code',
      'customer_capture',
      'metadata',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      name: 'name',
      createdAt: 'created_at',
      isDefault: 'is_default',
    },
    defaultSort: { field: 'created_at', dir: 'desc' },
    buildFilters: async (query: Record<string, unknown>) => {
      const filters: Record<string, unknown> = {}
      if (typeof query.search === 'string' && query.search.length > 0) {
        filters.name = { $ilike: `%${escapeLikePattern(query.search)}%` }
      }
      if (typeof query.id === 'string') {
        filters.id = { $eq: query.id }
      }
      if (typeof query.ids === 'string') {
        const parsed = parseIdsParam(query.ids)
        if (parsed.length > 0) {
          mergeIdFilter(filters, parsed)
        }
      }
      return filters
    },
  },
  create: {
    schema: templateCreateSchema,
    async after(record, ctx) {
      await emitPaymentLinkPageEvent('payment_link_pages.template.created', {
        templateId: record.id,
        name: record.name,
        organizationId: record.organizationId,
        tenantId: record.tenantId,
      })
      return record
    },
  },
  update: {
    schema: templateUpdateSchema,
    async after(record, ctx) {
      await emitPaymentLinkPageEvent('payment_link_pages.template.updated', {
        templateId: record.id,
        name: record.name,
        organizationId: record.organizationId,
        tenantId: record.tenantId,
      })
      return record
    },
  },
  delete: {
    async after(record, ctx) {
      await emitPaymentLinkPageEvent('payment_link_pages.template.deleted', {
        templateId: record.id,
        name: record.name,
        organizationId: record.organizationId,
        tenantId: record.tenantId,
      })
    },
  },
})

export const { GET, POST, PUT, DELETE } = crud

export const openApi = createTemplatesCrudOpenApi({
  resourceName: 'PaymentLinkTemplate',
  querySchema: templateListSchema,
  listResponseSchema: createPagedListResponseSchema(itemSchema),
  create: { schema: templateCreateSchema, description: 'Create a new payment link template.' },
  update: { schema: templateUpdateSchema, responseSchema: defaultOkResponseSchema, description: 'Update a payment link template.' },
  del: { responseSchema: defaultOkResponseSchema, description: 'Archive a payment link template (soft delete).' },
})

export default GET
