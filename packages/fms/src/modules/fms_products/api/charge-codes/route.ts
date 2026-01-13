import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { FmsChargeCode } from '../../data/entities'
import { createChargeCodeSchema, updateChargeCodeSchema } from '../../data/validators'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    limit: z.coerce.number().min(1).max(100).default(20),
    q: z.string().optional(),
    chargeUnit: z.enum(['per_container', 'per_piece', 'one_time']).optional(),
    isActive: z.coerce.boolean().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .loose()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['fms_products.charge_codes.view'] },
  POST: { requireAuth: true, requireFeatures: ['fms_products.charge_codes.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['fms_products.charge_codes.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['fms_products.charge_codes.manage'] },
}

export const metadata = routeMetadata

function buildSearchFilters(query: z.infer<typeof listSchema>): Record<string, unknown> {
  const filters: Record<string, unknown> = {}

  if (query.q && query.q.trim().length > 0) {
    const term = `%${escapeLikePattern(query.q.trim())}%`
    filters.$or = [
      { code: { $ilike: term } },
      { description: { $ilike: term } },
    ]
  }

  if (query.chargeUnit) {
    filters.chargeUnit = query.chargeUnit
  }

  if (query.isActive !== undefined) {
    filters.isActive = query.isActive
  }

  return filters
}

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: FmsChargeCode,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  list: {
    schema: listSchema,
    fields: [
      'id',
      'code',
      'description',
      'charge_unit',
      'field_schema',
      'is_active',
      'organization_id',
      'tenant_id',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      id: 'id',
      code: 'code',
      description: 'description',
      chargeUnit: 'charge_unit',
      isActive: 'is_active',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    buildFilters: async (query) => buildSearchFilters(query),
    transformItem: (item: any) => ({
      id: item.id,
      code: item.code ?? null,
      description: item.description ?? null,
      chargeUnit: item.charge_unit ?? null,
      fieldSchema: item.field_schema ?? null,
      isActive: item.is_active ?? true,
      organization_id: item.organization_id ?? null,
      tenant_id: item.tenant_id ?? null,
      created_at: item.created_at,
      updated_at: item.updated_at,
    }),
  },
  create: {
    schema: createChargeCodeSchema.partial(),
    mapToEntity: (input) => ({
      ...input,
    }),
  },
  update: {
    schema: updateChargeCodeSchema.partial(),
    applyToEntity: (entity, input) => {
      if (input.description !== undefined) entity.description = input.description
      if (input.chargeUnit !== undefined) entity.chargeUnit = input.chargeUnit
      if (input.fieldSchema !== undefined) entity.fieldSchema = input.fieldSchema
      if (input.isActive !== undefined) entity.isActive = input.isActive
      entity.updatedAt = new Date()
      if (input.updatedBy !== undefined) entity.updatedBy = input.updatedBy
    },
  },
  del: {
    softDelete: true,
  },
})

export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE
