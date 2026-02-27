/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { Todo } from '../../data/entities'
import { E } from '@/.mercato/generated/entities.ids.generated'
import { id, title, tenant_id, organization_id, is_done, created_at } from '@/.mercato/generated/entities/todo'
import type { Where, WhereValue } from '@open-mercato/shared/lib/query/types'
import type { TodoListItem } from '../../types'
import ceEntities from '../../ce'
import { buildCustomFieldSelectorsForEntity, extractCustomFieldsFromItem, buildCustomFieldFiltersFromQuery } from '@open-mercato/shared/lib/crud/custom-fields'
import { CustomFieldDef } from '@open-mercato/core/modules/entities/data/entities'
import type { CustomFieldSet } from '@open-mercato/shared/modules/entities'
import { todoCrudEvents, todoCrudIndexer } from '../../commands/todos'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  createExampleCrudOpenApi,
  createExamplePagedListResponseSchema,
  exampleCreatedSchema,
  exampleOkSchema,
  todoListItemSchema as todoListItemDocSchema,
} from '../openapi'

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
const rawBodySchema = z.object({}).passthrough()

type Query = z.infer<typeof querySchema>

// Start from code-declared field sets (declared in ce.ts); extend per-request from DB definitions
const baseFieldSets: CustomFieldSet[] = []
const todoEntity = Array.isArray(ceEntities) ? ceEntities.find((entity) => entity?.id === 'example:todo') : undefined
if (todoEntity?.fields?.length) {
  baseFieldSets.push({ entity: todoEntity.id, fields: todoEntity.fields, source: 'example' })
}

const cfSel = buildCustomFieldSelectorsForEntity(E.example.todo, baseFieldSets)
let dynamicCfKeys: string[] = [...cfSel.keys]
let listFields: any[] = [id, title, tenant_id, organization_id, is_done, created_at, ...cfSel.selectors]
const sortFieldMapRef: Record<string, unknown> = { id, title, tenant_id, organization_id, is_done, created_at }
for (const k of dynamicCfKeys) sortFieldMapRef[`cf_${k}`] = `cf:${k}`

type BaseFields = {
  id: string
  title: string
  is_done: boolean
  tenant_id: string | null
  organization_id: string | null
  created_at: Date
} & Record<`cf:${string}` | `cf_${string}`, unknown>

