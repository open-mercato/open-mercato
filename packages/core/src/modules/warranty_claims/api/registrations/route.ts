import { z } from 'zod'
import type { CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { buildIlikeTerm } from '@open-mercato/shared/lib/db/buildIlikeTerm'
import { E } from '#generated/entities.ids.generated'
import * as F from '#generated/entities/warranty_claim_registration'
import { WarrantyClaimRegistration } from '../../data/entities'
import {
  registrationCreateSchema,
  registrationUpdateSchema,
  registrationCoverageTypeSchema,
  registrationSourceSchema,
  type RegistrationCreateInput,
  type RegistrationUpdateInput,
} from '../../data/validators'
import { addWarrantyMonths } from '../../lib/warrantyPreview'
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

const listSchema = z
  .object({
    id: uuid.optional(),
    ids: idsSchema,
    serialNumber: z.string().trim().max(191).optional(),
    customerId: uuid.optional(),
    search: z.string().trim().max(300).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    sortField: z.enum(['serialNumber', 'productName', 'sku', 'warrantyExpiresAt', 'updatedAt', 'createdAt']).optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

type RegistrationListQuery = z.infer<typeof listSchema>
type RawRegistrationInput = z.infer<typeof rawBodySchema>

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['warranty_claims.registration.view'] },
  POST: { requireAuth: true, requireFeatures: ['warranty_claims.registration.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['warranty_claims.registration.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['warranty_claims.registration.manage'] },
}

export const metadata = routeMetadata

function scopeFromContext(ctx: CrudCtx): { organizationId: string; tenantId: string } {
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  const tenantId = ctx.auth?.tenantId ?? null
  if (!organizationId || !tenantId) {
    throw new CrudHttpError(400, { error: '[internal] warranty registration scope is missing' })
  }
  return { organizationId, tenantId }
}

function parseCreateInput(input: RawRegistrationInput, ctx: CrudCtx): RegistrationCreateInput {
  return registrationCreateSchema.parse({
    ...input,
    ...scopeFromContext(ctx),
  })
}

function parseUpdateInput(input: RawRegistrationInput, ctx: CrudCtx): RegistrationUpdateInput {
  return registrationUpdateSchema.parse({
    ...input,
    ...scopeFromContext(ctx),
  })
}

function hasOwn(input: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(input, key)
}

function parseDate(value: string | Date | null | undefined): Date | null {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function resolveWarrantyExpiresAt(input: RegistrationCreateInput): Date | null {
  if (hasOwn(input, 'warrantyExpiresAt')) return parseDate(input.warrantyExpiresAt)
  const purchaseDate = parseDate(input.purchaseDate)
  return purchaseDate && input.warrantyMonths !== null && input.warrantyMonths !== undefined
    ? addWarrantyMonths(purchaseDate, input.warrantyMonths)
    : null
}

function resolveUpdatedWarrantyExpiresAt(
  entity: WarrantyClaimRegistration,
  input: RegistrationUpdateInput,
): Date | null | undefined {
  if (hasOwn(input, 'warrantyExpiresAt')) return parseDate(input.warrantyExpiresAt)
  if (!hasOwn(input, 'purchaseDate') && !hasOwn(input, 'warrantyMonths')) return undefined
  const purchaseDate = hasOwn(input, 'purchaseDate') ? parseDate(input.purchaseDate) : entity.purchaseDate ?? null
  const warrantyMonths = hasOwn(input, 'warrantyMonths') ? input.warrantyMonths ?? null : entity.warrantyMonths ?? null
  return purchaseDate && warrantyMonths !== null ? addWarrantyMonths(purchaseDate, warrantyMonths) : null
}

function toRegistrationEntityData(input: RegistrationCreateInput): Record<string, unknown> {
  return {
    serialNumber: input.serialNumber ?? null,
    productId: input.productId ?? null,
    variantId: input.variantId ?? null,
    sku: input.sku ?? null,
    productName: input.productName ?? null,
    customerId: input.customerId ?? null,
    orderId: input.orderId ?? null,
    purchaseDate: parseDate(input.purchaseDate),
    warrantyMonths: input.warrantyMonths ?? null,
    warrantyExpiresAt: resolveWarrantyExpiresAt(input),
    coverageType: input.coverageType ?? null,
    source: input.source ?? null,
    proofAttachmentId: input.proofAttachmentId ?? null,
    notes: input.notes ?? null,
  }
}

function applyRegistrationUpdate(entity: WarrantyClaimRegistration, input: RegistrationUpdateInput): void {
  if (hasOwn(input, 'serialNumber')) entity.serialNumber = input.serialNumber ?? null
  if (hasOwn(input, 'productId')) entity.productId = input.productId ?? null
  if (hasOwn(input, 'variantId')) entity.variantId = input.variantId ?? null
  if (hasOwn(input, 'sku')) entity.sku = input.sku ?? null
  if (hasOwn(input, 'productName')) entity.productName = input.productName ?? null
  if (hasOwn(input, 'customerId')) entity.customerId = input.customerId ?? null
  if (hasOwn(input, 'orderId')) entity.orderId = input.orderId ?? null
  if (hasOwn(input, 'purchaseDate')) entity.purchaseDate = parseDate(input.purchaseDate)
  if (hasOwn(input, 'warrantyMonths')) entity.warrantyMonths = input.warrantyMonths ?? null
  const warrantyExpiresAt = resolveUpdatedWarrantyExpiresAt(entity, input)
  if (warrantyExpiresAt !== undefined) entity.warrantyExpiresAt = warrantyExpiresAt
  if (hasOwn(input, 'coverageType')) entity.coverageType = input.coverageType ?? null
  if (hasOwn(input, 'source')) entity.source = input.source ?? null
  if (hasOwn(input, 'proofAttachmentId')) entity.proofAttachmentId = input.proofAttachmentId ?? null
  if (hasOwn(input, 'notes')) entity.notes = input.notes ?? null
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

function toIso(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string') {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? value : date.toISOString()
  }
  return null
}

function transformRegistrationItem(item: unknown): unknown {
  const record = toRecord(item)
  if (!Object.keys(record).length) return item
  return {
    id: readString(record, 'id', 'id'),
    organizationId: readString(record, 'organization_id', 'organizationId'),
    tenantId: readString(record, 'tenant_id', 'tenantId'),
    serialNumber: readString(record, 'serial_number', 'serialNumber'),
    productId: readString(record, 'product_id', 'productId'),
    variantId: readString(record, 'variant_id', 'variantId'),
    sku: readString(record, 'sku', 'sku'),
    productName: readString(record, 'product_name', 'productName'),
    customerId: readString(record, 'customer_id', 'customerId'),
    orderId: readString(record, 'order_id', 'orderId'),
    purchaseDate: toIso(record.purchase_date ?? record.purchaseDate),
    warrantyMonths: readNumber(record, 'warranty_months', 'warrantyMonths'),
    warrantyExpiresAt: toIso(record.warranty_expires_at ?? record.warrantyExpiresAt),
    coverageType: readString(record, 'coverage_type', 'coverageType'),
    source: readString(record, 'source', 'source'),
    proofAttachmentId: readString(record, 'proof_attachment_id', 'proofAttachmentId'),
    notes: readString(record, 'notes', 'notes'),
    createdAt: toIso(record.created_at ?? record.createdAt),
    updatedAt: toIso(record.updated_at ?? record.updatedAt),
    deletedAt: toIso(record.deleted_at ?? record.deletedAt),
  }
}

const crud = makeCrudRoute<RawRegistrationInput, RawRegistrationInput, RegistrationListQuery>({
  metadata: routeMetadata,
  orm: {
    entity: WarrantyClaimRegistration,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: E.warranty_claims.warranty_claim_registration },
  list: {
    schema: listSchema,
    entityId: E.warranty_claims.warranty_claim_registration,
    fields: [
      F.id,
      F.organization_id,
      F.tenant_id,
      F.serial_number,
      F.product_id,
      F.variant_id,
      F.sku,
      F.product_name,
      F.customer_id,
      F.order_id,
      F.purchase_date,
      F.warranty_months,
      F.warranty_expires_at,
      F.coverage_type,
      F.source,
      F.proof_attachment_id,
      F.notes,
      F.created_at,
      F.updated_at,
      F.deleted_at,
    ],
    sortFieldMap: {
      serialNumber: F.serial_number,
      productName: F.product_name,
      sku: F.sku,
      warrantyExpiresAt: F.warranty_expires_at,
      createdAt: F.created_at,
      updatedAt: F.updated_at,
    },
    buildFilters: async (query) => {
      const filters: Record<string, unknown> = {}
      if (query.id) filters.id = { $eq: query.id }
      if (Array.isArray(query.ids) && query.ids.length) filters.id = { $in: query.ids }
      if (query.serialNumber) filters.serial_number = { $eq: query.serialNumber }
      if (query.customerId) filters.customer_id = { $eq: query.customerId }
      if (query.search) {
        const pattern = buildIlikeTerm(query.search)
        filters.$or = [
          { serial_number: { $ilike: pattern } },
          { sku: { $ilike: pattern } },
          { product_name: { $ilike: pattern } },
        ]
      }
      return filters
    },
    transformItem: transformRegistrationItem,
  },
  create: {
    schema: rawBodySchema,
    mapToEntity: (input, ctx) => toRegistrationEntityData(parseCreateInput(input, ctx)),
  },
  update: {
    schema: rawBodySchema,
    getId: (input) => {
      const id = input.id
      return typeof id === 'string' ? id : ''
    },
    applyToEntity: (entity, input, ctx) => {
      applyRegistrationUpdate(entity as WarrantyClaimRegistration, parseUpdateInput(input, ctx))
    },
    response: () => ({ ok: true }),
  },
  del: { idFrom: 'query', softDelete: true, response: () => ({ ok: true }) },
})

export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE

const registrationListItemSchema = z.object({
  id: z.string().uuid().nullable(),
  organizationId: z.string().uuid().nullable(),
  tenantId: z.string().uuid().nullable(),
  serialNumber: z.string().nullable(),
  productId: z.string().uuid().nullable(),
  variantId: z.string().uuid().nullable(),
  sku: z.string().nullable(),
  productName: z.string().nullable(),
  customerId: z.string().uuid().nullable(),
  orderId: z.string().uuid().nullable(),
  purchaseDate: z.string().nullable(),
  warrantyMonths: z.number().nullable(),
  warrantyExpiresAt: z.string().nullable(),
  coverageType: registrationCoverageTypeSchema.nullable(),
  source: registrationSourceSchema.nullable(),
  proofAttachmentId: z.string().uuid().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
}).passthrough()

export const openApi = createWarrantyClaimsCrudOpenApi({
  resourceName: 'WarrantyRegistration',
  pluralName: 'WarrantyRegistrations',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(registrationListItemSchema),
  create: {
    schema: registrationCreateSchema,
    responseSchema: z.object({ id: z.string().uuid() }),
    description: 'Creates a product warranty registration for entitlement resolution.',
  },
  update: {
    schema: registrationUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates a product warranty registration.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Soft-deletes a product warranty registration.',
  },
})
