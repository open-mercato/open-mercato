import { z } from 'zod'
import type { AwilixContainer } from 'awilix'
import { createRequestContainer } from '@/lib/di/container'
import { buildScopedWhere } from '@open-mercato/shared/lib/api/crud'
import { getAuthFromCookies, type AuthContext } from '@/lib/auth/server'
import type { QueryEngine, Where, Sort, Page } from '@open-mercato/shared/lib/query/types'
import { SortDir } from '@open-mercato/shared/lib/query/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { resolveOrganizationScopeForRequest, type OrganizationScope } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type {
  CrudEventAction,
  CrudEventsConfig,
  CrudIndexerConfig,
  CrudIdentifierResolver,
} from './types'
import { extractCustomFieldValuesFromPayload } from './custom-fields'
import { CrudHttpError } from './errors'
import type { CommandBus, CommandLogMetadata } from '@open-mercato/shared/lib/commands'

export type CrudHooks<TCreate, TUpdate, TList> = {
  beforeList?: (q: TList, ctx: CrudCtx) => Promise<void> | void
  afterList?: (res: any, ctx: CrudCtx & { query: TList }) => Promise<void> | void
  beforeCreate?: (input: TCreate, ctx: CrudCtx) => Promise<TCreate | void> | TCreate | void
  afterCreate?: (entity: any, ctx: CrudCtx & { input: TCreate }) => Promise<void> | void
  beforeUpdate?: (input: TUpdate, ctx: CrudCtx) => Promise<TUpdate | void> | TUpdate | void
  afterUpdate?: (entity: any, ctx: CrudCtx & { input: TUpdate }) => Promise<void> | void
  beforeDelete?: (id: string, ctx: CrudCtx) => Promise<void> | void
  afterDelete?: (id: string, ctx: CrudCtx) => Promise<void> | void
}

export type CrudMetadata = {
  GET?: { requireAuth?: boolean; requireRoles?: string[]; requireFeatures?: string[] }
  POST?: { requireAuth?: boolean; requireRoles?: string[]; requireFeatures?: string[] }
  PUT?: { requireAuth?: boolean; requireRoles?: string[]; requireFeatures?: string[] }
  DELETE?: { requireAuth?: boolean; requireRoles?: string[]; requireFeatures?: string[] }
}

export type OrmEntityConfig = {
  entity: any // MikroORM entity class
  idField?: string // default: 'id'
  orgField?: string | null // default: 'organizationId'; pass null to disable automatic org scoping
  tenantField?: string | null // default: 'tenantId'; pass null to disable automatic tenant scoping
  softDeleteField?: string | null // default: 'deletedAt'; pass null to disable implicit soft delete filter
}

export type CustomFieldsConfig =
  | false
  | {
      enabled: true
      entityId: any // datamodel entity id, e.g. E.example.todo
      // If true, picks body keys starting with `cf_` and maps `cf_<name>` -> `<name>`
      pickPrefixed?: boolean
      // Optional custom mapper; if provided, used instead of pickPrefixed
      map?: (data: Record<string, any>) => Record<string, any>
    }

export type ListConfig<TList> = {
  schema: z.ZodType<TList>
  // Optional: use the QueryEngine when entityId + fields are provided
  entityId?: any
  fields?: any[]
  sortFieldMap?: Record<string, any>
  buildFilters?: (query: TList, ctx: CrudCtx) => Where<any> | Promise<Where<any>>
  transformItem?: (item: any) => any
  allowCsv?: boolean
  csv?: {
    headers: string[]
    row: (item: any) => (string | number | boolean | null | undefined)[]
    filename?: string
  }
}

export type CreateConfig<TCreate> = {
  schema: z.ZodType<TCreate>
  mapToEntity: (input: TCreate, ctx: CrudCtx) => Record<string, any>
  customFields?: CustomFieldsConfig
  response?: (entity: any) => any
}

export type UpdateConfig<TUpdate> = {
  schema: z.ZodType<TUpdate>
  // Must contain a string uuid `id` field
  getId?: (input: TUpdate) => string
  applyToEntity: (entity: any, input: TUpdate, ctx: CrudCtx) => void | Promise<void>
  customFields?: CustomFieldsConfig
  response?: (entity: any) => any
}

