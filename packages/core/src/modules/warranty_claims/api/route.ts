import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { parseBooleanFromUnknown } from '@open-mercato/shared/lib/boolean'
import { parseScopedCommandInput, withScopedPayload } from '@open-mercato/shared/lib/api/scoped'
import { buildIlikeTerm } from '@open-mercato/shared/lib/db/buildIlikeTerm'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { E } from '#generated/entities.ids.generated'
import { WarrantyClaim } from '../data/entities'
import {
  claimCreateSchema,
  claimPrioritySchema,
  claimStatusSchema,
  claimTypeSchema,
  claimUpdateSchema,
  type ClaimCreateInput,
  type ClaimUpdateInput,
} from '../data/validators'
import {
  createPagedListResponseSchema,
  createWarrantyClaimsCrudOpenApi,
  defaultOkResponseSchema,
} from './openapi'

const rawBodySchema = z.object({}).passthrough()

const uuid = z.string().uuid()

const statusListSchema = z.preprocess((value) => {
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
  }
  return value
}, z.array(claimStatusSchema).min(1).max(50).optional())

const idsSchema = z.preprocess((value) => {
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
  }
  return value
}, z.array(uuid).min(1).max(10000).optional())

const booleanQuerySchema = z.preprocess((value) => parseBooleanFromUnknown(value) ?? undefined, z.boolean().optional())

const listSchema = z
  .object({
    id: uuid.optional(),
    status: statusListSchema,
    'status[]': statusListSchema,
    claimType: claimTypeSchema.optional(),
    priority: claimPrioritySchema.optional(),
    customerId: uuid.optional(),
    orderId: uuid.optional(),
    assigneeUserId: uuid.optional(),
    ids: idsSchema,
    search: z.string().trim().max(300).optional(),
    overdueOnly: booleanQuerySchema,
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    sortField: z.enum(['slaDueAt', 'createdAt', 'updatedAt']).optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

type ClaimListQuery = z.infer<typeof listSchema>

const claimDeleteSchema = z
  .object({
    id: uuid,
    organizationId: uuid.optional(),
    tenantId: uuid.optional(),
  })
  .strict()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['warranty_claims.claim.view'] },
  POST: { requireAuth: true, requireFeatures: ['warranty_claims.claim.create'] },
  PUT: { requireAuth: true, requireFeatures: ['warranty_claims.claim.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['warranty_claims.claim.delete'] },
}

export const metadata = routeMetadata

const TERMINAL_STATUSES = ['closed', 'cancelled'] as const

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function readString(record: Record<string, unknown>, snakeKey: string, camelKey: string): string | null {
  const value = record[snakeKey] ?? record[camelKey]
  return typeof value === 'string' ? value : null
}

function readBool(record: Record<string, unknown>, snakeKey: string, camelKey: string): boolean {
  const value = record[snakeKey] ?? record[camelKey]
  return value === true
}

function toIso(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string') {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? value : date.toISOString()
  }
  return null
}

function selectedStatuses(query: ClaimListQuery): string[] {
  const statuses = Array.isArray(query.status) ? query.status : []
  const bracketStatuses = Array.isArray(query['status[]']) ? query['status[]'] : []
  return Array.from(new Set([...statuses, ...bracketStatuses]))
}

function transformClaimItem(item: unknown): unknown {
  const record = toRecord(item)
  if (!Object.keys(record).length) return item
  return {
    id: readString(record, 'id', 'id'),
    claimNumber: readString(record, 'claim_number', 'claimNumber'),
    claimType: readString(record, 'claim_type', 'claimType'),
    status: readString(record, 'status', 'status'),
    channel: readString(record, 'channel', 'channel'),
    priority: readString(record, 'priority', 'priority'),
    customerId: readString(record, 'customer_id', 'customerId'),
    customerName: readString(record, 'customer_name', 'customerName'),
    vendorName: readString(record, 'vendor_name', 'vendorName'),
    vendorRef: readString(record, 'vendor_ref', 'vendorRef'),
    orderId: readString(record, 'order_id', 'orderId'),
    salesReturnId: readString(record, 'sales_return_id', 'salesReturnId'),
    replacementOrderId: readString(record, 'replacement_order_id', 'replacementOrderId'),
    sourceClaimId: readString(record, 'source_claim_id', 'sourceClaimId'),
    advanceReplacement: readBool(record, 'advance_replacement', 'advanceReplacement'),
    advanceShippedAt: toIso(record.advance_shipped_at ?? record.advanceShippedAt),
    reasonCode: readString(record, 'reason_code', 'reasonCode'),
    rejectionReasonCode: readString(record, 'rejection_reason_code', 'rejectionReasonCode'),
    resolutionSummary: readString(record, 'resolution_summary', 'resolutionSummary'),
    notes: readString(record, 'notes', 'notes'),
    currencyCode: readString(record, 'currency_code', 'currencyCode'),
    totalClaimedAmount: readString(record, 'total_claimed_amount', 'totalClaimedAmount'),
    totalApprovedAmount: readString(record, 'total_approved_amount', 'totalApprovedAmount'),
    totalRecoveredAmount: readString(record, 'total_recovered_amount', 'totalRecoveredAmount'),
    slaDueAt: toIso(record.sla_due_at ?? record.slaDueAt),
    submittedAt: toIso(record.submitted_at ?? record.submittedAt),
    resolvedAt: toIso(record.resolved_at ?? record.resolvedAt),
    closedAt: toIso(record.closed_at ?? record.closedAt),
    assigneeUserId: readString(record, 'assignee_user_id', 'assigneeUserId'),
    createdAt: toIso(record.created_at ?? record.createdAt),
    updatedAt: toIso(record.updated_at ?? record.updatedAt),
  }
}

const crud = makeCrudRoute<ClaimCreateInput, ClaimUpdateInput, ClaimListQuery>({
  metadata: routeMetadata,
  orm: {
    entity: WarrantyClaim,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: E.warranty_claims.warranty_claim },
  list: {
    schema: listSchema,
    entityId: E.warranty_claims.warranty_claim,
    fields: [
      'id',
      'claim_number',
      'claim_type',
      'status',
      'channel',
      'priority',
      'customer_id',
      'customer_name',
      'vendor_name',
      'vendor_ref',
      'order_id',
      'sales_return_id',
      'replacement_order_id',
      'source_claim_id',
      'advance_replacement',
      'advance_shipped_at',
      'reason_code',
      'rejection_reason_code',
      'resolution_summary',
      'notes',
      'currency_code',
      'total_claimed_amount',
      'total_approved_amount',
      'total_recovered_amount',
      'sla_due_at',
      'submitted_at',
      'resolved_at',
      'closed_at',
      'assignee_user_id',
      'organization_id',
      'tenant_id',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      slaDueAt: 'sla_due_at',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    buildFilters: async (query) => {
      const filters: Record<string, unknown> = {}
      if (query.id) filters.id = { $eq: query.id }
      const statuses = selectedStatuses(query)
      const statusFilter: Record<string, unknown> = {}
      if (statuses.length) statusFilter.$in = statuses
      if (query.overdueOnly === true) {
        statusFilter.$nin = [...TERMINAL_STATUSES]
        filters.sla_due_at = { $lt: new Date() }
      }
      if (Object.keys(statusFilter).length) filters.status = statusFilter
      if (query.claimType) filters.claim_type = { $eq: query.claimType }
      if (query.priority) filters.priority = { $eq: query.priority }
      if (query.customerId) filters.customer_id = { $eq: query.customerId }
      if (query.orderId) filters.order_id = { $eq: query.orderId }
      if (query.assigneeUserId) filters.assignee_user_id = { $eq: query.assigneeUserId }
      if (Array.isArray(query.ids) && query.ids.length) filters.id = { $in: query.ids }
      if (query.search) {
        const pattern = buildIlikeTerm(query.search)
        filters.$or = [
          { claim_number: { $ilike: pattern } },
          { customer_name: { $ilike: pattern } },
          { vendor_name: { $ilike: pattern } },
          { vendor_ref: { $ilike: pattern } },
        ]
      }
      return filters
    },
    transformItem: transformClaimItem,
  },
  actions: {
    create: {
      commandId: 'warranty_claims.claim.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(claimCreateSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }: { result: Record<string, unknown> | null }) => ({
        id: typeof result?.claimId === 'string' ? result.claimId : null,
      }),
      status: 201,
    },
    update: {
      commandId: 'warranty_claims.claim.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(claimUpdateSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }: { result: Record<string, unknown> | null }) => ({
        ok: true,
        id: typeof result?.claimId === 'string' ? result.claimId : null,
      }),
    },
    delete: {
      commandId: 'warranty_claims.claim.delete',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const rawRecord = toRecord(raw)
        const body = toRecord(rawRecord.body)
        const query = toRecord(rawRecord.query)
        const id = body.id ?? query.id
        if (typeof id !== 'string' || !id) {
          throw new CrudHttpError(400, { error: translate('warranty_claims.errors.notFound', 'Warranty claim not found.') })
        }
        return claimDeleteSchema.parse(withScopedPayload({ id }, ctx, translate))
      },
      response: () => ({ ok: true }),
    },
  },
})

