import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { buildCustomFieldFiltersFromQuery } from '@open-mercato/shared/lib/crud/custom-fields'
import { buildIlikeTerm } from '@open-mercato/shared/lib/db/buildIlikeTerm'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import { ReferenceTask, ReferenceTaskLink } from '../../data/entities'
import { REFERENCE_TASK_ENTITY_ID } from '../../data/entity-id'
import { referenceTaskCreateSchema, referenceTaskLinkTargetKinds, referenceTaskStatuses, referenceTaskUpdateSchema } from '../../data/validators'
import { buildReferenceCrudOpenApi, createPagedListResponseSchema } from '../openapi'
import { resolveReferenceRouteContext } from '../context'
import { readReferenceTaskCache, writeReferenceTaskCache } from '../../lib/task-cache'

const rawBodySchema = z.object({}).passthrough()
const querySchema = z.object({
  id: z.string().uuid().optional(),
  ids: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  search: z.string().trim().max(200).optional(),
  status: z.enum(referenceTaskStatuses).optional(),
  priority: z.coerce.number().int().min(0).max(5).optional(),
  isActive: z.enum(['true', 'false']).optional(),
  dueFrom: z.string().datetime({ offset: true }).optional(),
  dueTo: z.string().datetime({ offset: true }).optional(),
  linkTargetKind: z.enum(referenceTaskLinkTargetKinds).optional(),
  linkTargetId: z.string().uuid().optional(),
  sortField: z.enum(['title', 'status', 'priority', 'dueAt', 'createdAt', 'updatedAt']).optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
  format: z.literal('csv').optional(),
}).passthrough()

type Query = z.infer<typeof querySchema>

export type ReferenceTaskListItem = {
  id: string
  title: string
  description: string | null
  status: string
  priority: number
  dueAt: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
  customFields?: Record<string, unknown>
  links: Array<{ id: string; targetKind: string; targetId: string; targetLabel: string | null; updatedAt: string }>
  _reference_module?: { isOverdue: boolean; dueBucket: 'none' | 'overdue' | 'today' | 'future' }
}

function iso(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString()
  if (typeof value !== 'string') return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function transformTask(item: Record<string, unknown>): ReferenceTaskListItem {
  return {
    id: String(item.id),
    title: String(item.title),
    description: typeof item.description === 'string' ? item.description : null,
    status: String(item.status),
    priority: Number(item.priority),
    dueAt: iso(item.due_at ?? item.dueAt),
    isActive: Boolean(item.is_active ?? item.isActive),
    createdAt: iso(item.created_at ?? item.createdAt) ?? '',
    updatedAt: iso(item.updated_at ?? item.updatedAt) ?? '',
    customFields: (item.customFields ?? item.customValues) as Record<string, unknown> | undefined,
    links: [],
  }
}

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['reference_module.view'] },
  POST: { requireAuth: true, requireFeatures: ['reference_module.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['reference_module.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['reference_module.manage'] },
}

async function buildTaskFilters(query: Query, ctx: {
  auth: { tenantId?: string | null; orgId?: string | null } | null
  selectedOrganizationId: string | null
  container: { resolve: <T = unknown>(name: string) => T }
}) {
  const filters: Record<string, unknown> = {}
  if (query.id) filters.id = { $eq: query.id }
  if (query.search) filters.title = { $ilike: buildIlikeTerm(query.search) }
  if (query.status) filters.status = { $eq: query.status }
  if (query.priority !== undefined) filters.priority = { $eq: query.priority }
  if (query.isActive !== undefined) filters.is_active = query.isActive === 'true'
  if (query.dueFrom || query.dueTo) {
    filters.due_at = {
      ...(query.dueFrom ? { $gte: new Date(query.dueFrom) } : {}),
      ...(query.dueTo ? { $lte: new Date(query.dueTo) } : {}),
    }
  }
  if (query.linkTargetKind && query.linkTargetId) {
    const tenantId = ctx.auth?.tenantId ?? null
    const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
    if (!tenantId || !organizationId) return { id: { $eq: '00000000-0000-0000-0000-000000000000' } }
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const links = await findWithDecryption(
      em,
      ReferenceTaskLink,
      { tenantId, organizationId, targetKind: query.linkTargetKind, targetId: query.linkTargetId, deletedAt: null },
      { populate: ['task'], fields: ['task'] },
      { tenantId, organizationId },
    )
    filters.id = { $in: links.map((link) => link.task.id) }
  }
  Object.assign(filters, await buildCustomFieldFiltersFromQuery({
    entityId: REFERENCE_TASK_ENTITY_ID,
    query,
    em: ctx.container.resolve('em'),
    tenantId: ctx.auth?.tenantId ?? null,
  }))
  return filters
}

