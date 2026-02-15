import { makeCrudRoute, type CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { FeatureToggle } from '../../data/entities'
import { E } from '#generated/entities.ids.generated'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { toggleTypeSchema, toggleCreateSchema, toggleUpdateSchema } from '../../data/validators'
import {
  featureTogglesTag,
  featureToggleListResponseSchema,
  featureToggleErrorSchema
} from '../openapi'

const rawBodySchema = z.object({}).passthrough()
const listQuerySchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(200).default(50),
    search: z.string().optional(),
    type: toggleTypeSchema.optional(),
    category: z.string().optional(),
    name: z.string().optional(),
    identifier: z.string().optional(),
    sortField: z.enum(['id', 'category', 'identifier', 'name', 'createdAt', 'updatedAt', 'type']).optional(),
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
  'type',
  'default_value',
  'created_at',
  'updated_at',
]

const buildFilters = (query: FeatureToggleListQuery): Record<string, unknown> => {
  const filters: Record<string, unknown> = {}
  const search = query.search?.trim()
  if (search && search.length > 0) {
    const escaped = escapeLikePattern(search)
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
    filters.category = { $ilike: `%${escapeLikePattern(category)}%` }
  }
  const name = query.name?.trim()
  if (name && name.length > 0) {
    filters.name = { $ilike: `%${escapeLikePattern(name)}%` }
  }
  const identifier = query.identifier?.trim()
  if (identifier && identifier.length > 0) {
    filters.identifier = { $ilike: `%${escapeLikePattern(identifier)}%` }
  }
  const type = query.type?.trim()
  if (type && type.length > 0) {
    filters.type = { $eq: query.type }
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
      type: 'type',
    },
    transformItem: (item: Record<string, unknown>) => {
      if (!item) return item
      return {
        id: item.id,
        identifier: item.identifier,
        name: item.name,
        description: item.description ?? null,
        category: item.category ?? null,
        type: item.type,
        defaultValue: item.default_value,
        created_at: item.created_at,
        updated_at: item.updated_at,
      }
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

const createResponseSchema = z.object({
  id: z.string().uuid(),
})

const updateResponseSchema = z.object({
  id: z.string().uuid(),
})

const deleteResponseSchema = z.object({
  id: z.string().uuid(),
})

export const openApi: OpenApiRouteDoc = {
  tag: featureTogglesTag,
  summary: 'Global feature toggle management',
  methods: {
    GET: {
      summary: 'List global feature toggles',
      description: 'Returns all global feature toggles with filtering and pagination. Requires superadmin role.',
      query: listQuerySchema,
      responses: [
        { status: 200, description: 'Feature toggles collection', schema: featureToggleListResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid query parameters', schema: featureToggleErrorSchema },
        { status: 401, description: 'Unauthorized', schema: featureToggleErrorSchema },
        { status: 403, description: 'Forbidden - superadmin role required', schema: featureToggleErrorSchema },
      ],
    },
    POST: {
      summary: 'Create global feature toggle',
      description: 'Creates a new global feature toggle. Requires superadmin role.',
      requestBody: {
        contentType: 'application/json',
        schema: toggleCreateSchema,
      },
      responses: [
        {
          status: 201,
          description: 'Feature toggle created',
          schema: createResponseSchema,
        },
      ],
      errors: [
        { status: 400, description: 'Invalid payload', schema: featureToggleErrorSchema },
        { status: 401, description: 'Unauthorized', schema: featureToggleErrorSchema },
        { status: 403, description: 'Forbidden - superadmin role required', schema: featureToggleErrorSchema },
      ],
    },
    PUT: {
      summary: 'Update global feature toggle',
      description: 'Updates an existing global feature toggle. Requires superadmin role.',
      requestBody: {
        contentType: 'application/json',
        schema: toggleUpdateSchema,
      },
      responses: [
        {
          status: 200,
          description: 'Feature toggle updated',
          schema: updateResponseSchema,
        },
      ],
      errors: [
        { status: 400, description: 'Invalid payload', schema: featureToggleErrorSchema },
        { status: 401, description: 'Unauthorized', schema: featureToggleErrorSchema },
        { status: 403, description: 'Forbidden - superadmin role required', schema: featureToggleErrorSchema },
        { status: 404, description: 'Feature toggle not found', schema: featureToggleErrorSchema },
      ],
    },
    DELETE: {
      summary: 'Delete global feature toggle',
      description: 'Soft deletes a global feature toggle by ID. Requires superadmin role.',
      query: z.object({ id: z.string().uuid().describe('Feature toggle identifier') }),
      responses: [
        { status: 200, description: 'Feature toggle deleted', schema: deleteResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid identifier', schema: featureToggleErrorSchema },
        { status: 401, description: 'Unauthorized', schema: featureToggleErrorSchema },
        { status: 403, description: 'Forbidden - superadmin role required', schema: featureToggleErrorSchema },
        { status: 404, description: 'Feature toggle not found', schema: featureToggleErrorSchema },
      ],
    },
  },
}
