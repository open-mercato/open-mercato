import { z } from 'zod'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { DataQualitySuite } from '../../data/entities'
import {
  createSuiteSchema,
  listSuitesSchema,
  updateSuiteSchema,
} from '../../data/validators'
import {
  createDataQualityCrudOpenApi,
  createPagedListResponseSchema,
} from '../openapi'
import { toIsoString } from '../helpers'

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['data_quality.suite.view'] },
  POST: { requireAuth: true, requireFeatures: ['data_quality.suite.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['data_quality.suite.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['data_quality.suite.manage'] },
}

export const metadata = routeMetadata

const updateSuiteWithIdSchema = updateSuiteSchema.extend({
  id: z.string().uuid(),
})

const deleteSuiteSchema = z.object({
  id: z.string().uuid(),
})

const idResponseSchema = z.object({
  id: z.string().uuid(),
})

const suiteListItemSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  enabled: z.boolean(),
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
})

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: DataQualitySuite,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: 'data_quality:data_quality_suite' },
  list: {
    schema: listSuitesSchema,
    entityId: 'data_quality:data_quality_suite',
    fields: [
      'id',
      'code',
      'name',
      'description',
      'enabled',
      'tenant_id',
      'organization_id',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      code: 'code',
      name: 'name',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    buildFilters: async (query) => {
      const filters: Record<string, unknown> = {}
      const search = typeof query.search === 'string' ? query.search.trim() : ''

      if (search.length > 0) {
        const like = `%${escapeLikePattern(search)}%`
        filters.$or = [
          { code: { $ilike: like } },
          { name: { $ilike: like } },
          { description: { $ilike: like } },
        ]
      }

      const enabled = parseBooleanToken(query.enabled)
      if (enabled != null) {
        filters.enabled = enabled
      }

      return filters
    },
    transformItem: (item) => ({
      id: String(item.id),
      code: typeof item.code === 'string' ? item.code : '',
      name: typeof item.name === 'string' ? item.name : '',
      description: typeof item.description === 'string' ? item.description : null,
      enabled: Boolean(item.enabled),
      tenantId: typeof item.tenant_id === 'string' ? item.tenant_id : '',
      organizationId: typeof item.organization_id === 'string' ? item.organization_id : '',
      createdAt: toIsoString(item.created_at),
      updatedAt: toIsoString(item.updated_at),
    }),
  },
  actions: {
    create: {
      commandId: 'data_quality.suite.create',
      schema: createSuiteSchema,
      status: 201,
      response: ({ result }) => ({ id: result.id }),
    },
    update: {
      commandId: 'data_quality.suite.update',
      schema: updateSuiteWithIdSchema,
      response: ({ result }) => ({ id: result.id }),
    },
    delete: {
      commandId: 'data_quality.suite.delete',
      schema: deleteSuiteSchema,
      response: ({ result }) => ({ id: result.id }),
    },
  },
})

export const openApi = createDataQualityCrudOpenApi({
  resourceName: 'Data Quality Suite',
  pluralName: 'Data Quality Suites',
  querySchema: listSuitesSchema,
  listResponseSchema: createPagedListResponseSchema(suiteListItemSchema),
  create: {
    schema: createSuiteSchema,
    responseSchema: idResponseSchema,
    description: 'Creates a data quality suite.',
  },
  update: {
    schema: updateSuiteWithIdSchema,
    responseSchema: idResponseSchema,
    description: 'Updates a data quality suite.',
  },
  del: {
    schema: deleteSuiteSchema,
    responseSchema: idResponseSchema,
    description: 'Deletes a data quality suite.',
  },
})

export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE
