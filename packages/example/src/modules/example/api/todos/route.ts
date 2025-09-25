import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { Todo } from '@open-mercato/example/modules/example/data/entities'
import { E } from '@open-mercato/example/datamodel/entities'
import { id, title, tenant_id, organization_id, is_done } from '@open-mercato/example/datamodel/entities/todo'
import type { Where } from '@open-mercato/shared/lib/query/types'

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

const sortFieldMap: Record<string, any> = {
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

function toArray(val: any): string[] {
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
    buildFilters: (q): Where<TodoFields> => {
      const filters: Where<TodoFields> = {}
      if ((q as any).id) (filters as any).id = (q as any).id
      if ((q as any).title) (filters as any).title = { $ilike: `%${(q as any).title}%` }
      if ((q as any).isDone !== undefined) (filters as any).is_done = (q as any).isDone
      if ((q as any).organizationId) (filters as any).organization_id = (q as any).organizationId
      if ((q as any).severity) (filters as any)['cf:severity'] = (q as any).severity
      if ((q as any).severityIn) {
        const list = String((q as any).severityIn)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
        if (list.length) (filters as any)['cf:severity'] = { $in: list as any }
      }
      if ((q as any).labelsIn) {
        const list = String((q as any).labelsIn)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
        if (list.length) (filters as any)['cf:labels'] = { $in: list as any }
      }
      if ((q as any).isBlocked !== undefined) (filters as any)['cf:blocked'] = (q as any).isBlocked
      if ((q as any).createdFrom || (q as any).createdTo) {
        const range: any = {}
        if ((q as any).createdFrom) range.$gte = new Date((q as any).createdFrom)
        if ((q as any).createdTo) range.$lte = new Date((q as any).createdTo)
        ;(filters as any).created_at = range
      }
      return filters
    },
    transformItem: (item: any) => {
      const rawSeverity: any = (item as any)['cf:severity'] ?? (item as any).cf_severity
      const severityVal: any = Array.isArray(rawSeverity) ? rawSeverity[0] : rawSeverity
      const cf_severity = typeof severityVal === 'string' ? severityVal.toLowerCase() : severityVal

      const rawAssignee: any = (item as any)['cf:assignee'] ?? (item as any).cf_assignee
      const cf_assignee = Array.isArray(rawAssignee) ? rawAssignee[0] : rawAssignee

      const rawDesc: any = (item as any)['cf:description'] ?? (item as any).cf_description
      const cf_description = Array.isArray(rawDesc) ? rawDesc[0] : rawDesc

      return {
        id: item.id,
        title: item.title,
        tenant_id: (item as any).tenant_id,
        organization_id: (item as any).organization_id,
        is_done: (item as any).is_done,
        cf_priority: (item as any)['cf:priority'] ?? (item as any).cf_priority,
        cf_severity,
        cf_blocked: (item as any)['cf:blocked'] ?? (item as any).cf_blocked,
        cf_labels: toArray((item as any)['cf:labels'] ?? (item as any).cf_labels),
        cf_assignee: typeof cf_assignee === 'string' ? cf_assignee : undefined,
        cf_description: typeof cf_description === 'string' ? cf_description : undefined,
      }
    },
    allowCsv: true,
    csv: {
      headers: ['id', 'title', 'is_done', 'organization_id', 'tenant_id', 'cf_priority', 'cf_severity', 'cf_blocked', 'cf_labels'],
      row: (t: any) => [
        t.id,
        t.title,
        t.is_done,
        t.organization_id,
        t.tenant_id,
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
    mapToEntity: (input) => ({ title: input.title, isDone: !!(input as any).is_done }),
    customFields: { enabled: true, entityId: E.example.todo, pickPrefixed: true },
    response: (entity) => ({ id: String((entity as any).id) }),
  },
  update: {
    schema: updateSchema,
    applyToEntity: (entity, input) => {
      if ((input as any).title !== undefined) (entity as any).title = (input as any).title
      if ((input as any).is_done !== undefined) (entity as any).isDone = !!(input as any).is_done
    },
    customFields: { enabled: true, entityId: E.example.todo, pickPrefixed: true },
  },
  del: { idFrom: 'query', softDelete: true },
})
