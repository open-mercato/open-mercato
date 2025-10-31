import { z } from 'zod'
import type { AwilixContainer } from 'awilix'
import { createRequestContainer } from '@/lib/di/container'
import { buildScopedWhere } from '@open-mercato/shared/lib/api/crud'
import { getAuthFromCookies, type AuthContext } from '@/lib/auth/server'
import type { QueryEngine, Where, Sort, Page, QueryCustomFieldSource, QueryJoinEdge } from '@open-mercato/shared/lib/query/types'
import { SortDir } from '@open-mercato/shared/lib/query/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { resolveOrganizationScopeForRequest, type OrganizationScope } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { serializeOperationMetadata } from '@open-mercato/shared/lib/commands/operationMetadata'
import type {
  CrudEventAction,
  CrudEventsConfig,
  CrudIndexerConfig,
  CrudIdentifierResolver,
} from './types'
import {
  extractCustomFieldValuesFromPayload,
  extractAllCustomFieldEntries,
  decorateRecordWithCustomFields,
  loadCustomFieldDefinitionIndex,
} from './custom-fields'
import { serializeExport, normalizeExportFormat, defaultExportFilename, ensureColumns, type CrudExportFormat, type PreparedExport } from './exporters'
import { CrudHttpError } from './errors'
import type { CommandBus, CommandLogMetadata } from '@open-mercato/shared/lib/commands'
import type { EntityId } from '@/modules/entities'
import type { EntityManager } from '@mikro-orm/postgresql'
import {
  buildCollectionTags,
  buildRecordTag,
  debugCrudCache,
  deriveResourceFromCommandId,
  expandResourceAliases,
  invalidateCrudCache,
  isCrudCacheDebugEnabled,
  isCrudCacheEnabled,
  normalizeIdentifierValue,
  normalizeTagSegment,
  resolveCrudCache,
} from './cache'
import { deriveCrudSegmentTag } from './cache-stats'
import { createProfiler, shouldEnableProfiler, type Profiler } from '@open-mercato/shared/lib/profiler'

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

export type CrudListCustomFieldDecorator = {
  entityIds: EntityId | EntityId[]
  resolveContext?: (item: any, ctx: CrudCtx) => { organizationId?: string | null; tenantId?: string | null }
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
  export?: CrudExportOptions
  customFieldSources?: QueryCustomFieldSource[]
  joins?: QueryJoinEdge[]
  decorateCustomFields?: CrudListCustomFieldDecorator
}

export type CrudExportColumnConfig = {
  field: string
  header?: string
  resolve?: (item: any) => unknown
}

export type CrudExportOptions = {
  enabled?: boolean
  formats?: CrudExportFormat[]
  filename?: string | ((format: CrudExportFormat) => string)
  columns?: CrudExportColumnConfig[]
  batchSize?: number
}

const DEFAULT_EXPORT_FORMATS: CrudExportFormat[] = ['csv', 'json', 'xml', 'markdown']
const DEFAULT_EXPORT_BATCH_SIZE = 1000
const MIN_EXPORT_BATCH_SIZE = 100
const MAX_EXPORT_BATCH_SIZE = 10000

type ColumnResolver = {
  field: string
  header: string
  resolve: (item: any) => unknown
}

function resolveAvailableExportFormats(list?: ListConfig<any>): CrudExportFormat[] {
  if (!list) return []
  if (list.export?.enabled === false) return []
  const formats = list.export?.formats && list.export.formats.length > 0
    ? [...list.export.formats]
    : [...DEFAULT_EXPORT_FORMATS]
  if (!list.export?.formats && list.allowCsv && !formats.includes('csv')) formats.push('csv')
  return Array.from(new Set(formats))
}

function resolveExportBatchSize(list: ListConfig<any> | undefined, requestedPageSize: number): number {
  const fallback = Math.max(requestedPageSize, DEFAULT_EXPORT_BATCH_SIZE)
  const raw = list?.export?.batchSize ?? fallback
  return Math.min(Math.max(raw, MIN_EXPORT_BATCH_SIZE), MAX_EXPORT_BATCH_SIZE)
}

function sanitizeFieldName(base: string, used: Set<string>, fallbackIndex: number): string {
  const trimmed = base.trim()
  const sanitized = trimmed.replace(/[^a-zA-Z0-9_\-]/g, '_') || `field_${fallbackIndex}`
  const normalized = /^[A-Za-z_]/.test(sanitized) ? sanitized : `f_${sanitized}`
  let candidate = normalized
  let counter = 1
  while (used.has(candidate)) {
    candidate = `${normalized}_${counter++}`
  }
  used.add(candidate)
  return candidate
}

function buildExportFromColumns(items: any[], columnsConfig: CrudExportColumnConfig[]): PreparedExport {
  const used = new Set<string>()
  const columns: ColumnResolver[] = columnsConfig.map((col, idx) => {
    const fieldName = sanitizeFieldName(col.field || `field_${idx}`, used, idx)
    const header = col.header?.trim().length ? col.header!.trim() : col.field || `Field ${idx + 1}`
    const resolver = col.resolve
      ? col.resolve
      : ((item: any) => (item != null ? (item as any)[col.field] : undefined))
    return { field: fieldName, header, resolve: resolver }
  })
  const rows = items.map((item) => {
    const row: Record<string, unknown> = {}
    columns.forEach((column) => {
      try {
        row[column.field] = column.resolve(item)
      } catch {
        row[column.field] = undefined
      }
    })
    return row
  })
  return {
    columns: columns.map(({ field, header }) => ({ field, header })),
    rows,
  }
}

function buildExportFromCsv(items: any[], csv: NonNullable<ListConfig<any>['csv']>): PreparedExport {
  const used = new Set<string>()
  const columns = csv.headers.map((header, idx) => ({
    field: sanitizeFieldName(header || `column_${idx + 1}`, used, idx),
    header: header || `Column ${idx + 1}`,
  }))
  const rows = items.map((item) => {
    const values = csv.row(item) || []
    const row: Record<string, unknown> = {}
    columns.forEach((column, idx) => {
      row[column.field] = values[idx]
    })
    return row
  })
  return { columns, rows }
}

function buildDefaultExport(items: any[]): PreparedExport {
  const rows = items.map((item) => {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      return { ...(item as Record<string, unknown>) }
    }
    return { value: item }
  })
  return {
    columns: ensureColumns(rows),
    rows,
  }
}

function prepareExportData(items: any[], list: ListConfig<any>): PreparedExport {
  if (list.export?.columns && list.export.columns.length > 0) {
    return buildExportFromColumns(items, list.export.columns)
  }
  if (list.csv && list.csv.headers && list.csv.row) {
    return buildExportFromCsv(items, list.csv)
  }
  const prepared = buildDefaultExport(items)
  return {
    columns: ensureColumns(prepared.rows, prepared.columns),
    rows: prepared.rows,
  }
}

function finalizeExportFilename(list: ListConfig<any>, format: CrudExportFormat, fallbackBase: string): string {
  const extension = format === 'markdown' ? 'md' : format
  const fromExport = list.export?.filename
  const apply = (value: string | null | undefined): string | null => {
    if (!value) return null
    const trimmed = value.trim()
    if (!trimmed) return null
    const sanitized = trimmed.replace(/[^a-z0-9_\-\.]/gi, '_')
    const lower = sanitized.toLowerCase()
    if (lower.endsWith(`.${extension}`)) return sanitized
    const withoutExtension = sanitized.includes('.') ? sanitized.replace(/\.[^.]+$/, '') : sanitized
    const base = withoutExtension.trim().length > 0 ? withoutExtension : sanitized
    return `${base}.${extension}`
  }
  if (typeof fromExport === 'function') {
    const computed = apply(fromExport(format))
    if (computed) return computed
  } else {
    const computed = apply(fromExport)
    if (computed) return computed
  }
  if (format === 'csv' && list.csv?.filename) {
    const csvName = apply(list.csv.filename)
    if (csvName) return csvName
  }
  return defaultExportFilename(fallbackBase, format)
}

function normalizeFullRecordForExport(input: any): any {
  if (!input || typeof input !== 'object') return input
  if (Array.isArray(input)) return input.map((item) => normalizeFullRecordForExport(item))
  const record: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(input)) {
    if (key.startsWith('cf_') || key.startsWith('cf:')) continue
    record[key] = value
  }
  const custom = extractAllCustomFieldEntries(input)
  for (const [rawKey, value] of Object.entries(custom)) {
    const sanitizedKey = rawKey.replace(/^cf_/, '')
    record[sanitizedKey] = value
  }
  return record
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

function deriveResourceFromActions(actions: CrudFactoryOptions<any, any, any>['actions']): string | null {
  if (!actions) return null
  const ids: Array<string | null | undefined> = [actions.create?.commandId, actions.update?.commandId, actions.delete?.commandId]
  for (const id of ids) {
    const resolved = deriveResourceFromCommandId(id)
    if (resolved) return resolved
  }
  return null
}

function resolveResourceAliasesList(
  opts: CrudFactoryOptions<any, any, any>,
  ormEntityName: string | undefined
): { primary: string; aliases: string[] } {
  const aliases: string[] = []
  const eventsResource = opts.events?.module && opts.events?.entity
    ? `${opts.events.module}.${opts.events.entity}`
    : null
  if (eventsResource) aliases.push(eventsResource)

  const commandResource = deriveResourceFromActions(opts.actions)
  if (commandResource && !aliases.includes(commandResource)) aliases.push(commandResource)

  if (ormEntityName && !aliases.includes(ormEntityName)) aliases.push(ormEntityName)

  if (!aliases.length) aliases.push('resource')

  return { primary: aliases[0], aliases }
}

function mergeCommandMetadata(base: CommandLogMetadata, override: CommandLogMetadata | null | undefined): CommandLogMetadata {
  if (!override) return base
  const mergedContext = {
    ...(base.context ?? {}),
    ...(override.context ?? {}),
  }
  const merged: CommandLogMetadata = {
    ...base,
    ...override,
  }
  if (Object.keys(mergedContext).length > 0) merged.context = mergedContext
  else if ('context' in merged) delete merged.context
  return merged
}

function json(data: any, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...(init || {}),
    headers: { 'content-type': 'application/json', ...(init?.headers || {}) },
  })
}

function attachOperationHeader(res: Response, logEntry: any) {
  if (!res || !(res instanceof Response)) return res
  if (!logEntry || typeof logEntry !== 'object') return res
  const undoToken = typeof logEntry.undoToken === 'string' ? logEntry.undoToken : null
  const id = typeof logEntry.id === 'string' ? logEntry.id : null
  const commandId = typeof logEntry.commandId === 'string' ? logEntry.commandId : null
  if (!undoToken || !id || !commandId) return res
  const actionLabel = typeof logEntry.actionLabel === 'string' ? logEntry.actionLabel : null
  const resourceKind = typeof logEntry.resourceKind === 'string' ? logEntry.resourceKind : null
  const resourceId = typeof logEntry.resourceId === 'string' ? logEntry.resourceId : null
  const createdAt = logEntry.createdAt instanceof Date
    ? logEntry.createdAt.toISOString()
    : (typeof logEntry.createdAt === 'string' ? logEntry.createdAt : new Date().toISOString())
  const headerValue = serializeOperationMetadata({
    id,
    undoToken,
    commandId,
    actionLabel,
    resourceKind,
    resourceId,
    executedAt: createdAt,
  })
  try {
    res.headers.set('x-om-operation', headerValue)
  } catch {
    // no-op if headers already sent
  }
  return res
}