export type DeleteConfig = {
  // Where to take id from; default: query param `id`
  idFrom?: 'query' | 'body'
  softDelete?: boolean // default true
  response?: (id: string) => any
}

export type CrudCommandActionConfig = {
  commandId: string
  schema?: z.ZodTypeAny
  mapInput?: (args: { parsed: any; raw: any; ctx: CrudCtx }) => Promise<any> | any
  metadata?: (args: { input: any; parsed: any; raw: any; ctx: CrudCtx }) => Promise<CommandLogMetadata | null> | CommandLogMetadata | null
  response?: (args: { result: any; logEntry: any | null; ctx: CrudCtx }) => any
  status?: number
}

export type CrudCtx = {
  container: AwilixContainer
  auth: AuthContext | null
  organizationScope: OrganizationScope | null
  selectedOrganizationId: string | null
  organizationIds: string[] | null
  request?: Request
}

export type CrudFactoryOptions<TCreate, TUpdate, TList> = {
  metadata?: CrudMetadata
  orm: OrmEntityConfig
  list?: ListConfig<TList>
  create?: CreateConfig<TCreate>
  update?: UpdateConfig<TUpdate>
  del?: DeleteConfig
  events?: CrudEventsConfig
  indexer?: CrudIndexerConfig
  resolveIdentifiers?: CrudIdentifierResolver
  hooks?: CrudHooks<TCreate, TUpdate, TList>
  actions?: {
    create?: CrudCommandActionConfig
    update?: CrudCommandActionConfig
    delete?: CrudCommandActionConfig
  }
}

function json(data: any, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...(init || {}),
    headers: { 'content-type': 'application/json', ...(init?.headers || {}) },
  })
}

function handleError(err: unknown): Response {
  if (err instanceof Response) return err
  if (err instanceof CrudHttpError) return json(err.body, { status: err.status })
  if (err instanceof z.ZodError) return json({ error: 'Invalid input', details: err.issues }, { status: 400 })

  const message = err instanceof Error ? err.message : undefined
  const stack = err instanceof Error ? err.stack : undefined
  // eslint-disable-next-line no-console
  console.error('[crud] unexpected error', { message, stack, err })
  const body: Record<string, unknown> = { error: 'Internal server error' }
  if (message) body.message = message
  return json(body, { status: 500 })
}

function isUuid(v: any): v is string {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
}

function normalizeIdentifierValue(value: any): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'bigint') return String(value)
  if (typeof value === 'object') {
    if (value instanceof Date) return value.toISOString()
    if (value && typeof (value as any).id !== 'undefined') return normalizeIdentifierValue((value as any).id)
  }
  return String(value)
}

type AccessLogServiceLike = { log: (input: any) => Promise<unknown> | unknown }

function resolveAccessLogService(container: AwilixContainer): AccessLogServiceLike | null {
  try {
    const service = container.resolve?.('accessLogService') as AccessLogServiceLike | undefined
    if (service && typeof service.log === 'function') return service
  } catch (err) {
    try {
      console.warn('[crud] accessLogService not available in container', err)
    } catch {}
  }
  return null
}

function collectFieldNames(items: any[]): string[] {
  const set = new Set<string>()
  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    for (const key of Object.keys(item)) {
      if (typeof key === 'string' && key.length > 0) set.add(key)
    }
  }
  return Array.from(set)
}

function determineAccessType(query: unknown, total: number, idField: string): string {
  if (query && typeof query === 'object' && query !== null && idField in (query as Record<string, unknown>)) {
    const value = (query as Record<string, unknown>)[idField]
    if (value !== undefined && value !== null && String(value).length > 0) return 'read:item'
  }
  return total > 1 ? 'read:list' : 'read'
}

export type LogCrudAccessOptions = {
  container: AwilixContainer
  auth: AuthContext | null
  request?: Request
  items: any[]
  idField?: string
  resourceKind: string
  organizationId?: string | null
  tenantId?: string | null
  query?: unknown
  accessType?: string
  fields?: string[]
}

