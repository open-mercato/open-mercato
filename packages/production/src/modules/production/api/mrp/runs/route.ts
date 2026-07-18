import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { MrpRun } from '../../../data/entities.js'
import { mrpRunCreateSchema, mrpRunListQuerySchema } from '../../../data/validators.js'
import { E } from '../../../../../../generated/entities.ids.generated.js'
import { createProductionCrudOpenApi, createPagedListResponseSchema } from '../../openapi.js'

const rawBodySchema = z.object({}).passthrough()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['production.mrp.view'] },
  POST: { requireAuth: true, requireFeatures: ['production.mrp.manage'] },
}

export const metadata = routeMetadata

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: MrpRun,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: E.production.mrp_run },
  list: {
    entityId: E.production.mrp_run,
    schema: mrpRunListQuerySchema,
    buildFilters: async (query: Record<string, unknown>) => (query.status ? { status: { $eq: query.status } } : {}),
    fields: ['id', 'status', 'params', 'progress_job_id', 'started_at', 'finished_at', 'stats', 'created_at', 'updated_at'],
    sortFieldMap: {
      status: 'status',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    transformItem: (item: Record<string, unknown>) => {
      if (!item) return item
      return {
        id: item.id,
        status: item.status,
        params: item.params,
        progressJobId: item.progress_job_id,
        startedAt: item.started_at,
        finishedAt: item.finished_at,
        stats: item.stats,
        createdAt: item.created_at,
        updatedAt: item.updated_at,
      }
    },
  },
  actions: {
    create: {
      commandId: 'production.mrp.createRun',
      schema: rawBodySchema,
      mapInput: async ({ raw }) => mrpRunCreateSchema.parse(raw),
      response: ({ result }) => ({ id: result?.id ?? null }),
      status: 201,
    },
  },
})

export const { GET, POST } = crud

const runListItemSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['pending', 'running', 'completed', 'failed']),
  params: z.record(z.string(), z.unknown()).nullable(),
  progressJobId: z.string().uuid().nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  stats: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const openApi = createProductionCrudOpenApi({
  resourceName: 'MrpRun',
  pluralName: 'MrpRuns',
  querySchema: mrpRunListQuerySchema,
  listResponseSchema: createPagedListResponseSchema(runListItemSchema),
  create: {
    schema: mrpRunCreateSchema,
    description: 'Creates a new MRP run and enqueues one per-tenant queue job (spec decision c).',
  },
})
