import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { parseScopedCommandInput, resolveCrudRecordId } from '@open-mercato/shared/lib/api/scoped'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { BILLING_CYCLES, CONTRACT_STATUSES, FreightContract } from '../../data/entities'
import { createContractSchema, updateContractSchema } from '../../data/validators'
import { withOrConditions } from '../../lib/crudFilters'
import { createPagedListResponseSchema, createFreightCrudOpenApi, defaultOkResponseSchema } from '../openapi'
import { FREIGHT_CONTRACT_ENTITY_ID } from '../../commands/entities'

const rawBodySchema = z.object({}).passthrough()
const listSchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    id: z.string().uuid().optional(),
    ids: z.string().optional(),
    status: z.enum(CONTRACT_STATUSES).optional(),
    customerId: z.string().uuid().optional(),
    validOn: z.string().optional(),
    requiresCustomerApproval: z.enum(['true', 'false']).optional(),
    search: z.string().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['freight.read'] },
  POST: { requireAuth: true, requireFeatures: ['freight.contracts.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['freight.contracts.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['freight.contracts.manage'] },
}
export const metadata = { path: '/freight_operations/contracts', ...routeMetadata }

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: { entity: FreightContract, idField: 'id', orgField: 'organizationId', tenantField: 'tenantId', softDeleteField: 'deletedAt' },
  indexer: { entityType: FREIGHT_CONTRACT_ENTITY_ID },
  list: {
    schema: listSchema,
    entityId: FREIGHT_CONTRACT_ENTITY_ID,
    fields: [
      'id', 'organization_id', 'tenant_id', 'contract_number', 'status', 'customer_id', 'customer_snapshot',
      'title', 'valid_from', 'valid_to', 'billing_cycle', 'payment_terms_days', 'currency_code', 'vat_rate',
      'requires_customer_approval', 'sales_channel_id', 'signed_at', 'notes', 'created_at', 'updated_at',
    ],
    sortFieldMap: {
      contractNumber: 'contract_number',
      validFrom: 'valid_from',
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
          ...(query.customerId ? { customer_id: { $eq: query.customerId } } : {}),
          ...(query.requiresCustomerApproval ? { requires_customer_approval: { $eq: query.requiresCustomerApproval === 'true' } } : {}),
          ...(query.validOn
            ? { valid_from: { $lte: query.validOn }, valid_to: { $gte: query.validOn } }
            : {}),
        },
        query.search
          ? [
              {
                $or: [
                  { contract_number: { $ilike: `%${escapeLikePattern(query.search)}%` } },
                  { title: { $ilike: `%${escapeLikePattern(query.search)}%` } },
                ],
              },
            ]
          : [],
      ),
    transformItem: (item) => ({ ...item, updatedAt: item.updated_at ?? null }),
  },
  actions: {
    create: {
      commandId: 'freight_operations.contracts.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(createContractSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({ id: result?.id ?? null, updatedAt: result?.updatedAt?.toISOString?.() ?? null }),
      status: 201,
    },
    update: {
      commandId: 'freight_operations.contracts.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(updateContractSchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'freight_operations.contracts.delete',
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

const contractListItemSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  contract_number: z.string(),
  status: z.enum(CONTRACT_STATUSES),
  customer_id: z.string().uuid(),
  customer_snapshot: z.record(z.string(), z.unknown()).nullable().optional(),
  title: z.string(),
  valid_from: z.string().nullable().optional(),
  valid_to: z.string().nullable().optional(),
  billing_cycle: z.enum(BILLING_CYCLES),
  payment_terms_days: z.number(),
  currency_code: z.string(),
  vat_rate: z.string(),
  requires_customer_approval: z.boolean(),
  sales_channel_id: z.string().uuid().nullable().optional(),
  signed_at: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
})

export const openApi = createFreightCrudOpenApi({
  resourceName: 'FreightContract',
  pluralName: 'Freight Contracts',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(contractListItemSchema),
  create: { schema: createContractSchema, description: 'Creates a freight contract (draft) and allocates its number.' },
  update: { schema: updateContractSchema, responseSchema: defaultOkResponseSchema, description: 'Updates a draft or active contract.' },
  del: { schema: z.object({ id: z.string().uuid() }), responseSchema: defaultOkResponseSchema, description: 'Soft-deletes a draft contract.' },
})