export async function logCrudAccess(options: LogCrudAccessOptions) {
  const { container, auth, request, items, resourceKind } = options
  if (!auth) return
  if (!Array.isArray(items) || items.length === 0) return
  const service = resolveAccessLogService(container)
  if (!service) return

  const idField = options.idField || 'id'
  const tenantId = options.tenantId ?? auth.tenantId ?? null
  const organizationId = options.organizationId ?? auth.orgId ?? null
  const actorUserId = auth.sub ?? null
  const fields = options.fields && options.fields.length ? options.fields : collectFieldNames(items)
  const accessType = options.accessType ?? determineAccessType(options.query, items.length, idField)

  const context: Record<string, unknown> = {
    resultCount: items.length,
    accessType,
  }
  if (options.query && typeof options.query === 'object' && options.query !== null) {
    context.queryKeys = Object.keys(options.query as Record<string, unknown>)
  }
  try {
    if (request) {
      const url = new URL(request.url)
      context.path = url.pathname
    }
  } catch {
    // ignore url parsing issues
  }

  const uniqueIds = new Set<string>()
  const tasks: Promise<unknown>[] = []
  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    const rawId = (item as any)[idField]
    const resourceId = normalizeIdentifierValue(rawId)
    if (!resourceId || uniqueIds.has(resourceId)) continue
    uniqueIds.add(resourceId)
    const payload: Record<string, unknown> = {
      tenantId,
      organizationId,
      actorUserId,
      resourceKind,
      resourceId,
      accessType,
    }
    if (fields.length > 0) payload.fields = fields
    if (Object.keys(context).length > 0) payload.context = context
      tasks.push(
        Promise.resolve(service.log(payload)).catch((err) => {
          try {
            console.error('[crud] failed to record access log', { err, payload })
          } catch {}
          return undefined
        })
      )
  }
  if (tasks.length > 0) await Promise.all(tasks)
}

