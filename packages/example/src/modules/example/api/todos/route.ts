import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { Todo } from '@open-mercato/example/modules/example/data/entities'
import { E } from '@open-mercato/example/datamodel/entities'
import { id, title, tenant_id, organization_id, is_done } from '@open-mercato/example/datamodel/entities/todo'
import type { Where, WhereValue } from '@open-mercato/shared/lib/query/types'
import type { TodoListItem } from '@open-mercato/example/modules/example/types'
import { CustomFieldDef } from '@open-mercato/core/modules/custom_fields/data/entities'
import type { EntityManager } from '@mikro-orm/core'
import fieldSets from '@open-mercato/example/modules/example/data/fields'

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

const cfKeys = new Set<string>((fieldSets.find((s) => s.entity === E.example.todo)?.fields || []).map((f) => f.key))
const cfFieldIds = Array.from(cfKeys).map((k) => `cf:${k}`)

const sortFieldMap: Record<string, unknown> = (() => {
  const map: Record<string, unknown> = { id, title, tenant_id, organization_id, is_done }
  for (const k of cfKeys) map[`cf_${k}`] = `cf:${k}`
  return map
})()

type BaseFields = {
  id: string
  title: string
  is_done: boolean
  tenant_id: string | null
  organization_id: string | null
  created_at: Date
} & Record<`cf:${string}` | `cf_${string}`, unknown>

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
    fields: [id, title, tenant_id, organization_id, is_done, ...cfFieldIds],
    sortFieldMap,
    buildFilters: async (q: Query, ctx): Promise<Where<BaseFields>> => {
      const filters: Where<BaseFields> = {}
      const F = filters as Record<string, WhereValue>
      // Base fields
      if (q.id) F.id = q.id
      if (q.title) F.title = { $ilike: `%${q.title}%` }
      if (q.isDone !== undefined) F.is_done = q.isDone as any
      if (q.organizationId) F.organization_id = q.organizationId
      if (q.createdFrom || q.createdTo) {
        const range: { $gte?: Date; $lte?: Date } = {}
        if (q.createdFrom) range.$gte = new Date(q.createdFrom)
        if (q.createdTo) range.$lte = new Date(q.createdTo)
        F.created_at = range
      }

      // Dynamic custom field filters: accept cf_<key> (eq) and cf_<key>In (in)
      const allEntries = Object.entries(q as Record<string, unknown>)
      const cfParams = allEntries.filter(([k]) => k.startsWith('cf_'))

      if (cfParams.length) {
        const em = ctx.container.resolve<EntityManager>('em')
        // Resolve definitions to parse types
        // Note: inline query to avoid extra dependency imports
        const defs = await em.find(CustomFieldDef, {
          entityId: E.example.todo as string,
          organizationId: { $in: [ctx.auth.orgId, null] as any },
          tenantId: { $in: [ctx.auth.tenantId, null] as any },
          isActive: true,
        })
        const byKey: Record<string, { kind: string; multi?: boolean }> = {}
        for (const d of defs) {
          byKey[d.key] = { kind: d.kind, multi: Boolean((d as any).configJson?.multi) }
        }

        const coerce = (kind: string, v: unknown) => {
          if (v == null) return v as undefined
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
              ? (rawVal as unknown[])
              : String(rawVal)
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean)
            if (list.length) F[fieldId] = { $in: list.map((x) => coerce(def.kind, x)) as (string[] | number[] | boolean[]) }
          } else {
            F[fieldId] = coerce(def.kind, rawVal)
          }
        }
      }

      return filters
    },
    transformItem: (item: BaseFields): TodoListItem => {
      const base = {
        id: String(item.id),
        title: String(item.title),
        tenant_id: (item.tenant_id as string | null) ?? null,
        organization_id: (item.organization_id as string | null) ?? null,
        is_done: Boolean(item.is_done),
      }
      const out: Partial<TodoListItem> = { ...base }
      // Known CFs for typed TodoListItem
      if (cfKeys.has('priority')) out.cf_priority = typeof item['cf:priority'] === 'number' ? (item['cf:priority'] as number) : (item as any).cf_priority
      if (cfKeys.has('severity')) {
        const raw = (item['cf:severity'] as unknown) ?? (item as any).cf_severity
        const val = Array.isArray(raw) ? raw[0] : raw
        out.cf_severity = typeof val === 'string' ? val.toLowerCase() : (val as string | null | undefined)
      }
      if (cfKeys.has('blocked')) out.cf_blocked = Boolean((item['cf:blocked'] as unknown) ?? (item as any).cf_blocked)
      if (cfKeys.has('labels')) {
        const raw = (item['cf:labels'] as unknown) ?? (item as any).cf_labels
        out.cf_labels = Array.isArray(raw) ? (raw as string[]) : toArray(raw)
      }
      if (cfKeys.has('assignee')) {
        const raw = (item['cf:assignee'] as unknown) ?? (item as any).cf_assignee
        const val = Array.isArray(raw) ? raw[0] : raw
        out.cf_assignee = typeof val === 'string' ? val : undefined
      }
      if (cfKeys.has('description')) {
        const raw = (item['cf:description'] as unknown) ?? (item as any).cf_description
        const val = Array.isArray(raw) ? raw[0] : raw
        out.cf_description = typeof val === 'string' ? val : undefined
      }
      return out as TodoListItem
    },
    allowCsv: true,
    csv: {
      headers: (() => {
        const headers = ['id', 'title', 'is_done', 'organization_id', 'tenant_id']
        for (const k of Array.from(cfKeys)) headers.push(`cf_${k}`)
        return headers
      })(),
      row: (t: TodoListItem) => {
        const base = [
          t.id,
          t.title,
          t.is_done ? 'true' : 'false',
          t.organization_id ?? '',
          t.tenant_id ?? '',
        ]
        const cfVals = Array.from(cfKeys).map((k) => {
          const key = `cf_${k}` as keyof TodoListItem
          const v = t[key] as unknown
          if (Array.isArray(v)) return (v as string[]).join('|')
          return v == null ? '' : String(v)
        })
        return [...base, ...cfVals]
      },
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