export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE

const claimListItemSchema = z.object({
  id: z.string().uuid().nullable(),
  claimNumber: z.string().nullable(),
  claimType: z.string().nullable(),
  status: z.string().nullable(),
  channel: z.string().nullable(),
  priority: z.string().nullable(),
  customerId: z.string().uuid().nullable(),
  customerName: z.string().nullable(),
  orderId: z.string().uuid().nullable(),
  assigneeUserId: z.string().uuid().nullable(),
  totalClaimedAmount: z.string().nullable(),
  totalApprovedAmount: z.string().nullable(),
  totalRecoveredAmount: z.string().nullable(),
  slaDueAt: z.string().nullable(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
}).passthrough()

export const openApi = createWarrantyClaimsCrudOpenApi({
  resourceName: 'WarrantyClaim',
  pluralName: 'WarrantyClaims',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(claimListItemSchema),
  create: {
    schema: claimCreateSchema,
    responseSchema: z.object({ id: z.string().uuid().nullable() }),
    description: 'Creates a warranty, return, core-return, or vendor-recovery claim.',
  },
  update: {
    schema: claimUpdateSchema,
    responseSchema: z.object({ ok: z.boolean(), id: z.string().uuid().nullable() }),
    description: 'Updates editable claim header fields for the current claim status.',
  },
  del: {
    schema: claimDeleteSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Soft-deletes a draft or cancelled claim.',
  },
})
