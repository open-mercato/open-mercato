import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { FmsTerminal } from '../../data/entities'
import { createTerminalSchema, updateTerminalSchema } from '../../data/validators'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    limit: z.coerce.number().min(1).max(100).default(20),
    q: z.string().optional(),
    portId: z.string().uuid().optional(),
    quadrant: z.string().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['fms_locations.terminals.view'] },
  POST: { requireAuth: true, requireFeatures: ['fms_locations.terminals.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['fms_locations.terminals.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['fms_locations.terminals.manage'] },
}

export const metadata = routeMetadata

function buildSearchFilters(query: z.infer<typeof listSchema>): Record<string, unknown> {
  const filters: Record<string, unknown> = {}

  if (query.q && query.q.trim().length > 0) {
    const term = `%${escapeLikePattern(query.q.trim())}%`
    filters.$or = [
      { code: { $ilike: term } },
      { name: { $ilike: term } },
    ]
  }

  if (query.portId) {
    filters.port = query.portId
  }

  if (query.quadrant) {
    filters.quadrant = query.quadrant
  }

  return filters
}

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: FmsTerminal,
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
      'quadrant',
      'port_id',
      'organization_id',
      'tenant_id',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      id: 'id',
      code: 'code',
      name: 'name',
      quadrant: 'quadrant',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    buildFilters: async (query) => buildSearchFilters(query),
    transformItem: (item: any) => ({
      id: item.id,
      code: item.code ?? null,
      name: item.name ?? null,
      quadrant: item.quadrant ?? null,
      port_id: item.port_id ?? null,
      organization_id: item.organization_id ?? null,
      tenant_id: item.tenant_id ?? null,
      created_at: item.created_at,
      updated_at: item.updated_at,
    }),
  },
  create: {
    schema: createTerminalSchema.partial(),
    mapToEntity: (input) => ({
      ...input,
      port: input.portId,
    }),
  },
  update: {
    schema: updateTerminalSchema.partial(),
    applyToEntity: (entity, input) => {
      if (input.code !== undefined) entity.code = input.code
      if (input.name !== undefined) entity.name = input.name
      if (input.quadrant !== undefined) entity.quadrant = input.quadrant
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
