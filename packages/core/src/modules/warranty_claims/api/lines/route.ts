import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { parseScopedCommandInput, withScopedPayload } from '@open-mercato/shared/lib/api/scoped'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { E } from '#generated/entities.ids.generated'
import { WarrantyClaimLine } from '../../data/entities'
import {
  claimLineCreateSchema,
  claimLineUpdateSchema,
  type ClaimLineCreateInput,
  type ClaimLineUpdateInput,
} from '../../data/validators'
import {
  createPagedListResponseSchema,
  createWarrantyClaimsCrudOpenApi,
  defaultOkResponseSchema,
} from '../openapi'

const rawBodySchema = z.object({}).passthrough()
const uuid = z.string().uuid()

const listSchema = z
  .object({
    claimId: uuid,
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
    sortField: z.enum(['lineNo', 'createdAt', 'updatedAt']).optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

type LineListQuery = z.infer<typeof listSchema>

const lineDeleteSchema = z
  .object({
    id: uuid,
    claimId: uuid.optional(),
    organizationId: uuid.optional(),
    tenantId: uuid.optional(),
  })
  .strict()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['warranty_claims.claim.view'] },
  POST: { requireAuth: true, requireFeatures: ['warranty_claims.claim.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['warranty_claims.claim.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['warranty_claims.claim.manage'] },
}

export const metadata = routeMetadata

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function readString(record: Record<string, unknown>, snakeKey: string, camelKey: string): string | null {
  const value = record[snakeKey] ?? record[camelKey]
  return typeof value === 'string' ? value : null
}

function readNumber(record: Record<string, unknown>, snakeKey: string, camelKey: string): number | null {
  const value = record[snakeKey] ?? record[camelKey]
  if (typeof value === 'number') return value
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

function transformLineItem(item: unknown): unknown {
  const record = toRecord(item)
  if (!Object.keys(record).length) return item
  return {
    id: readString(record, 'id', 'id'),
    claimId: readString(record, 'claim_id', 'claimId') ?? readString(record, 'claim', 'claim'),
    lineNo: readNumber(record, 'line_no', 'lineNo'),
    productId: readString(record, 'product_id', 'productId'),
    variantId: readString(record, 'variant_id', 'variantId'),
    sku: readString(record, 'sku', 'sku'),
    productName: readString(record, 'product_name', 'productName'),
    orderLineId: readString(record, 'order_line_id', 'orderLineId'),
    serialNumber: readString(record, 'serial_number', 'serialNumber'),
    lotNumber: readString(record, 'lot_number', 'lotNumber'),
    purchaseDate: toIso(record.purchase_date ?? record.purchaseDate),
    warrantyMonths: readNumber(record, 'warranty_months', 'warrantyMonths'),
    warrantyExpiresAt: toIso(record.warranty_expires_at ?? record.warrantyExpiresAt),
    warrantyStatus: readString(record, 'warranty_status', 'warrantyStatus'),
    faultCode: readString(record, 'fault_code', 'faultCode'),
    faultDescription: readString(record, 'fault_description', 'faultDescription'),
    qtyClaimed: readString(record, 'qty_claimed', 'qtyClaimed'),
    qtyApproved: readString(record, 'qty_approved', 'qtyApproved'),
    qtyReceived: readString(record, 'qty_received', 'qtyReceived'),
    conditionOnReceipt: readString(record, 'condition_on_receipt', 'conditionOnReceipt'),
    inspectionNotes: readString(record, 'inspection_notes', 'inspectionNotes'),
    disposition: readString(record, 'disposition', 'disposition'),
    lineStatus: readString(record, 'line_status', 'lineStatus'),
    creditAmount: readString(record, 'credit_amount', 'creditAmount'),
    restockingFee: readString(record, 'restocking_fee', 'restockingFee'),
    coreChargeAmount: readString(record, 'core_charge_amount', 'coreChargeAmount'),
    coreCreditAmount: readString(record, 'core_credit_amount', 'coreCreditAmount'),
    vendorClaimLineId: readString(record, 'vendor_claim_line_id', 'vendorClaimLineId'),
    createdAt: toIso(record.created_at ?? record.createdAt),
    updatedAt: toIso(record.updated_at ?? record.updatedAt),
  }
}

const crud = makeCrudRoute<ClaimLineCreateInput, ClaimLineUpdateInput, LineListQuery>({
  metadata: routeMetadata,
  orm: {
    entity: WarrantyClaimLine,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: E.warranty_claims.warranty_claim_line },
  list: {
    schema: listSchema,
    entityId: E.warranty_claims.warranty_claim_line,
    fields: [
      'id',
      'claim_id',
      'line_no',
      'product_id',
      'variant_id',
      'sku',
      'product_name',
      'order_line_id',
      'serial_number',
      'lot_number',
      'purchase_date',
      'warranty_months',
      'warranty_expires_at',
      'warranty_status',
      'fault_code',
      'fault_description',
      'qty_claimed',
      'qty_approved',
      'qty_received',
      'condition_on_receipt',
      'inspection_notes',
      'disposition',
      'line_status',
      'credit_amount',
      'restocking_fee',
      'core_charge_amount',
      'core_credit_amount',
      'vendor_claim_line_id',
      'organization_id',
      'tenant_id',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      lineNo: 'line_no',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    buildFilters: async (query) => ({ claim_id: { $eq: query.claimId } }),
    transformItem: transformLineItem,
  },
  actions: {
    create: {
      commandId: 'warranty_claims.claim_line.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(claimLineCreateSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }: { result: Record<string, unknown> | null }) => ({
        id: typeof result?.lineId === 'string' ? result.lineId : null,
        claimId: typeof result?.claimId === 'string' ? result.claimId : null,
      }),
      status: 201,
    },
    update: {
      commandId: 'warranty_claims.claim_line.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(claimLineUpdateSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }: { result: Record<string, unknown> | null }) => ({
        ok: true,
        id: typeof result?.lineId === 'string' ? result.lineId : null,
        claimId: typeof result?.claimId === 'string' ? result.claimId : null,
      }),
    },
    delete: {
      commandId: 'warranty_claims.claim_line.delete',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const rawRecord = toRecord(raw)
        const body = toRecord(rawRecord.body)
        const query = toRecord(rawRecord.query)
        const id = body.id ?? query.id
        if (typeof id !== 'string' || !id) {
          throw new CrudHttpError(400, { error: translate('warranty_claims.errors.notFound', 'Warranty claim line not found.') })
        }
        const claimId = typeof body.claimId === 'string'
          ? body.claimId
          : typeof query.claimId === 'string'
            ? query.claimId
            : undefined
        return lineDeleteSchema.parse(withScopedPayload({ id, claimId }, ctx, translate))
      },
      response: () => ({ ok: true }),
    },
  },
})