const route = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: ReferenceTask,
    idField: 'id',
    tenantField: 'tenantId',
    orgField: 'organizationId',
    softDeleteField: 'deletedAt',
  },
  events: { module: 'reference_module', entity: 'reference_task', persistent: true },
  indexer: { entityType: REFERENCE_TASK_ENTITY_ID },
  enrichers: { entityId: 'reference_module.reference_task' },
  list: Object.assign({
    schema: querySchema,
    entityId: REFERENCE_TASK_ENTITY_ID,
    fields: (query: Query) => query.format === 'csv'
      ? ['id', 'title', 'status', 'priority', 'due_at', 'is_active', 'created_at', 'updated_at']
      : ['id', 'title', 'description', 'status', 'priority', 'due_at', 'is_active', 'created_at', 'updated_at'],
    sortFieldMap: {
      title: 'title', status: 'status', priority: 'priority', dueAt: 'due_at', createdAt: 'created_at', updatedAt: 'updated_at',
    },
    buildFilters: buildTaskFilters,
    transformItem: transformTask,
    decorateCustomFields: { entityIds: REFERENCE_TASK_ENTITY_ID, stripPrefixedKeys: true },
    allowCsv: true,
    export: {
      formats: ['csv' as const],
      filename: 'reference-tasks.csv',
      batchSize: 10_000,
      columns: [
        { field: 'id', header: 'id' },
        { field: 'title', header: 'title' },
        { field: 'status', header: 'status' },
        { field: 'priority', header: 'priority' },
        { field: 'dueAt', header: 'dueAt' },
        { field: 'isActive', header: 'isActive' },
        { field: 'createdAt', header: 'createdAt' },
        { field: 'updatedAt', header: 'updatedAt' },
      ],
    },
  }, { disableListCache: true }),
  hooks: {
    afterList: async (result, ctx) => {
      const items = result.items as ReferenceTaskListItem[]
      if (items.length === 0) return
      const tenantId = ctx.auth?.tenantId ?? null
      const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
      if (!tenantId || !organizationId) {
        result.items = []
        result.total = 0
        return
      }
      const em = (ctx.container.resolve('em') as EntityManager).fork()
      const links = await findWithDecryption(
        em,
        ReferenceTaskLink,
        { tenantId, organizationId, task: { $in: items.map((item) => item.id) }, deletedAt: null },
        { populate: ['task'] },
        { tenantId, organizationId },
      )
      const byTask = new Map<string, ReferenceTaskListItem['links']>()
      for (const link of links) {
        const bucket = byTask.get(link.task.id) ?? []
        bucket.push({
          id: link.id,
          targetKind: link.targetKind,
          targetId: link.targetId,
          targetLabel: link.targetLabelSnapshot ?? null,
          updatedAt: link.updatedAt.toISOString(),
        })
        byTask.set(link.task.id, bucket)
      }
      for (const item of items) item.links = byTask.get(item.id) ?? []
    },
  },
  actions: {
    create: {
      commandId: 'reference_module.reference_task.create',
      schema: rawBodySchema,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => result,
      status: 201,
    },
    update: {
      commandId: 'reference_module.reference_task.update',
      schema: rawBodySchema,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => result,
    },
    delete: {
      commandId: 'reference_module.reference_task.delete',
      mapInput: ({ raw }) => {
        const body = raw.body as Record<string, unknown> | undefined
        const query = raw.query as Record<string, unknown> | undefined
        return { id: body?.id ?? query?.id }
      },
      response: ({ result }) => result,
    },
  },
})

export const { metadata, POST, PUT, DELETE } = route

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  if (url.searchParams.get('format') !== 'csv') return route.GET(request)
  const context = await resolveReferenceRouteContext(request)
  if (!context) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const query = querySchema.parse(Object.fromEntries(url.searchParams.entries()))
  const countCacheKey = `export-count:${url.searchParams.toString()}`
  let total = await readReferenceTaskCache<number>(context.container, context.scope, countCacheKey)
  if (total === null) {
    const queryEngine = context.container.resolve('queryEngine') as QueryEngine
    const result = await queryEngine.query(REFERENCE_TASK_ENTITY_ID, {
      tenantId: context.scope.tenantId,
      organizationId: context.scope.organizationId,
      fields: ['id'],
      filters: await buildTaskFilters(query, { ...context.ctx, container: context.container }),
      page: { page: 1, pageSize: 1 },
    })
    total = result.total
    await writeReferenceTaskCache(context.container, context.scope, countCacheKey, total)
  }
  if (total > 10_000) return Response.json({ error: 'Export exceeds the 10000 row limit' }, { status: 413 })
  return route.GET(request)
}

const listItemSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  description: z.string().nullable(),
  status: z.enum(referenceTaskStatuses),
  priority: z.number().int(),
  dueAt: z.string().datetime().nullable(),
  isActive: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  customFields: z.record(z.string(), z.unknown()).optional(),
  links: z.array(z.object({
    id: z.string().uuid(), targetKind: z.enum(referenceTaskLinkTargetKinds), targetId: z.string().uuid(), targetLabel: z.string().nullable(), updatedAt: z.string().datetime(),
  })),
}).passthrough()

export const openApi = buildReferenceCrudOpenApi({
  resourceName: 'Reference task',
  querySchema,
  listResponseSchema: createPagedListResponseSchema(listItemSchema, { paginationMetaOptional: true }),
  create: { schema: referenceTaskCreateSchema, responseSchema: listItemSchema },
  update: { schema: referenceTaskUpdateSchema, responseSchema: listItemSchema },
  del: { schema: z.object({ id: z.string().uuid() }), responseSchema: listItemSchema },
})