export const { metadata, GET, POST, PUT, DELETE } = makeCrudRoute({
  metadata: {
    GET: { requireAuth: true, requireFeatures: ['example.todos.view'] },
    POST: { requireAuth: true, requireFeatures: ['example.todos.manage'] },
    PUT: { requireAuth: true, requireFeatures: ['example.todos.manage'] },
    DELETE: { requireAuth: true, requireFeatures: ['example.todos.manage'] },
  },
  orm: {
    entity: Todo,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  events: { module: 'example', entity: 'todo', persistent: true },
  indexer: { entityType: E.example.todo },
  list: {
    schema: querySchema,
    entityId: E.example.todo,
    fields: listFields,
    sortFieldMap: sortFieldMapRef,
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
      // Dynamic custom field filters via shared helper
      const cfFilterMap = await buildCustomFieldFiltersFromQuery({
        entityId: E.example.todo,
        query: q as any,
        em: ctx.container.resolve('em'),
        tenantId: ctx.auth!.tenantId,
      })
      Object.assign(F, cfFilterMap)

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
      const cf = extractCustomFieldsFromItem(item as any, dynamicCfKeys)
      return { ...base, ...(cf as any) } as TodoListItem
    },
    allowCsv: true,
    csv: {
      headers: ['id', 'title', 'is_done', 'organization_id', 'tenant_id', ...dynamicCfKeys.map((k) => `cf_${k}`)],
      row: (t: TodoListItem) => {
        const base = [
          t.id,
          t.title,
          t.is_done ? 'true' : 'false',
          t.organization_id ?? '',
          t.tenant_id ?? '',
        ]
        const cfVals = dynamicCfKeys.map((k) => {
          const ok = `cf_${k}`
          const v = (t as Record<string, unknown>)[ok]
          if (Array.isArray(v)) return (v as string[]).join('|')
          return v == null ? '' : String(v)
        })
        return [...base, ...cfVals]
      },
      filename: 'todos.csv',
    },
  },
  hooks: {
    // Per-request: merge DB field definitions with code-declared set and update selectors + sort map
    beforeList: async (_q, ctx) => {
      try {
        const em = (ctx.container.resolve('em') as any)
        const baseOrgIds = ctx.organizationIds === null
          ? null
          : (ctx.organizationIds ?? []).filter((id): id is string => typeof id === 'string' && id.length > 0)
        const scopedOrgIds = baseOrgIds === null
          ? null
          : (baseOrgIds.length > 0
            ? Array.from(new Set(baseOrgIds))
            : ((ctx.selectedOrganizationId ?? ctx.auth!.orgId) ? [ctx.selectedOrganizationId ?? ctx.auth!.orgId] : []))
        const defs = await em.find(CustomFieldDef, {
          entityId: E.example.todo as any,
          $and: [
            ...(scopedOrgIds === null
              ? []
              : scopedOrgIds.length > 0
                ? [ { $or: [ { organizationId: { $in: scopedOrgIds as any } }, { organizationId: null } ] } ]
                : [ { organizationId: null } ]),
            { $or: [ { tenantId: ctx.auth!.tenantId as any }, { tenantId: null } ] },
          ],
        })
        const byKey = new Map<string, any>()
        const score = (x: any) => (x.tenantId ? 2 : 0) + (x.organizationId ? 1 : 0)
        for (const d of defs) {
          const ex = byKey.get(d.key)
          if (!ex) { byKey.set(d.key, d); continue }
          const sNew = score(d); const sOld = score(ex)
          if (sNew > sOld) byKey.set(d.key, d)
        }
        // Hide any key that has a tombstoned record in scope
        const tombstonedKeys = new Set<string>((defs as any[]).filter((d: any) => !!d.deletedAt).map((d: any) => d.key))
        // Take winners only when active and not tombstoned; sort by priority
        const keysFromDefs = Array.from(byKey.values())
          .filter((d: any) => d.isActive !== false && !d.deletedAt && !tombstonedKeys.has(d.key))
          .sort((a: any, b: any) => ((a.configJson?.priority ?? 0) - (b.configJson?.priority ?? 0)))
          .map((d: any) => d.key)
        // Fallback discovery: keys that have values even if no definition exists
        try {
          const knex = (em as any).getConnection().getKnex()
          const rows = await knex('custom_field_values')
            .distinct('field_key')
            .where({ entity_id: E.example.todo as any })
            .modify((qb: any) => {
              if (scopedOrgIds === null) {
                // no organization restriction
              } else if (scopedOrgIds.length > 0) {
                qb.andWhere((b: any) => {
                  b.whereIn('organization_id', scopedOrgIds as any)
                  b.orWhereNull('organization_id')
                })
              } else {
                qb.whereNull('organization_id')
              }
              if (ctx.auth!.tenantId != null) qb.andWhere((b: any) => b.where({ tenant_id: ctx.auth!.tenantId }).orWhereNull('tenant_id'))
              else qb.whereNull('tenant_id')
            })
            .whereNull('deleted_at')
          const keysFromValues = (rows || []).map((r: any) => String(r.field_key))
          // Merge with code-declared keys and de-dupe
          dynamicCfKeys = Array.from(new Set([ ...cfSel.keys, ...keysFromDefs, ...keysFromValues ]))
        } catch {
          // Merge with code-declared keys and de-dupe (no values fallback)
          dynamicCfKeys = Array.from(new Set([ ...cfSel.keys, ...keysFromDefs ]))
        }
        const selectors = dynamicCfKeys.map((k) => `cf:${k}`)
        listFields = [id, title, tenant_id, organization_id, is_done, ...selectors]
        // Reset the shared sort field map object in place to propagate changes
        for (const key of Object.keys(sortFieldMapRef)) delete sortFieldMapRef[key]
        sortFieldMapRef.id = id
        sortFieldMapRef.title = title
        ;(sortFieldMapRef as any).tenant_id = tenant_id
        ;(sortFieldMapRef as any).organization_id = organization_id
        ;(sortFieldMapRef as any).is_done = is_done
        for (const k of dynamicCfKeys) sortFieldMapRef[`cf_${k}`] = `cf:${k}`
      } catch {
        // ignore; fall back to code-declared selectors
      }
    }
  },
  actions: {
    create: {
      commandId: 'example.todos.create',
      schema: rawBodySchema,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => ({ id: String(result.id) }),
      status: 201,
    },
    update: {
      commandId: 'example.todos.update',
      schema: rawBodySchema,
      mapInput: ({ parsed }) => parsed,
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'example.todos.delete',
      response: () => ({ ok: true }),
    },
  },
})

const todoDeleteSchema = z.object({
  id: z.string().uuid(),
})

export const openApi: OpenApiRouteDoc = createExampleCrudOpenApi({
  resourceName: 'Todo',
  pluralName: 'Todos',
  querySchema,
  listResponseSchema: createExamplePagedListResponseSchema(todoListItemDocSchema),
  create: {
    schema: rawBodySchema,
    description: 'Creates a todo record. Supports additional custom field keys prefixed with `cf_`.',
    responseSchema: exampleCreatedSchema,
  },
  update: {
    schema: rawBodySchema,
    description: 'Updates an existing todo record by id. Accepts base fields and optional `cf_` custom fields.',
    responseSchema: exampleOkSchema,
  },
  del: {
    schema: todoDeleteSchema,
    description: 'Deletes a todo by id. Provide the identifier in the request body.',
    responseSchema: exampleOkSchema,
  },
})
