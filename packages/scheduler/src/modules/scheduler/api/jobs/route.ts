import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { ScheduledJob } from '../../data/entities.js'
import {
  scheduleCreateSchema,
  scheduleUpdateSchema,
  scheduleListQuerySchema,
} from '../../data/validators.js'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'

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
      mapInput: async ({ raw }) => {
        const parsed = scheduleCreateSchema.parse(raw)
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
      mapInput: async ({ raw }) => {
        const id = raw?.id
        if (!id) {
          throw new Error('Schedule id is required')
        }
        return { id }
      },
      response: () => ({ ok: true }),
    },
  },
})

export const { GET, POST, PUT, DELETE } = crud

// OpenAPI specification
export const openApi = {
  GET: {
    tags: ['Scheduler'],
    summary: 'List scheduled jobs',
    description: 'Get a paginated list of scheduled jobs',
    parameters: [
      { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
      { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
      { name: 'search', in: 'query', schema: { type: 'string' } },
      { name: 'scopeType', in: 'query', schema: { type: 'string', enum: ['system', 'organization', 'tenant'] } },
      { name: 'isEnabled', in: 'query', schema: { type: 'boolean' } },
      { name: 'sourceType', in: 'query', schema: { type: 'string', enum: ['user', 'module'] } },
      { name: 'sourceModule', in: 'query', schema: { type: 'string' } },
    ],
    responses: {
      200: {
        description: 'List of scheduled jobs',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                data: { type: 'array', items: { type: 'object' } },
                total: { type: 'integer' },
                page: { type: 'integer' },
                pageSize: { type: 'integer' },
              },
            },
          },
        },
      },
    },
  },
  POST: {
    tags: ['Scheduler'],
    summary: 'Create a scheduled job',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['name', 'scopeType', 'scheduleType', 'scheduleValue', 'targetType'],
            properties: {
              name: { type: 'string' },
              description: { type: 'string', nullable: true },
              scopeType: { type: 'string', enum: ['system', 'organization', 'tenant'] },
              organizationId: { type: 'string', format: 'uuid', nullable: true },
              tenantId: { type: 'string', format: 'uuid', nullable: true },
              scheduleType: { type: 'string', enum: ['cron', 'interval'] },
              scheduleValue: { type: 'string' },
              timezone: { type: 'string', default: 'UTC' },
              targetType: { type: 'string', enum: ['queue', 'command'] },
              targetQueue: { type: 'string', nullable: true },
              targetCommand: { type: 'string', nullable: true },
              targetPayload: { type: 'object', nullable: true },
              requireFeature: { type: 'string', nullable: true },
              isEnabled: { type: 'boolean', default: true },
            },
          },
        },
      },
    },
    responses: {
      201: {
        description: 'Schedule created',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                id: { type: 'string', format: 'uuid' },
              },
            },
          },
        },
      },
    },
  },
  PUT: {
    tags: ['Scheduler'],
    summary: 'Update a scheduled job',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['id'],
            properties: {
              id: { type: 'string', format: 'uuid' },
              name: { type: 'string' },
              description: { type: 'string', nullable: true },
              scheduleType: { type: 'string', enum: ['cron', 'interval'] },
              scheduleValue: { type: 'string' },
              timezone: { type: 'string' },
              targetPayload: { type: 'object', nullable: true },
              requireFeature: { type: 'string', nullable: true },
              isEnabled: { type: 'boolean' },
            },
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Schedule updated',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                ok: { type: 'boolean' },
              },
            },
          },
        },
      },
    },
  },
  DELETE: {
    tags: ['Scheduler'],
    summary: 'Delete a scheduled job',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['id'],
            properties: {
              id: { type: 'string', format: 'uuid' },
            },
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Schedule deleted',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                ok: { type: 'boolean' },
              },
            },
          },
        },
      },
    },
  },
}
