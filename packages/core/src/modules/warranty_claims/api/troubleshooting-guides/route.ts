import { z } from 'zod'
import type { CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { parseBooleanFromUnknown } from '@open-mercato/shared/lib/boolean'
import { buildIlikeTerm } from '@open-mercato/shared/lib/db/buildIlikeTerm'
import { E } from '#generated/entities.ids.generated'
import * as F from '#generated/entities/warranty_troubleshooting_guide'
import { WarrantyTroubleshootingGuide } from '../../data/entities'
import {
  claimTypeSchema,
  troubleshootingGuideCreateSchema,
  troubleshootingGuideUpdateSchema,
  troubleshootingGuideDeleteSchema,
  type TroubleshootingGuideCreateInput,
  type TroubleshootingGuideUpdateInput,
} from '../../data/validators'
import { parseGuideSteps, type TroubleshootingNode } from '../../lib/troubleshooting'
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

const optionalReasonCodeSchema = z.preprocess((value) => {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  return trimmed.length ? trimmed : undefined
}, z.string().max(120).optional())

const booleanQuerySchema = z.preprocess((value) => parseBooleanFromUnknown(value) ?? undefined, z.boolean().optional())

const listSchema = z
  .object({
    id: uuid.optional(),
    ids: idsSchema,
    claimType: claimTypeSchema.optional(),
    reasonCode: optionalReasonCodeSchema,
    isActive: booleanQuerySchema,
    search: z.string().trim().max(300).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    sortField: z.enum(['title', 'claimType', 'reasonCode', 'updatedAt', 'createdAt']).optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

type TroubleshootingGuideListQuery = z.infer<typeof listSchema>
type RawTroubleshootingGuideInput = z.infer<typeof rawBodySchema>

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['warranty_claims.troubleshooting.manage'] },
  POST: { requireAuth: true, requireFeatures: ['warranty_claims.troubleshooting.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['warranty_claims.troubleshooting.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['warranty_claims.troubleshooting.manage'] },
}

export const metadata = routeMetadata

const baseListFields = [
  F.id,
  F.organization_id,
  F.tenant_id,
  F.title,
  F.claim_type,
  F.reason_code,
  F.is_active,
  F.created_at,
  F.updated_at,
  F.deleted_at,
]

const detailFields = [...baseListFields, F.steps]

function scopeFromContext(ctx: CrudCtx): { organizationId: string; tenantId: string } {
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  const tenantId = ctx.auth?.tenantId ?? null
  if (!organizationId || !tenantId) {
    throw new CrudHttpError(400, { error: '[internal] warranty troubleshooting guide scope is missing' })
  }
  return { organizationId, tenantId }
}

function parseCreateInput(input: RawTroubleshootingGuideInput, ctx: CrudCtx): TroubleshootingGuideCreateInput {
  return troubleshootingGuideCreateSchema.parse({
    ...input,
    ...scopeFromContext(ctx),
  })
}

function parseUpdateInput(input: RawTroubleshootingGuideInput, ctx: CrudCtx): TroubleshootingGuideUpdateInput {
  return troubleshootingGuideUpdateSchema.parse({
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

function toEntitySteps(value: unknown): Record<string, unknown> | null {
  if (value === undefined || value === null) return null
  const parsed = parseGuideSteps(value)
  if (!parsed) {
    throw new CrudHttpError(400, { error: 'warranty_claims.errors.invalidTroubleshootingSteps' })
  }
  return { prompt: parsed.prompt, options: parsed.options }
}

function toTroubleshootingGuideEntityData(input: TroubleshootingGuideCreateInput): Record<string, unknown> {
  return {
    claimType: input.claimType ?? null,
    reasonCode: toNullableText(input.reasonCode),
    title: input.title,
    steps: toEntitySteps(input.steps),
    isActive: input.isActive !== false,
  }
}

function applyTroubleshootingGuideUpdate(
  entity: WarrantyTroubleshootingGuide,
  input: TroubleshootingGuideUpdateInput,
): void {
  if (hasOwn(input, 'claimType')) entity.claimType = input.claimType ?? null
  if (hasOwn(input, 'reasonCode')) entity.reasonCode = toNullableText(input.reasonCode)
  if (hasOwn(input, 'title') && input.title) entity.title = input.title
  if (hasOwn(input, 'steps')) entity.steps = toEntitySteps(input.steps)
  if (hasOwn(input, 'isActive')) entity.isActive = input.isActive !== false
}

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

function isDetailQuery(query: TroubleshootingGuideListQuery): boolean {
  if (query.id) return true
  return Array.isArray(query.ids) && query.ids.length === 1
}

function readSteps(record: Record<string, unknown>): TroubleshootingNode | null {
  if (!hasOwn(record, 'steps')) return null
  return parseGuideSteps(record.steps)
}

function transformTroubleshootingGuideItem(item: unknown): unknown {
  const record = toRecord(item)
  if (!Object.keys(record).length) return item
  const result: Record<string, unknown> = {
    id: readString(record, 'id', 'id'),
    organizationId: readString(record, 'organization_id', 'organizationId'),
    tenantId: readString(record, 'tenant_id', 'tenantId'),
    title: readString(record, 'title', 'title'),
    claimType: readString(record, 'claim_type', 'claimType'),
    reasonCode: readString(record, 'reason_code', 'reasonCode'),
    isActive: readBool(record, 'is_active', 'isActive'),
    createdAt: toIso(record.created_at ?? record.createdAt),
    updatedAt: toIso(record.updated_at ?? record.updatedAt),
    deletedAt: toIso(record.deleted_at ?? record.deletedAt),
  }
  if (hasOwn(record, 'steps')) result.steps = readSteps(record)
  return result
}

const crud = makeCrudRoute<RawTroubleshootingGuideInput, RawTroubleshootingGuideInput, TroubleshootingGuideListQuery>({
  metadata: routeMetadata,
  orm: {
    entity: WarrantyTroubleshootingGuide,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: E.warranty_claims.warranty_troubleshooting_guide },
  list: {
    schema: listSchema,
    entityId: E.warranty_claims.warranty_troubleshooting_guide,
    fields: (query) => (isDetailQuery(query) ? detailFields : baseListFields),
    sortFieldMap: {
      title: F.title,
      claimType: F.claim_type,
      reasonCode: F.reason_code,
      createdAt: F.created_at,
      updatedAt: F.updated_at,
    },
    buildFilters: async (query) => {
      const filters: Record<string, unknown> = {}
      if (query.id) filters.id = { $eq: query.id }
      if (query.claimType) filters[F.claim_type] = { $eq: query.claimType }
      if (query.reasonCode) filters[F.reason_code] = { $eq: query.reasonCode }
      if (query.isActive !== undefined) filters[F.is_active] = { $eq: query.isActive }
      if (query.search) {
        filters.$or = [{ [F.title]: { $ilike: buildIlikeTerm(query.search) } }]
      }
      return filters
    },
    transformItem: transformTroubleshootingGuideItem,
  },
  create: {
    schema: rawBodySchema,
    mapToEntity: (input, ctx) => toTroubleshootingGuideEntityData(parseCreateInput(input, ctx)),
  },
  update: {
    schema: rawBodySchema,
    getId: (input) => {
      const id = input.id
      return typeof id === 'string' ? id : ''
    },
    applyToEntity: (entity, input, ctx) => {
      applyTroubleshootingGuideUpdate(entity as WarrantyTroubleshootingGuide, parseUpdateInput(input, ctx))
    },
    response: () => ({ ok: true }),
  },
  del: { idFrom: 'query', softDelete: true, response: () => ({ ok: true }) },
})

export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE

const troubleshootingStepsSchema = z.record(z.string(), z.unknown())

const troubleshootingGuideListItemSchema = z.object({
  id: z.string().uuid().nullable(),
  organizationId: z.string().uuid().nullable(),
  tenantId: z.string().uuid().nullable(),
  title: z.string().nullable(),
  claimType: claimTypeSchema.nullable(),
  reasonCode: z.string().nullable(),
  steps: troubleshootingStepsSchema.nullable().optional(),
  isActive: z.boolean(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
}).passthrough()

export const openApi = createWarrantyClaimsCrudOpenApi({
  resourceName: 'WarrantyTroubleshootingGuide',
  pluralName: 'WarrantyTroubleshootingGuides',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(troubleshootingGuideListItemSchema),
  create: {
    schema: troubleshootingGuideCreateSchema,
    responseSchema: z.object({ id: z.string().uuid() }),
    description: 'Creates a guided warranty troubleshooting decision tree.',
  },
  update: {
    schema: troubleshootingGuideUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates a guided warranty troubleshooting decision tree.',
  },
  del: {
    schema: troubleshootingGuideDeleteSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Soft-deletes a guided warranty troubleshooting decision tree.',
  },
})
