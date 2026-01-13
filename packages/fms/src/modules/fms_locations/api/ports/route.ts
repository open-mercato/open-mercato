import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { FmsLocation } from '../../data/entities'
import { createPortSchema, updatePortSchema } from '../../data/validators'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    limit: z.coerce.number().min(1).max(100).default(20),
    q: z.string().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['fms_locations.ports.view'] },
  POST: { requireAuth: true, requireFeatures: ['fms_locations.ports.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['fms_locations.ports.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['fms_locations.ports.manage'] },
}

export const metadata = routeMetadata

function buildSearchFilters(query: z.infer<typeof listSchema>): Record<string, unknown> {
  const filters: Record<string, unknown> = {
    type: 'port',
  }

  if (query.q && query.q.trim().length > 0) {
    const term = `%${escapeLikePattern(query.q.trim())}%`
    filters.$or = [
      { code: { $ilike: term } },
      { name: { $ilike: term } },
    ]
  }

  return filters
}

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: FmsLocation,
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
      'name',
      'locode',
      'lat',
      'lng',
      'city',
      'country',
      'organization_id',
      'tenant_id',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      id: 'id',
      code: 'code',
      name: 'name',
      locode: 'locode',
      city: 'city',
      country: 'country',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    buildFilters: async (query) => buildSearchFilters(query),
    transformItem: (item: any) => ({
      id: item.id,
      code: item.code ?? null,
      name: item.name ?? null,
      locode: item.locode ?? null,
      lat: item.lat ?? null,
      lng: item.lng ?? null,
      city: item.city ?? null,
      country: item.country ?? null,
      organization_id: item.organization_id ?? null,
      tenant_id: item.tenant_id ?? null,
      created_at: item.created_at,
      updated_at: item.updated_at,
    }),
  },
  create: {
    schema: createPortSchema.partial(),
    mapToEntity: (input) => ({
      ...input,
      type: 'port' as const,
    }),
  },
  update: {
    schema: updatePortSchema.partial(),
    applyToEntity: (entity, input) => {
      if (input.code !== undefined) entity.code = input.code
      if (input.name !== undefined) entity.name = input.name
      if (input.locode !== undefined) entity.locode = input.locode
      if (input.lat !== undefined) entity.lat = input.lat
      if (input.lng !== undefined) entity.lng = input.lng
      if (input.city !== undefined) entity.city = input.city
      if (input.country !== undefined) entity.country = input.country
      entity.updatedAt = new Date()
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