export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE

const lineItemSchema = z.object({
  id: z.string().uuid().nullable(),
  claimId: z.string().uuid().nullable(),
  lineNo: z.number().nullable(),
  sku: z.string().nullable(),
  productName: z.string().nullable(),
  lineStatus: z.string().nullable(),
  qtyClaimed: z.string().nullable(),
  qtyApproved: z.string().nullable(),
  creditAmount: z.string().nullable(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
}).passthrough()

export const openApi = createWarrantyClaimsCrudOpenApi({
  resourceName: 'WarrantyClaimLine',
  pluralName: 'WarrantyClaimLines',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(lineItemSchema),
  create: {
    schema: claimLineCreateSchema,
    responseSchema: z.object({ id: z.string().uuid().nullable(), claimId: z.string().uuid().nullable() }),
    description: 'Creates a line on a warranty claim and recomputes claim totals.',
  },
  update: {
    schema: claimLineUpdateSchema,
    responseSchema: z.object({
      ok: z.boolean(),
      id: z.string().uuid().nullable(),
      claimId: z.string().uuid().nullable(),
    }),
    description: 'Updates a warranty claim line and recomputes claim totals.',
  },
  del: {
    schema: lineDeleteSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Soft-deletes a warranty claim line and recomputes claim totals.',
  },
})
