import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { makeCrudRoute, type CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { Todo } from '../../data/entities'

const ENTITY_ID = 'example:todo' as const
const id = 'id'
const title = 'title'
const tenant_id = 'tenant_id'
const organization_id = 'organization_id'
const is_done = 'is_done'
const created_at = 'created_at'
const updated_at = 'updated_at'
import type { Where, WhereValue } from '@open-mercato/shared/lib/query/types'
import type { TodoListItem } from '../../types'
import ceEntities from '../../ce'
import {
  buildCustomFieldSelectorsForEntity,
  extractAllCustomFieldEntries,
  buildCustomFieldFiltersFromQuery,
} from '@open-mercato/shared/lib/crud/custom-fields'
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
    ids: z.string().optional(),
    sortField: z.string().optional().default('id'),
    sortDir: z.enum(['asc', 'desc']).optional().default('asc'),
    title: z.string().optional(),
    isDone: z.coerce.boolean().optional(),
    withDeleted: z.coerce.boolean().optional().default(false),
    organizationId: z.string().uuid().optional(),
    createdFrom: z.string().optional(),
    createdTo: z.string().optional(),
    format: z.enum(['json', 'csv']).optional(),
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

const cfSel = buildCustomFieldSelectorsForEntity(ENTITY_ID, baseFieldSets)

// `updated_at` is part of the projection because the optimistic-lock round-trip
// needs it: `CrudForm` auto-derives the expected-version header from
// `initialValues.updatedAt`, and the list-row delete builds the same header from
// the row. Dropping it silently disables optimistic locking on this entity.
const baseListFields = [id, title, tenant_id, organization_id, is_done, created_at, updated_at]
const baseCsvHeaders = ['id', 'title', 'is_done', 'organization_id', 'tenant_id']

// Custom-field keys are discovered per request from tenant- and organization-scoped
// definitions, so they MUST NOT live in module scope: a module-level array would be
// overwritten by whichever tenant issued the last request and read back by the next
// one. The WeakMap is keyed by the per-request `CrudCtx` the factory creates in
// `withCtx(request)`, so each request sees only its own projection and the entry is
// collected with the context.
const requestCustomFieldKeys = new WeakMap<CrudCtx, string[]>()

function customFieldKeysFor(ctx: CrudCtx): string[] {
  return requestCustomFieldKeys.get(ctx) ?? cfSel.keys
}

// Sorting on `cf_<key>` needs no entry here: the CRUD factory normalizes any
// unmapped `cf_` sort field to the `cf:` query-engine selector.
const sortFieldMap: Record<string, string> = {
  id,
  title,
  tenant_id,
  organization_id,
  is_done,
  created_at,
  updated_at,
  updatedAt: updated_at,
}

function toIsoTimestamp(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
  }
  return null
}

type CustomFieldValuesTable = {
  entity_id: string
  field_key: string
  organization_id: string | null
  tenant_id: string | null
  deleted_at: Date | null
}

type ExampleReadDatabase = {
  custom_field_values: CustomFieldValuesTable
}

function definitionPriority(def: CustomFieldDef): number {
  const config = def.configJson
  if (!config || typeof config !== 'object') return 0
  const priority = (config as Record<string, unknown>).priority
  return typeof priority === 'number' ? priority : 0
}

function resolveScopedOrganizationIds(ctx: CrudCtx): string[] | null {
  if (ctx.organizationIds === null) return null
  const declared = (ctx.organizationIds ?? []).filter((value): value is string => typeof value === 'string' && value.length > 0)
  if (declared.length > 0) return Array.from(new Set(declared))
  const selected = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  return selected ? [selected] : []
}

