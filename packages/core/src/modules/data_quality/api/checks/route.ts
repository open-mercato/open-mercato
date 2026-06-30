import { z } from 'zod'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { DataQualityCheck } from '../../data/entities'
import {
  createCheckSchema,
  listChecksSchema,
  updateCheckSchema,
} from '../../data/validators'
import {
  createDataQualityCrudOpenApi,
  createPagedListResponseSchema,
} from '../openapi'
import { toIsoString } from '../helpers'

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['data_quality.check.view'] },
  POST: { requireAuth: true, requireFeatures: ['data_quality.check.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['data_quality.check.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['data_quality.check.manage'] },
}

export const metadata = routeMetadata

const updateCheckWithIdSchema = updateCheckSchema.extend({
  id: z.string().uuid(),
})

const deleteCheckSchema = z.object({
  id: z.string().uuid(),
})

const idResponseSchema = z.object({
  id: z.string().uuid(),
})

const checkListItemSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  targetEntityType: z.string(),
  failureExpression: z.record(z.string(), z.unknown()).nullable(),
  severity: z.string(),
  weight: z.number(),
  enabled: z.boolean(),
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
})

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: DataQualityCheck,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: 'data_quality:data_quality_check' },
  list: {
    schema: listChecksSchema,
    entityId: 'data_quality:data_quality_check',
    fields: [
      'id',
      'code',
      'name',
      'description',
      'target_entity_type',
      'failure_expression',
      'severity',
      'weight',
      'enabled',
      'tenant_id',
      'organization_id',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      code: 'code',
      name: 'name',
      severity: 'severity',
      targetEntityType: 'target_entity_type',
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

      if (query.targetEntityType) {
        filters.target_entity_type = { $eq: query.targetEntityType }
      }

      if (query.severity) {
        filters.severity = { $eq: query.severity }
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
      targetEntityType: typeof item.target_entity_type === 'string' ? item.target_entity_type : '',
      failureExpression: item.failure_expression && typeof item.failure_expression === 'object'
        ? item.failure_expression as Record<string, unknown>
        : null,
      severity: typeof item.severity === 'string' ? item.severity : '',
      weight: typeof item.weight === 'number' ? item.weight : Number(item.weight ?? 0),
      enabled: Boolean(item.enabled),
      tenantId: typeof item.tenant_id === 'string' ? item.tenant_id : '',
      organizationId: typeof item.organization_id === 'string' ? item.organization_id : '',
      createdAt: toIsoString(item.created_at),
      updatedAt: toIsoString(item.updated_at),
    }),
  },
  actions: {
    create: {
      commandId: 'data_quality.check.create',
      schema: createCheckSchema,
      status: 201,
      response: ({ result }) => ({ id: result.id }),
    },
    update: {
      commandId: 'data_quality.check.update',
      schema: updateCheckWithIdSchema,
      response: ({ result }) => ({ id: result.id }),
    },
    delete: {
      commandId: 'data_quality.check.delete',
      schema: deleteCheckSchema,
      response: ({ result }) => ({ id: result.id }),
    },
  },
})

export const openApi = createDataQualityCrudOpenApi({
  resourceName: 'Data Quality Check',
  pluralName: 'Data Quality Checks',
  querySchema: listChecksSchema,
  listResponseSchema: createPagedListResponseSchema(checkListItemSchema),
  create: {
    schema: createCheckSchema,
    responseSchema: idResponseSchema,
    description: 'Creates a data quality check.',
  },
  update: {
    schema: updateCheckWithIdSchema,
    responseSchema: idResponseSchema,
    description: 'Updates a data quality check.',
  },
  del: {
    schema: deleteCheckSchema,
    responseSchema: idResponseSchema,
    description: 'Deletes a data quality check.',
  },
})

export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE
