import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { parseBooleanFromUnknown } from '@open-mercato/shared/lib/boolean'
import { buildIlikeTerm } from '@open-mercato/shared/lib/db/buildIlikeTerm'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { E } from '#generated/entities.ids.generated'
import * as F from '#generated/entities/warranty_vendor_policy'
import { WarrantyVendorPolicy } from '../../data/entities'
import {
  vendorPolicyCreateSchema,
  vendorPolicyUpdateSchema,
  vendorPolicyDeleteSchema,
  type VendorPolicyCreateInput,
  type VendorPolicyUpdateInput,
} from '../../data/validators'
import {
  createPagedListResponseSchema,
  createWarrantyClaimsCrudOpenApi,
  defaultOkResponseSchema,
} from '../openapi'

const rawBodySchema = z.object({}).passthrough()
const uuid = z.string().uuid()

const idsSchema = z.preprocess((value) => {
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
  }
  return value
}, z.array(uuid).min(1).max(500).optional())

const booleanQuerySchema = z.preprocess((value) => parseBooleanFromUnknown(value) ?? undefined, z.boolean().optional())

const listSchema = z
  .object({
    id: uuid.optional(),
    ids: idsSchema,
    search: z.string().trim().max(300).optional(),
    isActive: booleanQuerySchema,
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    sortField: z.enum(['vendorName', 'updatedAt', 'createdAt']).optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

type VendorPolicyListQuery = z.infer<typeof listSchema>
type RawVendorPolicyInput = z.infer<typeof rawBodySchema>

type VendorPolicyListPayload = {
  items?: unknown[]
}

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['warranty_claims.vendor_policy.manage'] },
  POST: { requireAuth: true, requireFeatures: ['warranty_claims.vendor_policy.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['warranty_claims.vendor_policy.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['warranty_claims.vendor_policy.manage'] },
}

export const metadata = routeMetadata

const baseListFields = [
  F.id,
  F.organization_id,
  F.tenant_id,
  F.vendor_name,
  F.vendor_ref,
  F.coverage_months,
  F.claimable_reason_codes,
  F.recovery_rate_pct,
  F.auto_generate_recovery,
  F.is_active,
  F.created_at,
  F.updated_at,
  F.deleted_at,
]

const detailFields = [...baseListFields, F.contact_email]

function scopeFromContext(ctx: CrudCtx): { organizationId: string; tenantId: string } {
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  const tenantId = ctx.auth?.tenantId ?? null
  if (!organizationId || !tenantId) {
    throw new CrudHttpError(400, { error: '[internal] warranty vendor policy scope is missing' })
  }
  return { organizationId, tenantId }
}

function parseCreateInput(input: RawVendorPolicyInput, ctx: CrudCtx): VendorPolicyCreateInput {
  return vendorPolicyCreateSchema.parse({
    ...input,
    ...scopeFromContext(ctx),
  })
}

function parseUpdateInput(input: RawVendorPolicyInput, ctx: CrudCtx): VendorPolicyUpdateInput {
  return vendorPolicyUpdateSchema.parse({
    ...input,
    ...scopeFromContext(ctx),
  })
}

function hasOwn(input: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(input, key)
}

function toNullableText(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function toNullableDecimal(value: number | string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function toVendorPolicyEntityData(input: VendorPolicyCreateInput): Record<string, unknown> {
  return {
    vendorName: input.vendorName,
    vendorRef: input.vendorRef ?? null,
    coverageMonths: input.coverageMonths ?? null,
    claimableReasonCodes: input.claimableReasonCodes ?? null,
    recoveryRatePct: toNullableDecimal(input.recoveryRatePct),
    contactEmail: input.contactEmail ?? null,
    autoGenerateRecovery: input.autoGenerateRecovery ?? false,
    isActive: input.isActive ?? true,
  }
}

function applyVendorPolicyUpdate(entity: WarrantyVendorPolicy, input: VendorPolicyUpdateInput): void {
  if (hasOwn(input, 'vendorName') && input.vendorName) entity.vendorName = input.vendorName
  if (hasOwn(input, 'vendorRef')) entity.vendorRef = input.vendorRef ?? null
  if (hasOwn(input, 'coverageMonths')) entity.coverageMonths = input.coverageMonths ?? null
  if (hasOwn(input, 'claimableReasonCodes')) entity.claimableReasonCodes = input.claimableReasonCodes ?? null
  if (hasOwn(input, 'recoveryRatePct')) entity.recoveryRatePct = toNullableDecimal(input.recoveryRatePct)
  if (hasOwn(input, 'contactEmail')) entity.contactEmail = input.contactEmail ?? null
  if (hasOwn(input, 'autoGenerateRecovery')) entity.autoGenerateRecovery = input.autoGenerateRecovery === true
  if (hasOwn(input, 'isActive')) entity.isActive = input.isActive !== false
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function readString(record: Record<string, unknown>, snakeKey: string, camelKey: string): string | null {
  const value = record[snakeKey] ?? record[camelKey]
  return typeof value === 'string' ? value : null
}

function readNumber(record: Record<string, unknown>, snakeKey: string, camelKey: string): number | null {
  const value = record[snakeKey] ?? record[camelKey]
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function readBool(record: Record<string, unknown>, snakeKey: string, camelKey: string): boolean {
  const value = record[snakeKey] ?? record[camelKey]
  return value === true
}

function readStringArray(record: Record<string, unknown>, snakeKey: string, camelKey: string): string[] | null {
  const value = record[snakeKey] ?? record[camelKey]
  if (!Array.isArray(value)) return null
  return value.filter((entry): entry is string => typeof entry === 'string')
}

function toIso(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string') {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? value : date.toISOString()
  }
  return null
}

function isDetailQuery(query: VendorPolicyListQuery): boolean {
  if (query.id) return true
  return Array.isArray(query.ids) && query.ids.length === 1
}

function detailIds(query: VendorPolicyListQuery): string[] {
  if (query.id) return [query.id]
  if (Array.isArray(query.ids) && query.ids.length === 1) return query.ids
  return []
}

function transformVendorPolicyItem(item: unknown): unknown {
  const record = toRecord(item)
  if (!Object.keys(record).length) return item
  const result: Record<string, unknown> = {
    id: readString(record, 'id', 'id'),
    organizationId: readString(record, 'organization_id', 'organizationId'),
    tenantId: readString(record, 'tenant_id', 'tenantId'),
    vendorName: readString(record, 'vendor_name', 'vendorName'),
    vendorRef: readString(record, 'vendor_ref', 'vendorRef'),
    coverageMonths: readNumber(record, 'coverage_months', 'coverageMonths'),
    claimableReasonCodes: readStringArray(record, 'claimable_reason_codes', 'claimableReasonCodes'),
    recoveryRatePct: readString(record, 'recovery_rate_pct', 'recoveryRatePct'),
    autoGenerateRecovery: readBool(record, 'auto_generate_recovery', 'autoGenerateRecovery'),
    isActive: readBool(record, 'is_active', 'isActive'),
    createdAt: toIso(record.created_at ?? record.createdAt),
    updatedAt: toIso(record.updated_at ?? record.updatedAt),
    deletedAt: toIso(record.deleted_at ?? record.deletedAt),
  }
  if (hasOwn(record, 'contact_email') || hasOwn(record, 'contactEmail')) {
    result.contactEmail = readString(record, 'contact_email', 'contactEmail')
  }
  return result
}

async function hydrateDetailContactEmail(
  payload: VendorPolicyListPayload,
  ctx: CrudCtx & { query: VendorPolicyListQuery },
): Promise<void> {
  const ids = detailIds(ctx.query)
  if (!ids.length || !Array.isArray(payload.items) || !payload.items.length) return
  const tenantId = ctx.auth?.tenantId ?? null
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  if (!tenantId || !organizationId) return
  const em = (ctx.container.resolve('em') as EntityManager).fork()
  const policies = await findWithDecryption(
    em,
    WarrantyVendorPolicy,
    { id: { $in: ids }, tenantId, organizationId, deletedAt: null },
    {},
    { tenantId, organizationId },
  )
  const contactEmailById = new Map(policies.map((policy) => [policy.id, policy.contactEmail ?? null]))
  for (const item of payload.items) {
    const record = toRecord(item)
    const id = readString(record, 'id', 'id')
    if (!id || !contactEmailById.has(id)) continue
    record.contactEmail = contactEmailById.get(id) ?? null
  }
}

const crud = makeCrudRoute<RawVendorPolicyInput, RawVendorPolicyInput, VendorPolicyListQuery>({
  metadata: routeMetadata,
  orm: {
    entity: WarrantyVendorPolicy,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: E.warranty_claims.warranty_vendor_policy },
  list: {
    schema: listSchema,
    entityId: E.warranty_claims.warranty_vendor_policy,
    fields: (query) => (isDetailQuery(query) ? detailFields : baseListFields),
    sortFieldMap: {
      vendorName: F.vendor_name,
      createdAt: F.created_at,
      updatedAt: F.updated_at,
    },
    buildFilters: async (query) => {
      const filters: Record<string, unknown> = {}
      if (query.id) filters.id = { $eq: query.id }
      if (Array.isArray(query.ids) && query.ids.length) filters.id = { $in: query.ids }
      if (query.isActive !== undefined) filters[F.is_active] = { $eq: query.isActive }
      if (query.search) {
        const pattern = buildIlikeTerm(query.search)
        filters.$or = [
          { [F.vendor_name]: { $ilike: pattern } },
          { [F.vendor_ref]: { $ilike: pattern } },
        ]
      }
      return filters
    },
    transformItem: transformVendorPolicyItem,
  },
  hooks: {
    afterList: hydrateDetailContactEmail,
  },
  create: {
    schema: rawBodySchema,
    mapToEntity: (input, ctx) => toVendorPolicyEntityData(parseCreateInput(input, ctx)),
  },
  update: {
    schema: rawBodySchema,
    getId: (input) => {
      const id = input.id
      return typeof id === 'string' ? id : ''
    },
    applyToEntity: (entity, input, ctx) => {
      applyVendorPolicyUpdate(entity as WarrantyVendorPolicy, parseUpdateInput(input, ctx))
    },
    response: () => ({ ok: true }),
  },
  del: { idFrom: 'query', softDelete: true, response: () => ({ ok: true }) },
})

export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE

const vendorPolicyListItemSchema = z.object({
  id: z.string().uuid().nullable(),
  organizationId: z.string().uuid().nullable(),
  tenantId: z.string().uuid().nullable(),
  vendorName: z.string().nullable(),
  vendorRef: z.string().nullable(),
  coverageMonths: z.number().nullable(),
  claimableReasonCodes: z.array(z.string()).nullable(),
  recoveryRatePct: z.string().nullable(),
  contactEmail: z.string().email().nullable().optional(),
  autoGenerateRecovery: z.boolean(),
  isActive: z.boolean(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
}).passthrough()

export const openApi = createWarrantyClaimsCrudOpenApi({
  resourceName: 'WarrantyVendorPolicy',
  pluralName: 'WarrantyVendorPolicies',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(vendorPolicyListItemSchema),
  create: {
    schema: vendorPolicyCreateSchema,
    responseSchema: z.object({ id: z.string().uuid() }),
    description: 'Creates a warranty vendor policy for supplier recovery.',
  },
  update: {
    schema: vendorPolicyUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates a warranty vendor policy.',
  },
  del: {
    schema: vendorPolicyDeleteSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Soft-deletes a warranty vendor policy.',
  },
})