export function makeCrudRoute<TCreate = any, TUpdate = any, TList = any>(opts: CrudFactoryOptions<TCreate, TUpdate, TList>) {
  const metadata = opts.metadata || {}
  const ormCfg = {
    entity: opts.orm.entity,
    idField: opts.orm.idField ?? 'id',
    orgField: opts.orm.orgField === null ? null : opts.orm.orgField ?? 'organizationId',
    tenantField: opts.orm.tenantField === null ? null : opts.orm.tenantField ?? 'tenantId',
    softDeleteField: opts.orm.softDeleteField === null ? null : opts.orm.softDeleteField ?? 'deletedAt',
  }
  const defaultIdentifierResolver: CrudIdentifierResolver = (entity, _action) => {
    const id = normalizeIdentifierValue((entity as any)[ormCfg.idField!])
    const orgId = ormCfg.orgField ? normalizeIdentifierValue((entity as any)[ormCfg.orgField]) : null
    const tenantId = ormCfg.tenantField ? normalizeIdentifierValue((entity as any)[ormCfg.tenantField]) : null
    return {
      id: id ?? '',
      organizationId: orgId ?? null,
      tenantId: tenantId ?? null,
    }
  }
  const identifierResolver: CrudIdentifierResolver = opts.resolveIdentifiers
    ? (entity, action) => {
        const raw = opts.resolveIdentifiers!(entity, action)
        const id = normalizeIdentifierValue(raw?.id)
        const organizationId = normalizeIdentifierValue(raw?.organizationId)
        const tenantId = normalizeIdentifierValue(raw?.tenantId)
        return {
          id: id ?? '',
          organizationId: organizationId ?? null,
          tenantId: tenantId ?? null,
        }
      }
    : defaultIdentifierResolver

  const resourceKind = opts.events
    ? [opts.events.module, opts.events.entity].filter(Boolean).join('.')
    : (typeof ormCfg.entity?.name === 'string' && ormCfg.entity.name.length > 0 ? ormCfg.entity.name : 'resource')

  async function ensureAuth() {
    const auth = await getAuthFromCookies()
    if (!auth) return null
    if (auth.tenantId && !isUuid(auth.tenantId)) return null
    return auth
  }

  async function withCtx(request: Request): Promise<CrudCtx> {
    const container = await createRequestContainer()
    const auth = await ensureAuth()
    let scope: OrganizationScope | null = null
    let selectedOrganizationId: string | null = null
    let organizationIds: string[] | null = null
    if (auth) {
      try {
        scope = await resolveOrganizationScopeForRequest({ container, auth, request })
      } catch {
        scope = null
      }
    }
    selectedOrganizationId = scope?.selectedId ?? auth?.orgId ?? null
    organizationIds = scope ? scope.filterIds : (selectedOrganizationId ? [selectedOrganizationId] : null)
    return { container, auth, organizationScope: scope, selectedOrganizationId, organizationIds, request }
  }

  async function GET(request: Request) {
    try {
      const ctx = await withCtx(request)
      if (!ctx.auth) return json({ error: 'Unauthorized' }, { status: 401 })
      if (!opts.list) return json({ error: 'Not implemented' }, { status: 501 })
      const url = new URL(request.url)
      const queryParams = Object.fromEntries(url.searchParams.entries())
      const validated = opts.list.schema.parse(queryParams)

      await opts.hooks?.beforeList?.(validated as any, ctx)

      // Prefer query engine when configured
      let result: any
      if (opts.list.entityId && opts.list.fields) {
        const qe = ctx.container.resolve<QueryEngine>('queryEngine')
        const sortFieldRaw = (queryParams as any).sortField || 'id'
        const sortDirRaw = ((queryParams as any).sortDir || 'asc').toLowerCase() === 'desc' ? SortDir.Desc : SortDir.Asc
        const sortField = (opts.list.sortFieldMap && opts.list.sortFieldMap[sortFieldRaw]) || sortFieldRaw
        const sort: Sort[] = [{ field: sortField as any, dir: sortDirRaw } as any]
        const page: Page = {
          page: Number((queryParams as any).page ?? 1) || 1,
          pageSize: Math.min(Math.max(Number((queryParams as any).pageSize ?? 50) || 50, 1), 100),
        }
        const filters = opts.list.buildFilters ? await opts.list.buildFilters(validated as any, ctx) : ({} as Where<any>)
        const withDeleted = String((queryParams as any).withDeleted || 'false') === 'true'
        if (ormCfg.orgField && ctx.organizationIds && ctx.organizationIds.length === 0) {
          const emptyPayload = { items: [], total: 0, page: page.page, pageSize: page.pageSize, totalPages: 0 }
          await opts.hooks?.afterList?.(emptyPayload, { ...ctx, query: validated as any })
          return json(emptyPayload)
        }
        const queryOpts: any = {
          fields: opts.list.fields!,
          includeCustomFields: true,
          sort,
          page,
          filters,
          withDeleted,
        }
        if (ormCfg.tenantField) queryOpts.tenantId = ctx.auth.tenantId!
        if (ormCfg.orgField) {
          queryOpts.organizationId = ctx.selectedOrganizationId ?? undefined
          queryOpts.organizationIds = ctx.organizationIds ?? undefined
        }
        const res = await qe.query(opts.list.entityId as any, queryOpts)
        const items = (res.items || []).map(i => (opts.list!.transformItem ? opts.list!.transformItem(i) : i))

        await logCrudAccess({
          container: ctx.container,
          auth: ctx.auth,
          request,
          items,
          idField: ormCfg.idField!,
          resourceKind,
          organizationId: ctx.selectedOrganizationId ?? ctx.auth.orgId ?? null,
          tenantId: ctx.auth.tenantId ?? null,
          query: validated,
        })

        // CSV
        const format = (queryParams as any).format
        if (opts.list.allowCsv && format === 'csv' && opts.list.csv) {
          const head = opts.list.csv.headers
          const rows = items.map((x: any) => opts.list!.csv!.row(x).map(String))
          const csv = [head.join(','), ...rows.map(r => r.map(s => (/[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s)).join(','))].join('\n')
          return new Response(csv, {
            headers: {
              'content-type': 'text/csv; charset=utf-8',
              'content-disposition': `attachment; filename="${opts.list.csv.filename || opts.events?.entity || 'list'}.csv"`,
            },
          })
        }

        const payload = { items, total: res.total, page: page.page, pageSize: page.pageSize, totalPages: Math.ceil(res.total / (page.pageSize || 1)) }
        await opts.hooks?.afterList?.(payload, { ...ctx, query: validated as any })
        return json(payload)
      }

      // Fallback: plain ORM list
      const em = ctx.container.resolve<any>('em')
      const repo = em.getRepository(ormCfg.entity)
      if (ormCfg.orgField && ctx.organizationIds && ctx.organizationIds.length === 0) {
        await opts.hooks?.afterList?.({ items: [], total: 0 }, { ...ctx, query: validated as any })
        return json({ items: [], total: 0 })
      }
      const where: any = buildScopedWhere(
        {},
        {
          organizationId: ormCfg.orgField ? (ctx.selectedOrganizationId ?? ctx.auth.orgId ?? null) : undefined,
          organizationIds: ormCfg.orgField ? ctx.organizationIds ?? undefined : undefined,
          tenantId: ormCfg.tenantField ? ctx.auth.tenantId : undefined,
          orgField: ormCfg.orgField,
          tenantField: ormCfg.tenantField,
          softDeleteField: ormCfg.softDeleteField,
        }
      )
      const list = await repo.find(where)
      await logCrudAccess({
        container: ctx.container,
        auth: ctx.auth,
        request,
        items: list,
        idField: ormCfg.idField!,
        resourceKind,
        organizationId: ctx.selectedOrganizationId ?? ctx.auth.orgId ?? null,
        tenantId: ctx.auth.tenantId ?? null,
        query: validated,
      })
      await opts.hooks?.afterList?.({ items: list, total: list.length }, { ...ctx, query: validated as any })
      return json({ items: list, total: list.length })
    } catch (e) {
      return handleError(e)
    }
  }

  async function POST(request: Request) {
    try {
      const useCommand = !!opts.actions?.create
      if (!opts.create && !useCommand) return json({ error: 'Not implemented' }, { status: 501 })
      const ctx = await withCtx(request)
      if (!ctx.auth) return json({ error: 'Unauthorized' }, { status: 401 })
      if (ormCfg.orgField && ctx.organizationIds && ctx.organizationIds.length === 0) return json({ error: 'Forbidden' }, { status: 403 })
      const body = await request.json().catch(() => ({}))

      if (useCommand) {
        const commandBus = ctx.container.resolve<CommandBus>('commandBus')
        const action = opts.actions!.create!
        const parsed = action.schema ? action.schema.parse(body) : body
        const input = action.mapInput ? await action.mapInput({ parsed, raw: body, ctx }) : parsed
        const metadata = action.metadata ? await action.metadata({ input, parsed, raw: body, ctx }) : null
        const { result, logEntry } = await commandBus.execute(action.commandId, { input, ctx, metadata })
        const payload = action.response ? action.response({ result, logEntry, ctx }) : result
        const resolvedPayload = await Promise.resolve(payload)
        const status = action.status ?? 201
        return json(resolvedPayload, { status })
      }

      let input = opts.create.schema.parse(body)
      const modified = await opts.hooks?.beforeCreate?.(input as any, ctx)
      if (modified) input = modified
      const de = ctx.container.resolve<DataEngine>('dataEngine')
      const entityData = opts.create.mapToEntity(input as any, ctx)
      // Inject org/tenant
      const targetOrgId = ctx.selectedOrganizationId ?? ctx.auth.orgId ?? null
      if (ormCfg.orgField) {
        if (!targetOrgId) return json({ error: 'Organization context is required' }, { status: 400 })
        entityData[ormCfg.orgField] = targetOrgId
      }
      if (ormCfg.tenantField) {
        if (!ctx.auth.tenantId) return json({ error: 'Tenant context is required' }, { status: 400 })
        entityData[ormCfg.tenantField] = ctx.auth.tenantId
      }
      const entity = await de.createOrmEntity({ entity: ormCfg.entity, data: entityData })

      // Custom fields
      if (opts.create.customFields && (opts.create.customFields as any).enabled) {
        const cfc = opts.create.customFields as Exclude<CustomFieldsConfig, false>
        const values = cfc.map
          ? cfc.map(body)
          : (cfc.pickPrefixed ? extractCustomFieldValuesFromPayload(body as Record<string, unknown>) : {})
        if (values && Object.keys(values).length > 0) {
          const de = ctx.container.resolve<DataEngine>('dataEngine')
          await de.setCustomFields({
            entityId: cfc.entityId as any,
            recordId: String((entity as any)[ormCfg.idField!]),
            organizationId: targetOrgId,
            tenantId: ctx.auth.tenantId!,
            values,
          })
        }
      }

      await opts.hooks?.afterCreate?.(entity, { ...ctx, input: input as any })

      const identifiers = identifierResolver(entity, 'created')
      await de.emitOrmEntityEvent({
        action: 'created',
        entity,
        identifiers,
        events: opts.events as CrudEventsConfig | undefined,
        indexer: opts.indexer as CrudIndexerConfig | undefined,
      })

      const payload = opts.create.response ? opts.create.response(entity) : { id: String((entity as any)[ormCfg.idField!]) }
      return json(payload, { status: 201 })
    } catch (e) {
      return handleError(e)
    }
  }

  async function PUT(request: Request) {
    try {
      const useCommand = !!opts.actions?.update
      if (!opts.update && !useCommand) return json({ error: 'Not implemented' }, { status: 501 })
      const ctx = await withCtx(request)
      if (!ctx.auth) return json({ error: 'Unauthorized' }, { status: 401 })
      if (ormCfg.orgField && ctx.organizationIds && ctx.organizationIds.length === 0) return json({ error: 'Forbidden' }, { status: 403 })
      const body = await request.json().catch(() => ({}))

      if (useCommand) {
        const commandBus = ctx.container.resolve<CommandBus>('commandBus')
        const action = opts.actions!.update!
        const parsed = action.schema ? action.schema.parse(body) : body
        const input = action.mapInput ? await action.mapInput({ parsed, raw: body, ctx }) : parsed
        const metadata = action.metadata ? await action.metadata({ input, parsed, raw: body, ctx }) : null
        const { result, logEntry } = await commandBus.execute(action.commandId, { input, ctx, metadata })
        const payload = action.response ? action.response({ result, logEntry, ctx }) : result
        const resolvedPayload = await Promise.resolve(payload)
        const status = action.status ?? 200
        return json(resolvedPayload, { status })
      }

      let input = opts.update.schema.parse(body)
      const modified = await opts.hooks?.beforeUpdate?.(input as any, ctx)
      if (modified) input = modified

      const id = opts.update.getId ? opts.update.getId(input as any) : (input as any).id
      if (!isUuid(id)) return json({ error: 'Invalid id' }, { status: 400 })

      const targetOrgId = ctx.selectedOrganizationId ?? ctx.auth.orgId ?? null
      if (ormCfg.orgField && !targetOrgId) return json({ error: 'Organization context is required' }, { status: 400 })

      const de = ctx.container.resolve<DataEngine>('dataEngine')
      const where: any = buildScopedWhere(
        { [ormCfg.idField!]: id },
        {
          organizationId: ormCfg.orgField ? targetOrgId : undefined,
          organizationIds: ormCfg.orgField ? ctx.organizationIds ?? undefined : undefined,
          tenantId: ormCfg.tenantField ? ctx.auth.tenantId : undefined,
          orgField: ormCfg.orgField,
          tenantField: ormCfg.tenantField,
          softDeleteField: ormCfg.softDeleteField,
        }
      )
      const entity = await de.updateOrmEntity({ entity: ormCfg.entity, where, apply: (e: any) => opts.update!.applyToEntity(e, input as any, ctx) })
      if (!entity) return json({ error: 'Not found' }, { status: 404 })

      // Custom fields
      if (opts.update.customFields && (opts.update.customFields as any).enabled) {
        const cfc = opts.update.customFields as Exclude<CustomFieldsConfig, false>
        const values = cfc.map
          ? cfc.map(body)
          : (cfc.pickPrefixed ? extractCustomFieldValuesFromPayload(body as Record<string, unknown>) : {})
        if (values && Object.keys(values).length > 0) {
          const de = ctx.container.resolve<DataEngine>('dataEngine')
          await de.setCustomFields({
            entityId: cfc.entityId as any,
            recordId: String((entity as any)[ormCfg.idField!]),
            organizationId: targetOrgId,
            tenantId: ctx.auth.tenantId!,
            values,
          })
        }
      }

      await opts.hooks?.afterUpdate?.(entity, { ...ctx, input: input as any })
      const identifiers = identifierResolver(entity, 'updated')
      await de.emitOrmEntityEvent({
        action: 'updated',
        entity,
        identifiers,
        events: opts.events as CrudEventsConfig | undefined,
        indexer: opts.indexer as CrudIndexerConfig | undefined,
      })
      const payload = opts.update.response ? opts.update.response(entity) : { success: true }
      return json(payload)
    } catch (e) {
      return handleError(e)
    }
  }

  async function DELETE(request: Request) {
    try {
      const ctx = await withCtx(request)
      if (!ctx.auth) return json({ error: 'Unauthorized' }, { status: 401 })
      if (ormCfg.orgField && ctx.organizationIds && ctx.organizationIds.length === 0) return json({ error: 'Forbidden' }, { status: 403 })
      const useCommand = !!opts.actions?.delete
      const url = new URL(request.url)

      if (useCommand) {
        const action = opts.actions!.delete!
        const body = await request.json().catch(() => ({}))
        const raw = { body, query: Object.fromEntries(url.searchParams.entries()) }
        const parsed = action.schema ? action.schema.parse(raw) : raw
        const input = action.mapInput ? await action.mapInput({ parsed, raw, ctx }) : parsed
        const metadata = action.metadata ? await action.metadata({ input, parsed, raw, ctx }) : null
        const commandBus = ctx.container.resolve<CommandBus>('commandBus')
        const { result, logEntry } = await commandBus.execute(action.commandId, { input, ctx, metadata })
        const payload = action.response ? action.response({ result, logEntry, ctx }) : result
        const resolvedPayload = await Promise.resolve(payload)
        const status = action.status ?? 200
        return json(resolvedPayload, { status })
      }

      const idFrom = opts.del?.idFrom || 'query'
      const id = idFrom === 'query'
        ? url.searchParams.get('id')
        : (await request.json().catch(() => ({}))).id
      if (!isUuid(id)) return json({ error: 'ID is required' }, { status: 400 })

      const targetOrgId = ctx.selectedOrganizationId ?? ctx.auth.orgId ?? null
      if (ormCfg.orgField && !targetOrgId) return json({ error: 'Organization context is required' }, { status: 400 })

      const de = ctx.container.resolve<DataEngine>('dataEngine')
      const where: any = buildScopedWhere(
        { [ormCfg.idField!]: id },
        {
          organizationId: ormCfg.orgField ? targetOrgId : undefined,
          organizationIds: ormCfg.orgField ? ctx.organizationIds ?? undefined : undefined,
          tenantId: ormCfg.tenantField ? ctx.auth.tenantId : undefined,
          orgField: ormCfg.orgField,
          tenantField: ormCfg.tenantField,
          softDeleteField: ormCfg.softDeleteField,
        }
      )
      await opts.hooks?.beforeDelete?.(id!, ctx)
      const entity = await de.deleteOrmEntity({ entity: ormCfg.entity, where, soft: opts.del?.softDelete !== false, softDeleteField: ormCfg.softDeleteField })
      if (!entity) return json({ error: 'Not found' }, { status: 404 })
      await opts.hooks?.afterDelete?.(id!, ctx)
      if (entity) {
        const identifiers = identifierResolver(entity, 'deleted')
        await de.emitOrmEntityEvent({
          action: 'deleted',
          entity,
          identifiers,
          events: opts.events as CrudEventsConfig | undefined,
          indexer: opts.indexer as CrudIndexerConfig | undefined,
        })
      }
      const payload = opts.del?.response ? opts.del.response(id) : { success: true }
      return json(payload)
    } catch (e) {
      return handleError(e)
    }
  }

  return { metadata, GET, POST, PUT, DELETE }
}
