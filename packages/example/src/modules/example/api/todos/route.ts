import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { Todo } from '@open-mercato/example/modules/example/data/entities'
import { E } from '@open-mercato/example/datamodel/entities'
import { id, title, tenant_id, organization_id, is_done } from '@open-mercato/example/datamodel/entities/todo'
import type { Where, WhereValue } from '@open-mercato/shared/lib/query/types'
import type { TodoListItem } from '@open-mercato/example/modules/example/types'

// Query (list) schema
const querySchema = z.object({
  id: z.string().uuid().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  sortField: z.string().optional().default('id'),
  sortDir: z.enum(['asc', 'desc']).optional().default('asc'),
  title: z.string().optional(),
  severity: z.string().optional(),
  severityIn: z.string().optional(),
  isDone: z.coerce.boolean().optional(),
  isBlocked: z.coerce.boolean().optional(),
  withDeleted: z.coerce.boolean().optional().default(false),
  organizationId: z.string().uuid().optional(),
  createdFrom: z.string().optional(),
  createdTo: z.string().optional(),
  labelsIn: z.string().optional(),
  format: z.enum(['json', 'csv']).optional().default('json'),
})

// Create/Update schemas
const createSchema = z.object({
  title: z.string().min(1),
  is_done: z.boolean().optional().default(false),
  cf_priority: z.number().int().min(1).max(5).optional(),
  cf_severity: z.enum(['low', 'medium', 'high']).optional(),
  cf_blocked: z.boolean().optional(),
  cf_labels: z.array(z.string()).optional(),
  cf_description: z.string().optional(),
  cf_assignee: z.string().optional(),
})

const updateSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).optional(),
  is_done: z.boolean().optional(),
  cf_priority: z.number().int().min(1).max(5).optional(),
  cf_severity: z.enum(['low', 'medium', 'high']).optional(),
  cf_blocked: z.boolean().optional(),
  cf_labels: z.array(z.string()).optional(),
  cf_description: z.string().optional(),
  cf_assignee: z.string().optional(),
})

type Query = z.infer<typeof querySchema>
type CreateInput = z.infer<typeof createSchema>
type UpdateInput = z.infer<typeof updateSchema>

const sortFieldMap: Record<string, unknown> = {
  id,
  title,
  tenant_id,
  organization_id,
  is_done,
  cf_priority: 'cf:priority',
  cf_severity: 'cf:severity',
  cf_blocked: 'cf:blocked',
  cf_labels: 'cf:labels',
}

type TodoFields = {
  id: string
  title: string
  is_done: boolean
  tenant_id: string | null
  organization_id: string | null
  created_at: Date
  'cf:priority': number
  'cf:severity': string
  'cf:blocked': boolean
  'cf:labels': string
}

function toArray(val: unknown): string[] {
  if (Array.isArray(val)) return val as string[]
  if (typeof val === 'string') {
    const s = val.trim()
    const inner = s.startsWith('{') && s.endsWith('}') ? s.slice(1, -1) : s
    if (!inner) return []
    return inner
      .split(/[\s,]+/)
      .map((x) => x.trim())
      .filter(Boolean)
  }
  return val != null ? [String(val)] : []
}

