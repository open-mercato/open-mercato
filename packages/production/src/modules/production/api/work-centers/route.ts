import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { resolveCrudRecordId } from '@open-mercato/shared/lib/api/scoped'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { WorkCenter } from '../../data/entities.js'
import {
  workCenterCreateSchema,
  workCenterUpdateSchema,
  workCenterListQuerySchema,
} from '../../data/validators.js'
import { E } from '../../../../../generated/entities.ids.generated.js'
import {
  createProductionCrudOpenApi,
  createPagedListResponseSchema,
  defaultOkResponseSchema,
} from '../openapi.js'

const rawBodySchema = z.object({}).passthrough()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['production.technology.view'] },
  POST: { requireAuth: true, requireFeatures: ['production.technology.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['production.technology.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['production.technology.manage'] },
}

export const metadata = routeMetadata

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: WorkCenter,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: E.production.work_center },
  list: {
    entityId: E.production.work_center,
    schema: workCenterListQuerySchema,
    fields: [
      'id',
      'name',
      'kind',
      'cost_rate_per_hour',
      'parallel_stations',
      'efficiency_factor',
      'availability_rule_set_id',
      'is_active',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      name: 'name',
      kind: 'kind',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    transformItem: (item: Record<string, unknown>) => {
      if (!item) return item
      return {
        id: item.id,
        name: item.name,
        kind: item.kind,
        costRatePerHour: item.cost_rate_per_hour,
        parallelStations: item.parallel_stations,
        efficiencyFactor: item.efficiency_factor,
        availabilityRuleSetId: item.availability_rule_set_id,
        isActive: item.is_active,
        createdAt: item.created_at,
        updatedAt: item.updated_at,
      }
    },
  },
  actions: {
    create: {
      commandId: 'production.work_centers.create',
      schema: rawBodySchema,
      mapInput: async ({ raw }) => workCenterCreateSchema.parse(raw),
      response: ({ result }) => ({ id: result?.id ?? null }),
      status: 201,
    },
    update: {
      commandId: 'production.work_centers.update',
      schema: rawBodySchema,
      mapInput: async ({ raw }) => workCenterUpdateSchema.parse(raw),
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'production.work_centers.delete',
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => {
        const { translate } = await resolveTranslations()
        const id = resolveCrudRecordId(parsed, ctx, translate)
        if (!id) {
          throw new CrudHttpError(400, { error: translate('production.errors.id_required', 'Record id is required') })
        }
        return { id }
      },
      response: () => ({ ok: true }),
    },
  },
})

export const { GET, POST, PUT, DELETE } = crud

const workCenterListItemSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  kind: z.enum(['machine', 'manual', 'line', 'subcontractor']),
  costRatePerHour: z.string(),
  parallelStations: z.number(),
  efficiencyFactor: z.string(),
  availabilityRuleSetId: z.string().uuid().nullable(),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const openApi = createProductionCrudOpenApi({
  resourceName: 'WorkCenter',
  pluralName: 'WorkCenters',
  querySchema: workCenterListQuerySchema,
  listResponseSchema: createPagedListResponseSchema(workCenterListItemSchema),
  create: {
    schema: workCenterCreateSchema,
    description: 'Creates a new production work center.',
  },
  update: {
    schema: workCenterUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates an existing work center by ID.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Soft-deletes a work center by ID.',
  },
})
