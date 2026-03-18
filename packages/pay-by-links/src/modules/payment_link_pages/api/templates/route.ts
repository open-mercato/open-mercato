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
  amountType: z.string().optional(),
  amountOptions: z.array(z.object({ amount: z.number(), label: z.string() })).nullable().optional(),
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
      'amount_type',
      'amount_options',
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
    mapToEntity: (input: z.infer<typeof templateCreateSchema>) => ({
      name: input.name,
      description: input.description ?? null,
      isDefault: input.isDefault ?? false,
      amountType: input.amountType ?? 'fixed',
      amountOptions: input.amountOptions ?? null,
      branding: input.branding ?? null,
      defaultTitle: input.defaultTitle ?? null,
      defaultDescription: input.defaultDescription ?? null,
      customFields: input.customFields ?? null,
      customFieldsetCode: input.customFieldsetCode ?? null,
      customerCapture: input.customerCapture ?? null,
      metadata: input.metadata ?? null,
    }),
  },
  update: {
    schema: templateUpdateSchema,
    applyToEntity: (entity: PaymentLinkTemplate, input: z.infer<typeof templateUpdateSchema>) => {
      if (input.name !== undefined) entity.name = input.name
      if (input.description !== undefined) entity.description = input.description ?? null
      if (input.isDefault !== undefined) entity.isDefault = input.isDefault
      if (input.amountType !== undefined) entity.amountType = input.amountType ?? 'fixed'
      if (input.amountOptions !== undefined) entity.amountOptions = input.amountOptions ?? null
      if (input.branding !== undefined) entity.branding = input.branding ?? null
      if (input.defaultTitle !== undefined) entity.defaultTitle = input.defaultTitle ?? null
      if (input.defaultDescription !== undefined) entity.defaultDescription = input.defaultDescription ?? null
      if (input.customFields !== undefined) entity.customFields = input.customFields ?? null
      if (input.customFieldsetCode !== undefined) entity.customFieldsetCode = input.customFieldsetCode ?? null
      if (input.customerCapture !== undefined) entity.customerCapture = input.customerCapture ?? null
      if (input.metadata !== undefined) entity.metadata = input.metadata ?? null
    },
  },
  hooks: {
    afterCreate: async (entity) => {
      await emitPaymentLinkPageEvent('payment_link_pages.template.created', {
        templateId: entity.id,
        name: entity.name,
        organizationId: entity.organizationId,
        tenantId: entity.tenantId,
      })
    },
    afterUpdate: async (entity) => {
      await emitPaymentLinkPageEvent('payment_link_pages.template.updated', {
        templateId: entity.id,
        name: entity.name,
        organizationId: entity.organizationId,
        tenantId: entity.tenantId,
      })
    },
    afterDelete: async (id) => {
      await emitPaymentLinkPageEvent('payment_link_pages.template.deleted', {
        templateId: id,
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
