import { makeCrudRoute, type CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import { z } from 'zod'
import { FeatureToggle } from '../../data/entities'
import { E } from '@open-mercato/core/generated/entities.ids.generated'

const rawBodySchema = z.object({}).passthrough()
const listQuerySchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(200).default(50),
    search: z.string().optional(),
    category: z.string().optional(),
    name: z.string().optional(),
    identifier: z.string().optional(),
    defaultState: z.enum(['enabled', 'disabled']).optional(),
    sortField: z.enum(['id', 'category', 'identifier', 'name', 'createdAt', 'updatedAt', 'defaultState', 'failMode', 'fail_mode']).optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

type FeatureToggleListQuery = z.infer<typeof listQuerySchema>

const routeMetadata = {
  GET: { requireAuth: true, requireRoles: ['superadmin'] },
  POST: { requireAuth: true, requireRoles: ['superadmin'] },
  PUT: { requireAuth: true, requireRoles: ['superadmin'] },
  DELETE: { requireAuth: true, requireRoles: ['superadmin'] },
}

const listFields = [
  'id',
  'identifier',
  'name',
  'description',
  'category',
  'default_state',
  'fail_mode',
  'created_at',
  'updated_at',
]

const buildFilters = (query: FeatureToggleListQuery): Record<string, unknown> => {
  const filters: Record<string, unknown> = {}
  const search = query.search?.trim()
  if (search && search.length > 0) {
    const escaped = search.replace(/[%_]/g, '\\$&')
    const pattern = `%${escaped}%`
    filters.$or = [
      { identifier: { $ilike: pattern } },
      { name: { $ilike: pattern } },
      { description: { $ilike: pattern } },
      { category: { $ilike: pattern } },
    ]
  }
  const category = query.category?.trim()
  if (category && category.length > 0) {
    filters.category = { $ilike: `%${category.replace(/[%_]/g, '\\$&')}%` }
  }
  const name = query.name?.trim()
  if (name && name.length > 0) {
    filters.name = { $ilike: `%${name.replace(/[%_]/g, '\\$&')}%` }
  }
  const identifier = query.identifier?.trim()
  if (identifier && identifier.length > 0) {
    filters.identifier = { $ilike: `%${identifier.replace(/[%_]/g, '\\$&')}%` }
  }
  if (query.defaultState === 'enabled') {
    filters.default_state = true
  } else if (query.defaultState === 'disabled') {
    filters.default_state = false
  }
  return filters
}


const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: FeatureToggle,
    idField: 'id',
    orgField: null,
    tenantField: "tenantId",
    softDeleteField: 'deletedAt'
  },
  list: {
    schema: listQuerySchema,
    entityId: E.feature_toggles.feature_toggle,
    fields: listFields,
    sortFieldMap: {
      id: 'id',
      category: 'category',
      identifier: 'identifier',
      name: 'name',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      defaultState: 'default_state',
      failMode: 'fail_mode',
      fail_mode: 'fail_mode',
    },
    buildFilters: async (query) => buildFilters(query),
  },
  actions: {
    create: {
      commandId: 'feature_toggles.global.create',
      schema: rawBodySchema,
      response: ({ result }) => ({ id: result?.toggleId ?? result?.id ?? null }),
      status: 201,
    },
    update: {
      commandId: 'feature_toggles.global.update',
      schema: rawBodySchema,
      response: ({ result }) => ({ id: result?.toggleId ?? result?.id ?? null }),
      status: 200,
    },
    delete: {
      commandId: 'feature_toggles.global.delete',
      schema: rawBodySchema,
      response: ({ result }) => ({ id: result?.toggleId ?? result?.id ?? null }),
      status: 200,
    },
  }
})

export const metadata = crud.metadata
export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE
