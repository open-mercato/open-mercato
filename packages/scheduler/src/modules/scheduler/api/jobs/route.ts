import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { resolveCrudRecordId } from '@open-mercato/shared/lib/api/scoped'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { ScheduledJob } from '../../data/entities.js'
import {
  scheduleCreateSchema,
  scheduleUpdateSchema,
  scheduleDeleteSchema,
  scheduleListQuerySchema,
} from '../../data/validators.js'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import {
  createSchedulerCrudOpenApi,
  createPagedListResponseSchema,
  defaultOkResponseSchema,
} from '../openapi.js'

const rawBodySchema = z.object({}).passthrough()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['scheduler.jobs.view'] },
  POST: { requireAuth: true, requireFeatures: ['scheduler.jobs.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['scheduler.jobs.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['scheduler.jobs.manage'] },
}

export const metadata = routeMetadata

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: ScheduledJob,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  list: {
    schema: scheduleListQuerySchema,
    fields: [
      'id',
      'name',
      'description',
      'scope_type',
      'organization_id',
      'tenant_id',
      'schedule_type',
      'schedule_value',
      'timezone',
      'target_type',
      'target_queue',
      'target_command',
      'target_payload',
      'require_feature',
      'is_enabled',
      'last_run_at',
      'next_run_at',
      'source_type',
      'source_module',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      name: 'name',
      nextRunAt: 'next_run_at',
      lastRunAt: 'last_run_at',
      createdAt: 'created_at',
    },
    buildFilters: async (query, ctx) => {
      const filters: Record<string, any> = {}

      if (query.id) {
        filters.id = { $eq: query.id }
      }

      if (query.search) {
        filters.$or = [
          { name: { $ilike: `%${escapeLikePattern(query.search)}%` } },
          { description: { $ilike: `%${escapeLikePattern(query.search)}%` } },
        ]
      }

      if (query.scopeType) {
        filters.scopeType = { $eq: query.scopeType }
      }

      if (query.isEnabled !== undefined) {
        filters.isEnabled = { $eq: query.isEnabled }
      }

      if (query.sourceType) {
        filters.sourceType = { $eq: query.sourceType }
      }

      if (query.sourceModule) {
        filters.sourceModule = { $eq: query.sourceModule }
      }

      return filters
    },
  },
  actions: {
    create: {
      commandId: 'scheduler.jobs.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        // Auto-populate organizationId and tenantId based on scopeType
        const scopeType = raw.scopeType
        let organizationId = raw.organizationId
        let tenantId = raw.tenantId
        
        if (scopeType === 'system') {
          // System scope: no org/tenant
          organizationId = null
          tenantId = null
        } else if (scopeType === 'organization') {
          // Organization scope: use auth context (orgId and tenantId)
          organizationId = ctx.auth?.orgId ?? null
          tenantId = ctx.auth?.tenantId ?? null
        } else if (scopeType === 'tenant') {
          // Tenant scope: use auth context tenantId only
          organizationId = null
          tenantId = ctx.auth?.tenantId ?? null
        }
        
        const parsed = scheduleCreateSchema.parse({
          ...raw,
          organizationId,
          tenantId,
        })
        return parsed
      },
      response: ({ result }) => ({
        id: result?.id ?? null,
      }),
      status: 201,
    },
    update: {
      commandId: 'scheduler.jobs.update',
      schema: rawBodySchema,
      mapInput: async ({ raw }) => {
        const parsed = scheduleUpdateSchema.parse(raw)
        return parsed
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'scheduler.jobs.delete',
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => {
        const { translate } = await resolveTranslations()
        const id = resolveCrudRecordId(parsed, ctx, translate)
        if (!id) {
          throw new CrudHttpError(400, { 
            error: translate('scheduler.errors.id_required', 'Schedule id is required') 
          })
        }
        return { id }
      },
      response: () => ({ ok: true }),
    },
  },
})

export const { GET, POST, PUT, DELETE } = crud

// Response schemas
const scheduledJobListItemSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  scopeType: z.enum(['system', 'organization', 'tenant']),
  organizationId: z.string().uuid().nullable(),
  tenantId: z.string().uuid().nullable(),
  scheduleType: z.enum(['cron', 'interval']),
  scheduleValue: z.string(),
  timezone: z.string(),
  targetType: z.enum(['queue', 'command']),
  targetQueue: z.string().nullable(),
  targetCommand: z.string().nullable(),
  targetPayload: z.record(z.string(), z.unknown()).nullable(),
  requireFeature: z.string().nullable(),
  isEnabled: z.boolean(),
  lastRunAt: z.string().nullable(),
  nextRunAt: z.string().nullable(),
  sourceType: z.enum(['user', 'module']),
  sourceModule: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

// OpenAPI specification
export const openApi = createSchedulerCrudOpenApi({
  resourceName: 'ScheduledJob',
  pluralName: 'ScheduledJobs',
  querySchema: scheduleListQuerySchema,
  listResponseSchema: createPagedListResponseSchema(scheduledJobListItemSchema),
  create: {
    schema: scheduleCreateSchema,
    description: 'Creates a new scheduled job with cron or interval-based scheduling.',
  },
  update: {
    schema: scheduleUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates an existing scheduled job by ID.',
  },
  del: {
    schema: scheduleDeleteSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Deletes a scheduled job by ID.',
  },
})