async function discoverCustomFieldKeys(ctx: CrudCtx): Promise<string[]> {
  const em = ctx.container.resolve<EntityManager>('em')
  const tenantId = ctx.auth?.tenantId ?? null
  const scopedOrgIds = resolveScopedOrganizationIds(ctx)

  const defs = await em.find(CustomFieldDef, {
    entityId: ENTITY_ID,
    $and: [
      ...(scopedOrgIds === null
        ? []
        : scopedOrgIds.length > 0
          ? [{ $or: [{ organizationId: { $in: scopedOrgIds } }, { organizationId: null }] }]
          : [{ organizationId: null }]),
      { $or: [{ tenantId }, { tenantId: null }] },
    ],
  })

  const byKey = new Map<string, CustomFieldDef>()
  const specificity = (def: CustomFieldDef) => (def.tenantId ? 2 : 0) + (def.organizationId ? 1 : 0)
  for (const def of defs) {
    const existing = byKey.get(def.key)
    if (!existing || specificity(def) > specificity(existing)) byKey.set(def.key, def)
  }

  // Hide any key that has a tombstoned record in scope
  const tombstonedKeys = new Set(defs.filter((def) => !!def.deletedAt).map((def) => def.key))
  const keysFromDefs = Array.from(byKey.values())
    .filter((def) => def.isActive !== false && !def.deletedAt && !tombstonedKeys.has(def.key))
    .sort((left, right) => definitionPriority(left) - definitionPriority(right))
    .map((def) => def.key)

  // Fallback discovery: keys that have values even if no definition exists
  let keysFromValues: string[] = []
  try {
    const db = em.getKysely<ExampleReadDatabase>()
    let cfvQuery = db
      .selectFrom('custom_field_values')
      .select('field_key')
      .distinct()
      .where('entity_id', '=', ENTITY_ID)
      .where('deleted_at', 'is', null)
    if (scopedOrgIds === null) {
      // no organization restriction
    } else if (scopedOrgIds.length > 0) {
      cfvQuery = cfvQuery.where((eb) => eb.or([
        eb('organization_id', 'in', scopedOrgIds),
        eb('organization_id', 'is', null),
      ]))
    } else {
      cfvQuery = cfvQuery.where('organization_id', 'is', null)
    }
    if (tenantId != null) {
      cfvQuery = cfvQuery.where((eb) => eb.or([
        eb('tenant_id', '=', tenantId),
        eb('tenant_id', 'is', null),
      ]))
    } else {
      cfvQuery = cfvQuery.where('tenant_id', 'is', null)
    }
    const rows = await cfvQuery.execute()
    keysFromValues = rows.map((row) => String(row.field_key))
  } catch {
    // no values fallback; code-declared and definition keys still apply
  }

  return Array.from(new Set([...cfSel.keys, ...keysFromDefs, ...keysFromValues]))
}

type BaseFields = {
  id: string
  title: string
  is_done: boolean
  tenant_id: string | null
  organization_id: string | null
  created_at: Date
  updated_at: Date | string | null
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
  indexer: { entityType: ENTITY_ID },
  list: {
    schema: querySchema,
    entityId: ENTITY_ID,
    fields: (_query: Query, ctx: CrudCtx) => [
      ...baseListFields,
      ...customFieldKeysFor(ctx).map((key) => `cf:${key}`),
    ],
    sortFieldMap,
    buildFilters: async (q: Query, ctx): Promise<Where<BaseFields>> => {
      const filters: Where<BaseFields> = {}
      const F = filters as Record<string, WhereValue>
      // Base fields
      if (q.ids) {
        const ids = q.ids
          .split(',')
          .map((value) => value.trim())
          .filter((value) => value.length > 0)
        if (ids.length > 0) F.id = { $in: ids }
      }
      if (q.id) F.id = q.id
      if (q.title) F.title = { $ilike: `%${escapeLikePattern(q.title)}%` }
      if (q.isDone !== undefined) F.is_done = q.isDone
      if (q.organizationId) F.organization_id = q.organizationId
      if (q.createdFrom || q.createdTo) {
        const range: { $gte?: Date; $lte?: Date } = {}
        if (q.createdFrom) range.$gte = new Date(q.createdFrom)
        if (q.createdTo) range.$lte = new Date(q.createdTo)
        F.created_at = range
      }
      // Dynamic custom field filters via shared helper
      const cfFilterMap = await buildCustomFieldFiltersFromQuery({
        entityId: ENTITY_ID,
        query: q as Record<string, unknown>,
        em: ctx.container.resolve<EntityManager>('em'),
        tenantId: ctx.auth!.tenantId,
      })
      Object.assign(F, cfFilterMap)

      return filters
    },
    // Custom-field values are read back off the row itself, so the projection stays
    // request-scoped without the transform needing to know which keys were selected.
    transformItem: (item: BaseFields): TodoListItem => ({
      id: String(item.id),
      title: String(item.title),
      tenant_id: item.tenant_id ?? null,
      organization_id: item.organization_id ?? null,
      is_done: Boolean(item.is_done),
      updatedAt: toIsoTimestamp(item.updated_at),
      ...extractAllCustomFieldEntries(item),
    }),
    allowCsv: true,
    csv: {
      headers: (_query: Query, ctx: CrudCtx) => [
        ...baseCsvHeaders,
        ...customFieldKeysFor(ctx).map((key) => `cf_${key}`),
      ],
      row: (item: TodoListItem, ctx: CrudCtx) => {
        const base = [
          item.id,
          item.title,
          item.is_done ? 'true' : 'false',
          item.organization_id ?? '',
          item.tenant_id ?? '',
        ]
        const customValues = customFieldKeysFor(ctx).map((key) => {
          const value = (item as Record<string, unknown>)[`cf_${key}`]
          if (Array.isArray(value)) return value.join('|')
          return value == null ? '' : String(value)
        })
        return [...base, ...customValues]
      },
      filename: 'todos.csv',
    },
  },
  hooks: {
    // Per-request: merge DB field definitions with the code-declared set and publish
    // the result on the request context for `fields` / `csv` to read back.
    beforeList: async (_q, ctx) => {
      try {
        requestCustomFieldKeys.set(ctx, await discoverCustomFieldKeys(ctx))
      } catch {
        // ignore; fall back to code-declared selectors
      }
    },
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
