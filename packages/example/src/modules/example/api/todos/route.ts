import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { Todo } from '@open-mercato/example/modules/example/data/entities'
import { E } from '@open-mercato/example/datamodel/entities'
import { id, title, tenant_id, organization_id, is_done } from '@open-mercato/example/datamodel/entities/todo'
import type { Where, WhereValue } from '@open-mercato/shared/lib/query/types'
import type { TodoListItem } from '@open-mercato/example/modules/example/types'
import { CustomFieldDef } from '@open-mercato/core/modules/custom_fields/data/entities'

// Query (list) schema
const querySchema = z
  .object({
    id: z.string().uuid().optional(),
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    sortField: z.string().optional().default('id'),
    sortDir: z.enum(['asc', 'desc']).optional().default('asc'),
    title: z.string().optional(),
    isDone: z.coerce.boolean().optional(),
    withDeleted: z.coerce.boolean().optional().default(false),
    organizationId: z.string().uuid().optional(),
    createdFrom: z.string().optional(),
    createdTo: z.string().optional(),
    format: z.enum(['json', 'csv']).optional().default('json'),
  })
  .passthrough()

// Create/Update schemas
const createSchema = z
  .object({
    title: z.string().min(1),
    is_done: z.boolean().optional().default(false),
  })
  .passthrough()

const updateSchema = z
  .object({
    id: z.string().uuid(),
    title: z.string().min(1).optional(),
    is_done: z.boolean().optional(),
  })
  .passthrough()

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
    buildFilters: (q: Query, ctx): Where<TodoFields> => {
      const filters: Where<TodoFields> = {}
      const F = filters as Record<string, WhereValue>
      // Base fields
      if ((q as any).id) F.id = (q as any).id
      if ((q as any).title) F.title = { $ilike: `%${(q as any).title}%` }
      if ((q as any).isDone !== undefined) F.is_done = (q as any).isDone
      if ((q as any).organizationId) F.organization_id = (q as any).organizationId
      if ((q as any).createdFrom || (q as any).createdTo) {
        const range: { $gte?: Date; $lte?: Date } = {}
        if ((q as any).createdFrom) range.$gte = new Date((q as any).createdFrom)
        if ((q as any).createdTo) range.$lte = new Date((q as any).createdTo)
        F.created_at = range
      }

      // Dynamic custom field filters: accept cf_<key> (eq) and cf_<key>In (in)
      const allEntries = Object.entries(q as any)
      const cfParams = allEntries.filter(([k]) => k.startsWith('cf_'))

      if (cfParams.length) {
        const em = ctx.container.resolve<any>('em')
        // Resolve definitions to parse types
        // Note: inline query to avoid extra dependency imports
        const defs = await em.find(CustomFieldDef, {
          entityId: E.example.todo as any,
          organizationId: { $in: [ctx.auth.orgId, null] as any },
          tenantId: { $in: [ctx.auth.tenantId, null] as any },
          isActive: true,
        })
        const byKey: Record<string, { kind: string; multi?: boolean }> = {}
        for (const d of defs as any[]) {
          byKey[d.key] = { kind: d.kind, multi: Boolean(d.configJson?.multi) }
        }

        const coerce = (kind: string, v: any) => {
          if (v == null) return v
          switch (kind) {
            case 'integer': return Number.parseInt(String(v), 10)
            case 'float': return Number.parseFloat(String(v))
            case 'boolean': return String(v).toLowerCase() === 'true'
            default: return String(v)
          }
        }

        for (const [rawKey, rawVal] of cfParams) {
          const isIn = rawKey.endsWith('In')
          const key = isIn ? rawKey.replace(/^cf_/, '').replace(/In$/, '') : rawKey.replace(/^cf_/, '')
          const def = byKey[key]
          const fieldId = `cf:${key}`
          if (!def) continue
          if (isIn) {
            const list = Array.isArray(rawVal)
              ? (rawVal as any[])
              : String(rawVal)
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean)
            if (list.length) F[fieldId] = { $in: list.map((x) => coerce(def.kind, x)) as any }
          } else {
            F[fieldId] = coerce(def.kind, rawVal as any) as any
          }
        }
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