export const { metadata, GET, POST, PUT, DELETE } = makeCrudRoute({
  metadata: {
    GET: { requireAuth: true, requireRoles: ['admin'] },
    POST: { requireAuth: true, requireRoles: ['admin', 'superuser'] },
    PUT: { requireAuth: true, requireRoles: ['admin'] },
    DELETE: { requireAuth: true, requireRoles: ['admin', 'superuser'] },
  },
  orm: {
    entity: Todo,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  events: { module: 'example', entity: 'todo', persistent: true },
  list: {
    schema: querySchema,
    entityId: E.example.todo,
    fields: [id, title, tenant_id, organization_id, is_done, 'cf:priority', 'cf:severity', 'cf:blocked', 'cf:labels', 'cf:assignee', 'cf:description'],
    sortFieldMap,
    buildFilters: (q: Query): Where<TodoFields> => {
      const filters: Where<TodoFields> = {}
      const F = filters as Record<string, WhereValue>
      if (q.id) F.id = q.id
      if (q.title) F.title = { $ilike: `%${q.title}%` }
      if (q.isDone !== undefined) F.is_done = q.isDone
      if (q.organizationId) F.organization_id = q.organizationId
      if (q.severity) F['cf:severity'] = q.severity
      if (q.severityIn) {
        const list = String(q.severityIn)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
        if (list.length) F['cf:severity'] = { $in: list }
      }
      if (q.labelsIn) {
        const list = String(q.labelsIn)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
        if (list.length) F['cf:labels'] = { $in: list }
      }
      if (q.isBlocked !== undefined) F['cf:blocked'] = q.isBlocked
      if (q.createdFrom || q.createdTo) {
        const range: { $gte?: Date; $lte?: Date } = {}
        if (q.createdFrom) range.$gte = new Date(q.createdFrom)
        if (q.createdTo) range.$lte = new Date(q.createdTo)
        F.created_at = range
      }
      return filters
    },
    transformItem: (item: {
      id: string
      title: string
      tenant_id: string | null
      organization_id: string | null
      is_done: boolean
      ['cf:priority']?: unknown
      ['cf:severity']?: unknown
      ['cf:blocked']?: unknown
      ['cf:labels']?: unknown
      ['cf:assignee']?: unknown
      ['cf:description']?: unknown
      cf_priority?: unknown
      cf_severity?: unknown
      cf_blocked?: unknown
      cf_labels?: unknown
      cf_assignee?: unknown
      cf_description?: unknown
    }): TodoListItem => {
      const rawSeverity = item['cf:severity'] ?? item.cf_severity
      const severityVal: any = Array.isArray(rawSeverity) ? rawSeverity[0] : rawSeverity
      const cf_severity = typeof severityVal === 'string' ? severityVal.toLowerCase() : severityVal

      const rawAssignee: any = item['cf:assignee'] ?? item.cf_assignee
      const cf_assignee = Array.isArray(rawAssignee) ? rawAssignee[0] : rawAssignee

      const rawDesc: any = item['cf:description'] ?? item.cf_description
      const cf_description = Array.isArray(rawDesc) ? rawDesc[0] : rawDesc

      return {
        id: item.id,
        title: item.title,
        tenant_id: item.tenant_id,
        organization_id: item.organization_id,
        is_done: item.is_done,
        cf_priority: item['cf:priority'] as any ?? (item.cf_priority as any),
        cf_severity,
        cf_blocked: (item['cf:blocked'] as any) ?? (item.cf_blocked as any),
        cf_labels: toArray((item['cf:labels'] as any) ?? (item.cf_labels as any)),
        cf_assignee: typeof cf_assignee === 'string' ? cf_assignee : undefined,
        cf_description: typeof cf_description === 'string' ? cf_description : undefined,
      }
    },
    allowCsv: true,
    csv: {
      headers: ['id', 'title', 'is_done', 'organization_id', 'tenant_id', 'cf_priority', 'cf_severity', 'cf_blocked', 'cf_labels'],
      row: (t: TodoListItem) => [
        t.id,
        t.title,
        t.is_done ? 'true' : 'false',
        t.organization_id ?? '',
        t.tenant_id ?? '',
        t.cf_priority ?? '',
        t.cf_severity ?? '',
        t.cf_blocked ?? '',
        Array.isArray(t.cf_labels) ? t.cf_labels.join('|') : '',
      ],
      filename: 'todos.csv',
    },
  },
  create: {
    schema: createSchema,
    mapToEntity: (input: CreateInput) => ({ title: input.title, isDone: !!input.is_done }),
    customFields: { enabled: true, entityId: E.example.todo, pickPrefixed: true },
    response: (entity: Todo) => ({ id: String(entity.id) }),
  },
  update: {
    schema: updateSchema,
    applyToEntity: (entity: Todo, input: UpdateInput) => {
      if (input.title !== undefined) entity.title = input.title
      if (input.is_done !== undefined) entity.isDone = !!input.is_done
    },
    customFields: { enabled: true, entityId: E.example.todo, pickPrefixed: true },
  },
  del: { idFrom: 'query', softDelete: true },
})