function handleError(err: unknown): Response {
  if (err instanceof Response) return err
  if (err instanceof CrudHttpError) return json(err.body, { status: err.status })
  if (err instanceof z.ZodError) return json({ error: 'Invalid input', details: err.issues }, { status: 400 })

  const message = err instanceof Error ? err.message : undefined
  const stack = err instanceof Error ? err.stack : undefined
  // eslint-disable-next-line no-console
  console.error('[crud] unexpected error', { message, stack, err })
  const body: Record<string, unknown> = {
    error: 'Internal server error',
    message: 'Something went wrong. Please try again later.',
  }
  return json(body, { status: 500 })
}

function isUuid(v: any): v is string {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
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

function logForbidden(details: Record<string, unknown>) {
  try {
    // eslint-disable-next-line no-console
    console.warn('[crud] Forbidden request', details)
  } catch {}
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

function createCrudProfiler(resource: string, operation: string): Profiler {
  const enabled = shouldEnableProfiler(resource)
  return createProfiler({
    scope: `crud:${operation}`,
    target: resource,
    label: `${resource}:${operation}`,
    loggerLabel: '[crud:profile]',
    enabled,
  })
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

type CrudCacheStoredValue = {
  payload: any
  generatedAt: number
}

function safeClone<T>(value: T): T {
  try {
    const structuredCloneFn = (globalThis as any).structuredClone
    if (typeof structuredCloneFn === 'function') {
      return structuredCloneFn(value)
    }
  } catch {}
  try {
    return JSON.parse(JSON.stringify(value)) as T
  } catch {
    return value
  }
}

function collectScopeOrganizationIds(ctx: CrudCtx): Array<string | null> {
  if (Array.isArray(ctx.organizationIds) && ctx.organizationIds.length > 0) {
    return Array.from(new Set(ctx.organizationIds))
  }
  const fallback = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  return [fallback]
}

function serializeSearchParams(params: URLSearchParams): string {
  if (!params || params.keys().next().done) return ''
  const grouped = new Map<string, string[]>()
  params.forEach((value, key) => {
    const existing = grouped.get(key) ?? []
    existing.push(value)
    grouped.set(key, existing)
  })
  const normalized: Array<[string, string[]]> = Array.from(grouped.entries()).map(([key, values]) => [key, values.sort()])
  normalized.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return JSON.stringify(normalized)
}

function buildCrudCacheKey(resource: string, request: Request, ctx: CrudCtx): string {
  const url = new URL(request.url)
  const scopeIds = collectScopeOrganizationIds(ctx)
  const scopeSegment = scopeIds.length
    ? scopeIds.map((id) => normalizeTagSegment(id)).sort().join(',')
    : 'none'
  return [
    'crud',
    normalizeTagSegment(resource),
    'GET',
    url.pathname,
    `tenant:${normalizeTagSegment(ctx.auth?.tenantId ?? null)}`,
    `selectedOrg:${normalizeTagSegment(ctx.selectedOrganizationId ?? null)}`,
    `scope:${scopeSegment}`,
    `query:${serializeSearchParams(url.searchParams)}`,
  ].join('|')
}

function extractRecordIds(items: any[], idField: string): string[] {
  if (!Array.isArray(items) || !items.length) return []
  const ids = new Set<string>()
  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    const rawId = (item as any)[idField]
    const id = normalizeIdentifierValue(rawId)
    if (id) ids.add(id)
  }
  return Array.from(ids)
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
  const entityName = typeof ormCfg.entity?.name === 'string' && ormCfg.entity.name.length > 0 ? ormCfg.entity.name : undefined
  const resourceInfo = resolveResourceAliasesList(opts, entityName)
  const resourceKind = resourceInfo.primary
  const resourceAliases = resourceInfo.aliases
  const resourceTargets = expandResourceAliases(resourceKind, resourceAliases)
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

  const listCustomFieldDecorator = opts.list?.decorateCustomFields

  const inferFieldValue = (item: Record<string, unknown>, keys: string[]): string | null => {
    for (const key of keys) {
      const value = item[key]
      if (typeof value === 'string') {
        const trimmed = value.trim()
        if (trimmed.length) return trimmed
      }
    }
    return null
  }

  const decorateItemsWithCustomFields = async (items: any[], ctx: CrudCtx): Promise<any[]> => {
    if (!listCustomFieldDecorator || !Array.isArray(items) || items.length === 0) return items
    const entityIds = Array.isArray(listCustomFieldDecorator.entityIds)
      ? listCustomFieldDecorator.entityIds
      : [listCustomFieldDecorator.entityIds]
    if (!entityIds.length) return items
    const cfProfiler = createCrudProfiler(resourceKind, 'custom_fields')
    cfProfiler.mark('prepare')
    let profileClosed = false
    const endProfile = (extra?: Record<string, unknown>) => {
      if (!cfProfiler.enabled || profileClosed) return
      profileClosed = true
      cfProfiler.end(extra)
    }
    try {
      const em = ctx.container.resolve<EntityManager>('em')
      const organizationIds =
        Array.isArray(ctx.organizationIds) && ctx.organizationIds.length
          ? ctx.organizationIds
          : [ctx.selectedOrganizationId ?? null]
      const definitionIndex = await loadCustomFieldDefinitionIndex({
        em,
        entityIds,
        tenantId: ctx.auth?.tenantId ?? null,
        organizationIds,
      })
      cfProfiler.mark('definitions_loaded', { definitionCount: definitionIndex.size })
      const decoratedItems = items.map((raw) => {
        if (!raw || typeof raw !== 'object') return raw
        const item = raw as Record<string, unknown>
        const context = listCustomFieldDecorator.resolveContext
          ? listCustomFieldDecorator.resolveContext(raw, ctx) ?? {}
          : {}
        const organizationId =
          context.organizationId ??
          inferFieldValue(item, ['organization_id', 'organizationId'])
        const tenantId =
          context.tenantId ??
          inferFieldValue(item, ['tenant_id', 'tenantId']) ??
          ctx.auth?.tenantId ??
          null
        const decorated = decorateRecordWithCustomFields(item, definitionIndex, {
          organizationId: organizationId ?? null,
          tenantId: tenantId ?? null,
        })
        const output = {
          ...item,
          customValues: decorated.customValues,
          customFields: decorated.customFields,
        }
        return output
      })
      cfProfiler.mark('decorate_complete', { itemCount: decoratedItems.length })
      endProfile({
        entityIds: entityIds.length,
        itemCount: decoratedItems.length,
      })
      return decoratedItems
    } catch (err) {
      console.warn('[crud] failed to decorate custom fields', err)
      endProfile({
        result: 'error',
        entityIds: entityIds.length,
        itemCount: items.length,
      })
      return items
    }
  }

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
    const fallbackOrgId = selectedOrganizationId ?? auth?.orgId ?? null
    const rawScopeIds = scope?.filterIds
    const scopedIds = Array.isArray(rawScopeIds) ? rawScopeIds.filter((id): id is string => typeof id === 'string' && id.length > 0) : null
    if (scopedIds === null) {
      organizationIds = fallbackOrgId ? [fallbackOrgId] : null
    } else if (scopedIds.length > 0) {
      organizationIds = Array.from(new Set(scopedIds))
    } else if (fallbackOrgId) {
      const allowedIds = Array.isArray(scope?.allowedIds) ? scope.allowedIds : null
      let canUseFallback = false
      if (allowedIds === null) {
        canUseFallback = true
      } else if (allowedIds.includes(fallbackOrgId) || allowedIds.length === 0) {
        canUseFallback = true
      }
      if (canUseFallback) {
        organizationIds = [fallbackOrgId]
      } else {
        organizationIds = []
      }
    } else {
      organizationIds = []
    }
    return { container, auth, organizationScope: scope, selectedOrganizationId, organizationIds, request }
  }

  async function GET(request: Request) {
    const profiler = createCrudProfiler(resourceKind, 'list')
    const requestMeta: Record<string, unknown> = { method: request.method }
    try {
      const urlObj = new URL(request.url)
      requestMeta.path = urlObj.pathname
      requestMeta.url = request.url
      if (urlObj.search) requestMeta.query = urlObj.search
    } catch {
      requestMeta.url = request.url
    }
    profiler.mark('request_received', requestMeta)
    let profileClosed = false
    const finishProfile = (extra?: Record<string, unknown>) => {
      if (!profiler.enabled || profileClosed) return
      profileClosed = true
      const meta = extra ? { ...requestMeta, ...extra } : { ...requestMeta }
      profiler.end(meta)
    }
    try {
      profiler.mark('resolve_context')
      const ctx = await withCtx(request)
      profiler.mark('context_ready')
      if (!ctx.auth) {
        finishProfile({ reason: 'unauthorized' })
        return json({ error: 'Unauthorized' }, { status: 401 })
      }
      if (!opts.list) {
        finishProfile({ reason: 'list_not_configured' })
        return json({ error: 'Not implemented' }, { status: 501 })
      }
      const url = new URL(request.url)
      const queryParams = Object.fromEntries(url.searchParams.entries())
      profiler.mark('query_parsed')
      const validated = opts.list.schema.parse(queryParams)
      profiler.mark('query_validated')

      await opts.hooks?.beforeList?.(validated as any, ctx)
      profiler.mark('before_list_hook')

      const availableFormats = resolveAvailableExportFormats(opts.list)
      const requestedExport = normalizeExportFormat((queryParams as any).format)
      const exportRequested = requestedExport != null && availableFormats.includes(requestedExport)
      const requestedPage = Number((queryParams as any).page ?? 1) || 1
      const requestedPageSize = Math.min(Math.max(Number((queryParams as any).pageSize ?? 50) || 50, 1), 100)
      const exportPageSize = exportRequested ? resolveExportBatchSize(opts.list, requestedPageSize) : requestedPageSize
      const exportScopeParam = (queryParams as any).exportScope ?? (queryParams as any).export_scope
      const exportScope = typeof exportScopeParam === 'string' ? exportScopeParam.toLowerCase() : null
      const exportFullRequested = exportRequested && (exportScope === 'full' || String((queryParams as any).full || 'false').toLowerCase() === 'true')
      profiler.mark('export_configured', { exportRequested, exportFullRequested })

      const cacheEnabled = isCrudCacheEnabled() && !exportRequested
      const cacheTimerStart = cacheEnabled && isCrudCacheDebugEnabled()
        ? process.hrtime.bigint()
        : null
      const cache = cacheEnabled ? resolveCrudCache(ctx.container) : null
      const cacheKey = cacheEnabled ? buildCrudCacheKey(resourceKind, request, ctx) : null
      let cacheStatus: 'hit' | 'miss' = 'miss'
      let cachedValue: CrudCacheStoredValue | null = null

      if (cacheEnabled && cache && cacheKey) {
        const rawCached = await cache.get(cacheKey)
        if (rawCached !== null && rawCached !== undefined) {
          if (typeof rawCached === 'object' && 'payload' in (rawCached as any)) {
            cachedValue = rawCached as CrudCacheStoredValue
          } else {
            cachedValue = { payload: rawCached, generatedAt: Date.now() }
          }
        }
      }
      profiler.mark('cache_checked', { cached: cachedValue !== null })

      const tenantForScope = ctx.auth?.tenantId ?? null
      const maybeStoreCrudCache = async (payload: any) => {
        if (!cacheEnabled || !cache || !cacheKey) return
        if (!payload || typeof payload !== 'object') return
        const items = Array.isArray((payload as any).items) ? (payload as any).items : []
        const tags = new Set<string>()
        const scopeOrgIds = collectScopeOrganizationIds(ctx)
        const crudSegment = deriveCrudSegmentTag(resourceKind, request)
        for (const target of resourceTargets) {
          for (const tag of buildCollectionTags(target, tenantForScope, scopeOrgIds)) {
            tags.add(tag)
          }
        }
        const recordIds = extractRecordIds(items, ormCfg.idField!)
        for (const recordId of recordIds) {
          for (const target of resourceTargets) {
            tags.add(buildRecordTag(target, tenantForScope, recordId))
          }
        }
        if (crudSegment) {
          tags.add(`crud:segment:${crudSegment}`)
        }
        if (!tags.size) return
        try {
          await cache.set(cacheKey, { payload: safeClone(payload), generatedAt: Date.now() }, { tags: Array.from(tags) })
          debugCrudCache('store', {
            resource: resourceKind,
            key: cacheKey,
            tags: Array.from(tags),
            itemCount: items.length,
          })
        } catch (err) {
          debugCrudCache('store', {
            resource: resourceKind,
            key: cacheKey,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }

      const logCacheOutcome = (event: 'hit' | 'miss', itemCount: number) => {
        if (!cacheTimerStart) return
        const elapsedMs = Number(process.hrtime.bigint() - cacheTimerStart) / 1_000_000
        debugCrudCache(event, {
          resource: resourceKind,
          key: cacheKey,
          durationMs: Math.round(elapsedMs * 1000) / 1000,
          itemCount,
        })
      }

      const respondWithPayload = (payload: any, extraHeaders?: Record<string, string>) => {
        const headers: Record<string, string> = extraHeaders ? { ...extraHeaders } : {}
        const warning = payload && typeof payload === 'object' && payload.meta?.partialIndexWarning
        if (warning) {
          headers['x-om-partial-index'] = JSON.stringify({
            type: 'partial_index',
            entity: warning.entity,
            baseCount: warning.baseCount ?? null,
            indexedCount: warning.indexedCount ?? null,
            scope: warning.scope ?? 'scoped',
          })
        }
        if (cacheEnabled) {
          headers['x-om-cache'] = cacheStatus
        }
        return json(payload, Object.keys(headers).length ? { headers } : undefined)
      }

      if (cachedValue) {
        cacheStatus = 'hit'
        profiler.mark('cache_hit', { generatedAt: cachedValue.generatedAt ?? null })
        const payload = safeClone(cachedValue.payload)
        const items = Array.isArray((payload as any)?.items) ? (payload as any).items : []
        profiler.mark('cache_payload_ready', { itemCount: items.length })
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
        await opts.hooks?.afterList?.(payload, { ...ctx, query: validated as any })
        logCacheOutcome('hit', items.length)
        const response = respondWithPayload(payload)
        finishProfile({ result: 'cache_hit', cacheStatus })
        return response
      }

      // Prefer query engine when configured
      if (opts.list.entityId && opts.list.fields) {
        profiler.mark('query_engine_prepare')
        const qe = ctx.container.resolve<QueryEngine>('queryEngine')
        profiler.mark('query_engine_resolved')
        const sortFieldRaw = (queryParams as any).sortField || 'id'
        const sortDirRaw = ((queryParams as any).sortDir || 'asc').toLowerCase() === 'desc' ? SortDir.Desc : SortDir.Asc
        const sortField = (opts.list.sortFieldMap && opts.list.sortFieldMap[sortFieldRaw]) || sortFieldRaw
        const sort: Sort[] = [{ field: sortField as any, dir: sortDirRaw } as any]
        const page: Page = exportRequested
          ? { page: 1, pageSize: exportPageSize }
          : { page: requestedPage, pageSize: requestedPageSize }
        const filters = exportFullRequested
          ? ({} as Where<any>)
          : (opts.list.buildFilters ? await opts.list.buildFilters(validated as any, ctx) : ({} as Where<any>))
        const withDeleted = String((queryParams as any).withDeleted || 'false') === 'true'
        profiler.mark('filters_ready', { withDeleted })
        if (ormCfg.orgField && ctx.organizationIds && ctx.organizationIds.length === 0) {
          profiler.mark('scope_blocked')
          logForbidden({
            resourceKind,
            action: 'list',
            reason: 'organization_scope_empty',
            userId: ctx.auth?.sub ?? null,
            tenantId: ctx.auth?.tenantId ?? null,
            organizationIds: ctx.organizationIds,
          })
          const emptyPayload = { items: [], total: 0, page: page.page, pageSize: page.pageSize, totalPages: 0 }
          await opts.hooks?.afterList?.(emptyPayload, { ...ctx, query: validated as any })
          await maybeStoreCrudCache(emptyPayload)
          logCacheOutcome(cacheStatus, emptyPayload.items.length)
          const response = respondWithPayload(emptyPayload)
          finishProfile({ result: 'empty_scope', cacheStatus, itemCount: 0, total: 0 })
          return response
        }
        const queryOpts: any = {
          fields: opts.list.fields!,
          includeCustomFields: true,
          sort,
          page,
          filters,
          withDeleted,
        }
        if (opts.list.customFieldSources) {
          queryOpts.customFieldSources = opts.list.customFieldSources
        }
        if (opts.list.joins) {
          queryOpts.joins = opts.list.joins
        }
        if (ormCfg.tenantField) queryOpts.tenantId = ctx.auth.tenantId!
        if (ormCfg.orgField) {
          queryOpts.organizationId = ctx.selectedOrganizationId ?? undefined
          queryOpts.organizationIds = ctx.organizationIds ?? undefined
        }
        const queryEntity = String(opts.list.entityId)
        profiler.mark('query_options_ready')
        const queryProfiler = profiler.child('query_engine', { entity: queryEntity })
        const res = await qe.query(opts.list.entityId as any, { ...queryOpts, profiler: queryProfiler })
        const rawItems = res.items || []
        let transformedItems = rawItems.map(i => (opts.list!.transformItem ? opts.list!.transformItem(i) : i))
        profiler.mark('transform_complete', { itemCount: transformedItems.length })
        transformedItems = await decorateItemsWithCustomFields(transformedItems, ctx)
        profiler.mark('custom_fields_complete', { itemCount: transformedItems.length })

        await logCrudAccess({
          container: ctx.container,
          auth: ctx.auth,
          request,
          items: transformedItems,
          idField: ormCfg.idField!,
          resourceKind,
          organizationId: ctx.selectedOrganizationId ?? ctx.auth.orgId ?? null,
          tenantId: ctx.auth.tenantId ?? null,
          query: validated,
        })
        profiler.mark('access_logged')

        if (exportRequested && requestedExport) {
          const total = typeof res.total === 'number' ? res.total : rawItems.length
          const initialExportItems = exportFullRequested
            ? rawItems.map(normalizeFullRecordForExport)
            : transformedItems
          let exportItems = [...initialExportItems]
          if (total > exportItems.length) {
            const exportPageSizeNumber = typeof page.pageSize === 'number' ? page.pageSize : exportPageSize
            const queryBase: any = { ...queryOpts }
            delete queryBase.page
            let nextPage = 2
            while (exportItems.length < total) {
              profiler.mark('export_next_page_request', { page: nextPage })
              const nextRes = await qe.query(opts.list.entityId as any, {
                ...queryBase,
                page: { page: nextPage, pageSize: exportPageSizeNumber },
                profiler: profiler.child('query_engine', { entity: queryEntity, page: nextPage, mode: 'export' }),
              })
              const nextItemsRaw = nextRes.items || []
              if (!nextItemsRaw.length) break
              let nextTransformed = nextItemsRaw.map(i => (opts.list!.transformItem ? opts.list!.transformItem(i) : i))
              nextTransformed = await decorateItemsWithCustomFields(nextTransformed, ctx)
              const nextExportItems = exportFullRequested
                ? nextItemsRaw.map(normalizeFullRecordForExport)
                : nextTransformed
              exportItems.push(...nextExportItems)
              if (nextExportItems.length < exportPageSizeNumber) break
              nextPage += 1
            }
          }
          const prepared = exportFullRequested
            ? { columns: ensureColumns(exportItems), rows: exportItems }
            : prepareExportData(exportItems, opts.list)
          const fallbackBase = `${opts.events?.entity || resourceKind || 'list'}${exportFullRequested ? '_full' : ''}`
          const filename = finalizeExportFilename(opts.list, requestedExport, fallbackBase)
          const serialized = serializeExport(prepared, requestedExport)
          const exportPayload = { items: exportItems, total, page: 1, pageSize: exportItems.length, totalPages: 1, ...(res.meta ? { meta: res.meta } : {}) }
          await opts.hooks?.afterList?.(exportPayload, { ...ctx, query: validated as any })
          profiler.mark('after_list_hook')
          const response = new Response(serialized.body, {
            headers: {
              'content-type': serialized.contentType,
              'content-disposition': `attachment; filename="${filename}"`,
            },
          })
          if (res.meta?.partialIndexWarning) {
            response.headers.set(
              'x-om-partial-index',
              JSON.stringify({
                type: 'partial_index',
                entity: res.meta.partialIndexWarning.entity,
                baseCount: res.meta.partialIndexWarning.baseCount ?? null,
                indexedCount: res.meta.partialIndexWarning.indexedCount ?? null,
                scope: res.meta.partialIndexWarning.scope ?? 'scoped',
              }),
            )
          }
          finishProfile({
            result: 'export',
            cacheStatus,
            itemCount: exportItems.length,
            total,
          })
          return response
        }

        const payload = {
          items: transformedItems,
          total: res.total,
          page: page.page || requestedPage,
          pageSize: page.pageSize || requestedPageSize,
          totalPages: Math.ceil(res.total / (Number(page.pageSize) || 1)),
          ...(res.meta ? { meta: res.meta } : {}),
        }
        await opts.hooks?.afterList?.(payload, { ...ctx, query: validated as any })
        profiler.mark('after_list_hook')
        await maybeStoreCrudCache(payload)
        profiler.mark('cache_store_attempt', { cacheEnabled })
        logCacheOutcome(cacheStatus, payload.items.length)
        const response = respondWithPayload(payload)
        finishProfile({
          result: 'ok',
          cacheStatus,
          itemCount: payload.items.length,
          total: payload.total ?? payload.items.length,
        })
        return response
      }

      // Fallback: plain ORM list
      profiler.mark('orm_fallback_prepare')
      const em = ctx.container.resolve<any>('em')
      const repo = em.getRepository(ormCfg.entity)
      profiler.mark('orm_repo_ready')
      if (ormCfg.orgField && ctx.organizationIds && ctx.organizationIds.length === 0) {
        profiler.mark('fallback_scope_blocked')
        logForbidden({
          resourceKind,
          action: 'list',
          reason: 'organization_scope_empty',
          userId: ctx.auth?.sub ?? null,
          tenantId: ctx.auth?.tenantId ?? null,
          organizationIds: ctx.organizationIds,
        })
        const emptyPayload = { items: [], total: 0 }
        await opts.hooks?.afterList?.(emptyPayload, { ...ctx, query: validated as any })
        await maybeStoreCrudCache(emptyPayload)
        logCacheOutcome(cacheStatus, emptyPayload.items.length)
        const response = respondWithPayload(emptyPayload)
        finishProfile({
          result: 'empty_scope',
          cacheStatus,
          itemCount: 0,
          total: 0,
          branch: 'fallback',
        })
        return response
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
      let list = await repo.find(where)
      profiler.mark('orm_query_complete', { itemCount: Array.isArray(list) ? list.length : 0 })
      list = await decorateItemsWithCustomFields(list, ctx)
      profiler.mark('fallback_custom_fields_complete', { itemCount: Array.isArray(list) ? list.length : 0 })
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
      profiler.mark('access_logged')
      if (exportRequested && requestedExport) {
        const exportItems = exportFullRequested ? list.map(normalizeFullRecordForExport) : list
        const prepared = exportFullRequested
          ? { columns: ensureColumns(exportItems), rows: exportItems }
          : prepareExportData(exportItems, opts.list)
        const fallbackBase = `${opts.events?.entity || resourceKind || 'list'}${exportFullRequested ? '_full' : ''}`
        const filename = finalizeExportFilename(opts.list, requestedExport, fallbackBase)
        const serialized = serializeExport(prepared, requestedExport)
        await opts.hooks?.afterList?.({ items: exportItems, total: exportItems.length, page: 1, pageSize: exportItems.length, totalPages: 1 }, { ...ctx, query: validated as any })
        profiler.mark('after_list_hook')
        const response = new Response(serialized.body, {
          headers: {
            'content-type': serialized.contentType,
            'content-disposition': `attachment; filename="${filename}"`,
          },
        })
        finishProfile({
          result: 'export',
          cacheStatus,
          itemCount: exportItems.length,
          total: exportItems.length,
          branch: 'fallback',
        })
        return response
      }
      const payload = { items: list, total: list.length }
      await opts.hooks?.afterList?.(payload, { ...ctx, query: validated as any })
      profiler.mark('after_list_hook')
      await maybeStoreCrudCache(payload)
      profiler.mark('cache_store_attempt', { cacheEnabled })
      logCacheOutcome(cacheStatus, payload.items.length)
      const response = respondWithPayload(payload)
      finishProfile({
        result: 'ok',
        cacheStatus,
        itemCount: payload.items.length,
        total: payload.total,
        branch: 'fallback',
      })
      return response
    } catch (e) {
      finishProfile({ result: 'error' })
      return handleError(e)
    }
  }

  async function POST(request: Request) {
    try {
      const useCommand = !!opts.actions?.create
      if (!opts.create && !useCommand) return json({ error: 'Not implemented' }, { status: 501 })
      const ctx = await withCtx(request)
      if (!ctx.auth) return json({ error: 'Unauthorized' }, { status: 401 })
      if (ormCfg.orgField && ctx.organizationIds && ctx.organizationIds.length === 0) {
        logForbidden({
          resourceKind,
          action: 'create',
          reason: 'organization_scope_empty',
          userId: ctx.auth?.sub ?? null,
          tenantId: ctx.auth?.tenantId ?? null,
          organizationIds: ctx.organizationIds,
        })
        return json({ error: 'Forbidden' }, { status: 403 })
      }
      const body = await request.json().catch(() => ({}))

      if (useCommand) {
        const commandBus = ctx.container.resolve<CommandBus>('commandBus')
        const action = opts.actions!.create!
        const parsed = action.schema ? action.schema.parse(body) : body
        const input = action.mapInput ? await action.mapInput({ parsed, raw: body, ctx }) : parsed
        const userMetadata = action.metadata ? await action.metadata({ input, parsed, raw: body, ctx }) : null
        const baseMetadata: CommandLogMetadata = {
          tenantId: ctx.auth?.tenantId ?? null,
          organizationId: ctx.selectedOrganizationId ?? ctx.auth.orgId ?? null,
          resourceKind,
          context: { cacheAliases: resourceTargets },
        }
        const metadataToSend = mergeCommandMetadata(baseMetadata, userMetadata)
        const { result, logEntry } = await commandBus.execute(action.commandId, { input, ctx, metadata: metadataToSend })
        const payload = action.response ? action.response({ result, logEntry, ctx }) : result
        const resolvedPayload = await Promise.resolve(payload)
        const status = action.status ?? 201
        const response = json(resolvedPayload, { status })
        attachOperationHeader(response, logEntry)
        return response
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
      de.markOrmEntityChange({
        action: 'created',
        entity,
        identifiers,
        events: opts.events as CrudEventsConfig | undefined,
        indexer: opts.indexer as CrudIndexerConfig | undefined,
      })
      await de.flushOrmEntityChanges()
      await invalidateCrudCache(ctx.container, resourceKind, identifiers, ctx.auth.tenantId ?? null, 'created', resourceTargets)

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
      if (ormCfg.orgField && ctx.organizationIds && ctx.organizationIds.length === 0) {
        logForbidden({
          resourceKind,
          action: 'update',
          reason: 'organization_scope_empty',
          userId: ctx.auth?.sub ?? null,
          tenantId: ctx.auth?.tenantId ?? null,
          organizationIds: ctx.organizationIds,
        })
        return json({ error: 'Forbidden' }, { status: 403 })
      }
      const body = await request.json().catch(() => ({}))

      if (useCommand) {
        const commandBus = ctx.container.resolve<CommandBus>('commandBus')
        const action = opts.actions!.update!
        const parsed = action.schema ? action.schema.parse(body) : body
        const input = action.mapInput ? await action.mapInput({ parsed, raw: body, ctx }) : parsed
        const userMetadata = action.metadata ? await action.metadata({ input, parsed, raw: body, ctx }) : null
        const candidateId = normalizeIdentifierValue((input as Record<string, unknown> | null | undefined)?.id)
        const baseMetadata: CommandLogMetadata = {
          tenantId: ctx.auth?.tenantId ?? null,
          organizationId: ctx.selectedOrganizationId ?? ctx.auth.orgId ?? null,
          resourceKind,
          context: { cacheAliases: resourceTargets },
        }
        if (candidateId) baseMetadata.resourceId = candidateId
        const metadataToSend = mergeCommandMetadata(baseMetadata, userMetadata)
        const { result, logEntry } = await commandBus.execute(action.commandId, { input, ctx, metadata: metadataToSend })
        const payload = action.response ? action.response({ result, logEntry, ctx }) : result
        const resolvedPayload = await Promise.resolve(payload)
        const status = action.status ?? 200
        const response = json(resolvedPayload, { status })
        attachOperationHeader(response, logEntry)
        return response
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
      de.markOrmEntityChange({
        action: 'updated',
        entity,
        identifiers,
        events: opts.events as CrudEventsConfig | undefined,
        indexer: opts.indexer as CrudIndexerConfig | undefined,
      })
      await de.flushOrmEntityChanges()
      await invalidateCrudCache(ctx.container, resourceKind, identifiers, ctx.auth.tenantId ?? null, 'updated', resourceTargets)
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
      if (ormCfg.orgField && ctx.organizationIds && ctx.organizationIds.length === 0) {
        logForbidden({
          resourceKind,
          action: 'delete',
          reason: 'organization_scope_empty',
          userId: ctx.auth?.sub ?? null,
          tenantId: ctx.auth?.tenantId ?? null,
          organizationIds: ctx.organizationIds,
        })
        return json({ error: 'Forbidden' }, { status: 403 })
      }
      const useCommand = !!opts.actions?.delete
      const url = new URL(request.url)

      if (useCommand) {
        const action = opts.actions!.delete!
        const body = await request.json().catch(() => ({}))
        const raw = { body, query: Object.fromEntries(url.searchParams.entries()) }
        const parsed = action.schema ? action.schema.parse(raw) : raw
        const input = action.mapInput ? await action.mapInput({ parsed, raw, ctx }) : parsed
        const userMetadata = action.metadata ? await action.metadata({ input, parsed, raw, ctx }) : null
        const commandBus = ctx.container.resolve<CommandBus>('commandBus')
        const candidateId = normalizeIdentifierValue(
          (input as Record<string, unknown> | null | undefined)?.id
            ?? (raw.query as Record<string, unknown> | null | undefined)?.id
            ?? (raw.body as Record<string, unknown> | null | undefined)?.id
        )
        const baseMetadata: CommandLogMetadata = {
          tenantId: ctx.auth?.tenantId ?? null,
          organizationId: ctx.selectedOrganizationId ?? ctx.auth.orgId ?? null,
          resourceKind,
          context: { cacheAliases: resourceTargets },
        }
        if (candidateId) baseMetadata.resourceId = candidateId
        const metadataToSend = mergeCommandMetadata(baseMetadata, userMetadata)
        const { result, logEntry } = await commandBus.execute(action.commandId, { input, ctx, metadata: metadataToSend })
        const payload = action.response ? action.response({ result, logEntry, ctx }) : result
        const resolvedPayload = await Promise.resolve(payload)
        const status = action.status ?? 200
        const response = json(resolvedPayload, { status })
        attachOperationHeader(response, logEntry)
        return response
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
        de.markOrmEntityChange({
          action: 'deleted',
          entity,
          identifiers,
          events: opts.events as CrudEventsConfig | undefined,
          indexer: opts.indexer as CrudIndexerConfig | undefined,
        })
        await de.flushOrmEntityChanges()
        await invalidateCrudCache(ctx.container, resourceKind, identifiers, ctx.auth.tenantId ?? null, 'deleted', resourceTargets)
      }
      const payload = opts.del?.response ? opts.del.response(id) : { success: true }
      return json(payload)
    } catch (e) {
      return handleError(e)
    }
  }

  return { metadata, GET, POST, PUT, DELETE }
}
