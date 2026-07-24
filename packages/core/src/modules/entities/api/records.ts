import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import type { QueryEngine, QueryOptions, Where, Sort } from '@open-mercato/shared/lib/query/types'
import { normalizeExportFormat, serializeExport, defaultExportFilename, ensureColumns } from '@open-mercato/shared/lib/crud/exporters'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { resolveOrganizationScope, getSelectedOrganizationFromRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { SYSTEM_ENTITY_RECORDS_BLOCKED_CODE, isOrmBackedSystemEntityId } from '@open-mercato/shared/lib/data/engine'
import { parseBooleanToken, parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
import { parseCommaSeparatedList } from '@open-mercato/shared/lib/string'
import { setRecordCustomFields } from '../lib/helpers'
import { CustomFieldValue } from '../data/entities'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { getModules } from '@open-mercato/shared/lib/i18n/server'
import { assertEntityAclForRequest } from '../lib/entityAcl'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('entities').child({ component: 'records' })

let declaredCustomEntityRestricted: Map<string, boolean> | null = null
function loadDeclaredCustomEntities(): Map<string, boolean> {
  if (declaredCustomEntityRestricted === null) {
    try {
      const mods = getModules() as Array<{ customEntities?: Array<{ id?: string; accessRestricted?: boolean }> }>
      const map = new Map<string, boolean>()
      for (const mod of mods ?? []) {
        for (const spec of mod?.customEntities ?? []) {
          if (spec?.id) map.set(spec.id, spec.accessRestricted === true)
        }
      }
      // Cache even when empty so we don't rebuild on every request (and fall back
      // to the DB lookup unnecessarily). Only a thrown getModules() leaves it null
      // so a genuinely-uninitialized registry is retried.
      declaredCustomEntityRestricted = map
    } catch {}
  }
  return declaredCustomEntityRestricted ?? new Map<string, boolean>()
}
function isDeclaredCustomEntity(entityId: string): boolean {
  return loadDeclaredCustomEntities().has(entityId)
}

type RecordsEntityScope = { tenantId: string | null; organizationId: string | null }

// Resolve the CustomEntity registration that applies to THIS caller, most-specific
// first (org+tenant → tenant-global → instance-global), mirroring the overlay
// precedence used by the entity-definitions list. Scoping matters because the
// row's `access_restricted` flag is a security control: an unscoped lookup could
// read another tenant's row for a colliding entityId (e.g. `user:vendors`) and
// mis-decide the restriction. Returns null when the caller's scope has no row.
async function findScopedCustomEntity(em: any, CustomEntity: any, entityId: string, scope: RecordsEntityScope) {
  const { tenantId, organizationId } = scope
  const candidates: Array<Record<string, unknown>> = [
    { entityId, organizationId, tenantId },
    { entityId, organizationId: null, tenantId },
    { entityId, organizationId: null, tenantId: null },
  ]
  const seen = new Set<string>()
  for (const where of candidates) {
    const key = JSON.stringify(where)
    if (seen.has(key)) continue
    seen.add(key)
    const row = await em.findOne(CustomEntity as any, where)
    if (row) return row
  }
  return null
}

const CUSTOM_ENTITY_RECORD_RESOURCE_KIND = 'entities.record'

type RecordsEntityKind = 'system' | 'custom' | 'unknown'

// `restricted` is meaningful only when `kind === 'custom'`; it drives the
// per-entity ACL gate in `assertEntityAclForRequest`.
type RecordsEntityClassification = { kind: RecordsEntityKind; restricted: boolean }

// This surface manages doc-storage records, which exist for CUSTOM entities only.
// Module-declared ids backed by a registered ORM table are system entities — their
// records live in their own module tables/APIs, and stray doc rows for them poisoned
// read-path classification platform-wide (#2939) — so they are rejected outright. The
// previous fallback that classified an entity by the mere presence of
// `custom_entities_storage` rows is gone: within the allowed set, declaration (ce.ts)
// or an active `custom_entities` registration is authoritative.
async function classifyRecordsEntity(em: any, entityId: string, scope: RecordsEntityScope): Promise<RecordsEntityClassification> {
  if (isOrmBackedSystemEntityId(em, entityId)) return { kind: 'system', restricted: false }
  const declared = loadDeclaredCustomEntities()
  if (declared.has(entityId)) return { kind: 'custom', restricted: declared.get(entityId) === true }
  try {
    const { CustomEntity } = await import('../data/entities')
    // Restriction is decided from the row that applies to THIS caller's scope so
    // a colliding entityId in another tenant can't flip the flag.
    const scoped = await findScopedCustomEntity(em, CustomEntity, entityId, scope)
    if (scoped) return { kind: 'custom', restricted: (scoped as any).accessRestricted === true }
    // No in-scope registration: preserve the historical custom-vs-unknown
    // classification (any registration row — active or soft-deleted — proves the
    // id is custom; records persist beyond soft delete, TC-ENTITIES-006). A row
    // outside the caller's scope never marks the entity restricted for them, and
    // the record query is itself tenant/org-scoped, so this cannot leak data.
    const anyRow = await em.findOne(CustomEntity as any, { entityId })
    if (anyRow) return { kind: 'custom', restricted: false }
  } catch {}
  return { kind: 'unknown', restricted: false }
}

function systemEntityRecordsRejection(entityId: string) {
  return NextResponse.json(
    { error: 'Records are available for custom entities only', code: SYSTEM_ENTITY_RECORDS_BLOCKED_CODE, entityId },
    { status: 400 },
  )
}

async function readCustomEntityRecordUpdatedAt(
  em: any,
  input: { entityType: string; entityId: string; organizationId: string | null },
): Promise<string | null> {
  try {
    const db = em.getKysely()
    let query = db
      .selectFrom('custom_entities_storage' as any)
      .select(['updated_at' as any])
      .where('entity_type' as any, '=', input.entityType)
      .where('entity_id' as any, '=', input.entityId)
    query = input.organizationId === null
      ? query.where('organization_id' as any, 'is', null as any)
      : query.where('organization_id' as any, '=', input.organizationId)
    const row = await query.executeTakeFirst()
    const value = (row as any)?.updated_at
    if (value instanceof Date) return value.toISOString()
    if (typeof value === 'string' && value.length > 0) return value
    return null
  } catch {
    return null
  }
}

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['entities.records.view'] },
  POST: { requireAuth: true, requireFeatures: ['entities.records.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['entities.records.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['entities.records.manage'] },
}

const DEFAULT_EXPORT_PAGE_SIZE = 1000

const listRecordsQuerySchema = z
  .object({
    entityId: z.string().min(1),
    page: z.coerce.number().int().min(1).optional(),
    pageSize: z.coerce.number().int().min(1).max(100).optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
    search: z.string().optional(),
    searchFields: z.string().optional(),
    withDeleted: z.coerce.boolean().optional(),
    format: z.enum(['csv', 'json', 'xml', 'markdown']).optional(),
    exportScope: z.enum(['full']).optional(),
    export_scope: z.enum(['full']).optional(),
    all: z.coerce.boolean().optional(),
    full: z.coerce.boolean().optional(),
  })
  .passthrough()

const recordItemSchema = z.record(z.string(), z.any())

const listRecordsResponseSchema = z.object({
  items: z.array(recordItemSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
  totalPages: z.number(),
})

export async function GET(req: Request) {
  const url = new URL(req.url)
  const entityId = url.searchParams.get('entityId') || ''
  if (!entityId) return NextResponse.json({ error: 'entityId is required' }, { status: 400 })

  const auth = await getAuthFromRequest(req)
  if (!auth || !auth.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const requestedExport = normalizeExportFormat(url.searchParams.get('format'))
  const exportScopeRaw = (url.searchParams.get('exportScope') || url.searchParams.get('export_scope') || '').toLowerCase()
  const exportFullRequested = requestedExport != null && (exportScopeRaw === 'full' || parseBooleanWithDefault(url.searchParams.get('full'), false))
  const exportAll = parseBooleanWithDefault(url.searchParams.get('all'), false)
  const noPagination = exportAll || requestedExport != null
  const page = noPagination ? 1 : Math.max(parseInt(url.searchParams.get('page') || '1', 10) || 1, 1)
  const basePageSize = Math.min(Math.max(parseInt(url.searchParams.get('pageSize') || '50', 10) || 50, 1), 100)
  const pageSize = noPagination ? Math.max(basePageSize, DEFAULT_EXPORT_PAGE_SIZE) : basePageSize
  const sortField = url.searchParams.get('sortField') || 'id'
  const sortDir = (url.searchParams.get('sortDir') || 'asc').toLowerCase() === 'desc' ? 'desc' : 'asc'
  const withDeleted = parseBooleanWithDefault(url.searchParams.get('withDeleted'), false)
  const searchTerm = (url.searchParams.get('search') || '').trim()
  const searchFields = parseCommaSeparatedList(url.searchParams.get('searchFields'))

  const qpEntries: Array<[string, string]> = []
  for (const [key, val] of url.searchParams.entries()) {
    if (['entityId','page','pageSize','sortField','sortDir','withDeleted','format','exportScope','export_scope','all','full','search','searchFields'].includes(key)) continue
    qpEntries.push([key, val])
  }

  try {
    const { resolve } = await createRequestContainer()
    const qe = resolve('queryEngine') as QueryEngine
    const em = resolve('em') as any
    const rbac = resolve('rbacService') as RbacService
    const scope = await resolveOrganizationScope({ em, rbac, auth, selectedId: getSelectedOrganizationFromRequest(req) })
    let organizationIds: string[] | null = scope.filterIds
    // Module-declared custom entities (ce.ts) carry frozen system-style ids and are never
    // registered in `custom_entities`, so classification checks the declared registry plus
    // active registrations. System (table-backed) ids are rejected above; for the allowed
    // set `isCustomEntity` drives mapRow's cf_ stripping so the edit form reads back values.
    const { kind: entityKind, restricted: isRestricted } = await classifyRecordsEntity(em, entityId, { tenantId: auth.tenantId ?? null, organizationId: scope.selectedId ?? auth.orgId ?? null })
    if (entityKind === 'system') return systemEntityRecordsRejection(entityId)
    const isCustomEntity = entityKind === 'custom'
    await assertEntityAclForRequest({ auth, entityId, action: 'view', isCustomEntity, isRestricted, rbac })
    if (organizationIds && organizationIds.length === 0) {
      return NextResponse.json({ items: [], total: 0, page, pageSize, totalPages: 0 })
    }
    const normalizeCustomEntityValue = (value: unknown) => {
      if (Array.isArray(value)) {
        return value.map((entry) => {
          if (typeof entry !== 'string') return entry
          const parsed = parseBooleanToken(entry)
          return parsed === null ? entry : parsed
        })
      }
      if (typeof value !== 'string') return value
      const parsed = parseBooleanToken(value)
      return parsed === null ? value : parsed
    }
    const mapRow = (row: any) => {
      if (!isCustomEntity || !row || typeof row !== 'object') return row
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(row)) {
        if (k.startsWith('cf_')) out[k.replace(/^cf_/, '')] = normalizeCustomEntityValue(v)
        else out[k] = v
      }
      return out
    }
    const mapFullRow = (row: any) => {
      if (!row || typeof row !== 'object') return row
      return { ...(row as Record<string, unknown>) }
    }
    // Build filters with awareness of custom-entity mode
    const filtersObj: Where<any> = {}
    const buildFilter = (key: string, val: string, allowAnyKey: boolean) => {
      if (key.startsWith('cf_')) {
        if (key.endsWith('In')) {
          const base = key.slice(0, -2)
          const values = parseCommaSeparatedList(val)
          ;(filtersObj as any)[base] = { $in: values }
        } else {
          if (val.includes(',')) {
            const values = parseCommaSeparatedList(val)
            ;(filtersObj as any)[key] = { $in: values }
          } else {
            const parsed = parseBooleanToken(val)
            ;(filtersObj as any)[key] = parsed === null ? val : parsed
          }
        }
      } else if (allowAnyKey) {
        if (val.includes(',')) {
          const values = parseCommaSeparatedList(val)
          ;(filtersObj as any)[key] = { $in: values }
        } else {
          const parsed = parseBooleanToken(val)
          ;(filtersObj as any)[key] = parsed === null ? val : parsed
        }
      } else {
        if (['id', 'created_at', 'updated_at', 'deleted_at', 'name', 'title', 'email'].includes(key)) {
          ;(filtersObj as any)[key] = val
        }
      }
    }

    if (organizationIds && organizationIds.length) {
      (filtersObj as any).organization_id = { $in: organizationIds }
    }
    const qopts: QueryOptions = {
      tenantId: auth.tenantId!,
      includeCustomFields: true,
      page: { page, pageSize },
      sort: [{ field: sortField as any, dir: sortDir as any }] as Sort[],
      filters: filtersObj as any,
      withDeleted,
    }
    if (organizationIds && organizationIds.length) {
      qopts.organizationIds = organizationIds
    }
    // Allowed entities are doc-storage-backed by definition (system ids were rejected
    // above) — direct the engine to doc storage explicitly so reads stay deterministic
    // even before the first record exists.
    if (isCustomEntity) qopts.forceCustomEntityStorage = true
    for (const [k, v] of qpEntries) buildFilter(k, v, isCustomEntity)
    // Server-side full-result search: match the term against the requested fields
    // (defaults to `id`) before pagination so totals/exports stay consistent with
    // the active search instead of filtering only the current client page (#3229).
    if (searchTerm) {
      const fields = searchFields.length ? searchFields : ['id']
      const pattern = `%${searchTerm}%`
      const orClauses = fields.map((field) => ({ [field]: { $ilike: pattern } }))
      ;(filtersObj as any).$or = orClauses
    }
    const res = await qe.query(entityId as any, qopts)
    const rawItems = res.items || []
    const viewPageItems = rawItems.map(mapRow)
    const fullPageItems = rawItems.map(mapFullRow)

    // Expose `updated_at` on custom-entity records. The query engine returns only
    // the `doc` fields + `id`, dropping the base `updated_at` column — which made
    // optimistic locking impossible end-to-end (no version for the edit page to
    // round-trip as the lock header). Batch-read it from storage and merge it in.
    if (isCustomEntity && viewPageItems.length) {
      try {
        const recordIds = viewPageItems
          .map((it: any) => it?.id)
          .filter((v: any): v is string => typeof v === 'string' && v.length > 0)
        if (recordIds.length) {
          const db = em.getKysely()
          const rows = await db
            .selectFrom('custom_entities_storage' as any)
            .select(['entity_id' as any, 'updated_at' as any])
            .where('entity_type' as any, '=', entityId)
            .where('entity_id' as any, 'in', recordIds as any)
            .execute()
          const updatedById = new Map<string, string>()
          for (const row of rows as any[]) {
            const value = row?.updated_at
            const iso = value instanceof Date ? value.toISOString() : (typeof value === 'string' && value.length > 0 ? value : null)
            if (iso && row?.entity_id) updatedById.set(String(row.entity_id), iso)
          }
          for (const item of viewPageItems as any[]) {
            const iso = updatedById.get(String(item?.id))
            if (iso) {
              item.updated_at = iso
              item.updatedAt = iso
            }
          }
        }
      } catch { /* best-effort: locking simply will not engage if storage is unavailable */ }
    }

    const total = typeof res.total === 'number' ? res.total : rawItems.length
    const effectivePageSize = res.pageSize || pageSize
    const payload = {
      items: viewPageItems,
      total,
      page: res.page || page,
      pageSize: effectivePageSize,
      totalPages: Math.ceil(total / (effectivePageSize || 1)),
    }

    if (requestedExport) {
      let exportItems: any[] = exportFullRequested ? [...fullPageItems] : [...viewPageItems]
      if (total > exportItems.length) {
        let nextPage = 2
        while (exportItems.length < total) {
          const nextRes = await qe.query(entityId as any, {
            ...qopts,
            page: { page: nextPage, pageSize },
          })
          const nextRawItems = nextRes.items || []
          if (!nextRawItems.length) break
          const nextViewItems = nextRawItems.map(mapRow)
          const nextFullItems = nextRawItems.map(mapFullRow)
          const nextBatch = exportFullRequested ? nextFullItems : nextViewItems
          exportItems.push(...nextBatch)
          if (nextBatch.length < pageSize) break
          nextPage += 1
        }
      }
      const prepared = {
        columns: ensureColumns(exportItems),
        rows: exportItems,
      }
      const filenameBase = exportFullRequested ? `${entityId || 'records'}_full` : entityId || 'records'
      const serialized = serializeExport(prepared, requestedExport)
      const filename = defaultExportFilename(filenameBase, requestedExport)
      return new Response(serialized.body, {
        headers: {
          'content-type': serialized.contentType,
          'content-disposition': `attachment; filename="${filename}"`,
        },
      })
    }

    return NextResponse.json(payload)
  } catch (e) {
    if (isCrudHttpError(e)) return NextResponse.json(e.body, { status: e.status })
    logger.error('Records GET failed', { err: e })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

const postBodySchema = z.object({
  entityId: z.string().min(1),
  recordId: z.string().min(1).optional(),
  values: z.record(z.string(), z.any()).default({}),
})

const putBodySchema = z.object({
  entityId: z.string().min(1),
  recordId: z.string().min(1),
  values: z.record(z.string(), z.any()).default({}),
})

const mutationResponseSchema = z.object({
  ok: z.literal(true),
  item: z
    .object({
      entityId: z.string(),
      recordId: z.string(),
    })
    .optional(),
})

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth || !auth.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let json: unknown
  try { json = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const parsed = postBodySchema.safeParse(json)
  if (!parsed.success) return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })
  const { entityId } = parsed.data
  let { recordId, values } = parsed.data as { recordId?: string; values: Record<string, any> }

  try {
    const { resolve } = await createRequestContainer()
    const de = resolve('dataEngine') as any
    const em = resolve('em') as any
    const rbac = resolve('rbacService') as RbacService
    const scope = await resolveOrganizationScope({ em, rbac, auth, selectedId: getSelectedOrganizationFromRequest(req) })
    const targetOrgId = scope.selectedId ?? auth.orgId
    if (!targetOrgId) return NextResponse.json({ error: 'Organization context is required' }, { status: 400 })
    const { kind: entityKind, restricted: isRestricted } = await classifyRecordsEntity(em, entityId, { tenantId: auth.tenantId ?? null, organizationId: scope.selectedId ?? auth.orgId ?? null })
    if (entityKind === 'system') return systemEntityRecordsRejection(entityId)
    const isCustomEntity = entityKind === 'custom'
    await assertEntityAclForRequest({ auth, entityId, action: 'manage', isCustomEntity, isRestricted, rbac })
    // Strip reserved record/system columns the edit form echoes back from the loaded record
    // (`id`, plus `updated_at`/`updatedAt` used for optimistic locking). They are not custom
    // fields; without this they validate as cf_id / cf_updated_at / cf_updatedAt and are
    // rejected as "Unknown custom field", which fails EVERY custom-entity edit-form save.
    for (const reservedKey of ['id', 'created_at', 'createdAt', 'updated_at', 'updatedAt', 'deleted_at', 'deletedAt']) {
      delete (values as any)[reservedKey]
    }
    const norm = normalizeValues(values)

    // Validate against custom field definitions
    try {
      const { validateCustomFieldValuesServer } = await import('../lib/validation')
      const check = await validateCustomFieldValuesServer(em, { entityId, organizationId: targetOrgId, tenantId: auth.tenantId!, values: norm, rejectUndeclaredKeys: true })
      if (!check.ok) return NextResponse.json({ error: 'Validation failed', fields: check.fieldErrors }, { status: 400 })
    } catch { /* ignore if helper missing */ }

    const normalizedRecordId = (() => {
      const raw = String(recordId || '').trim()
      if (!raw) return undefined
      const low = raw.toLowerCase()
      if (low === 'create' || low === 'new' || low === 'null' || low === 'undefined') return undefined
      // Enforce UUID only; any non-uuid is ignored so we generate one in the DE
      const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      return uuid.test(raw) ? raw : undefined
    })()
    const { id } = await de.createCustomEntityRecord({
      entityId,
      recordId: normalizedRecordId,
      organizationId: targetOrgId,
      tenantId: auth.tenantId!,
      values: norm,
    })

    return NextResponse.json({ ok: true, item: { entityId, recordId: id } })
  } catch (e) {
    if (isCrudHttpError(e)) return NextResponse.json(e.body, { status: e.status })
    logger.error('Records POST failed', { err: e })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// Avoid zod here to prevent runtime import issues in some environments
function parsePutBody(json: any): { ok: true; data: { entityId: string; recordId: string; values: Record<string, any> } } | { ok: false; error: string } {
  if (!json || typeof json !== 'object') return { ok: false, error: 'Invalid JSON' }
  const entityId = typeof json.entityId === 'string' && json.entityId.length ? json.entityId : ''
  const recordId = typeof json.recordId === 'string' && json.recordId.length ? json.recordId : ''
  const values = (json.values && typeof json.values === 'object') ? json.values as Record<string, any> : {}
  if (!entityId || !recordId) return { ok: false, error: 'entityId and recordId are required' }
  return { ok: true, data: { entityId, recordId, values } }
}

export async function PUT(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth || !auth.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let json: any
  try { json = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const parsed = parsePutBody(json)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const { entityId, recordId, values } = parsed.data

  try {
    const container = await createRequestContainer()
    const { resolve } = container
    const de = resolve('dataEngine') as any
    const em = resolve('em') as any
    const rbac = resolve('rbacService') as RbacService
    const scope = await resolveOrganizationScope({ em, rbac, auth, selectedId: getSelectedOrganizationFromRequest(req) })
    const targetOrgId = scope.selectedId ?? auth.orgId
    if (!targetOrgId) return NextResponse.json({ error: 'Organization context is required' }, { status: 400 })
    const { kind: entityKind, restricted: isRestricted } = await classifyRecordsEntity(em, entityId, { tenantId: auth.tenantId ?? null, organizationId: scope.selectedId ?? auth.orgId ?? null })
    if (entityKind === 'system') return systemEntityRecordsRejection(entityId)
    const isCustomEntity = entityKind === 'custom'
    await assertEntityAclForRequest({ auth, entityId, action: 'manage', isCustomEntity, isRestricted, rbac })
    // Strip reserved record/system columns the edit form echoes back from the loaded record
    // (`id`, plus `updated_at`/`updatedAt` used for optimistic locking). They are not custom
    // fields; without this they validate as cf_id / cf_updated_at / cf_updatedAt and are
    // rejected as "Unknown custom field", which fails EVERY custom-entity edit-form save.
    for (const reservedKey of ['id', 'created_at', 'createdAt', 'updated_at', 'updatedAt', 'deleted_at', 'deletedAt']) {
      delete (values as any)[reservedKey]
    }
    const norm = normalizeValues(values)

    // Validate against custom field definitions
    try {
      const { validateCustomFieldValuesServer } = await import('../lib/validation')
      const check = await validateCustomFieldValuesServer(em, { entityId, organizationId: targetOrgId, tenantId: auth.tenantId!, values: norm, rejectUndeclaredKeys: true })
      if (!check.ok) return NextResponse.json({ error: 'Validation failed', fields: check.fieldErrors }, { status: 400 })
    } catch { /* ignore if helper missing */ }

    // Normalize recordId: if blank/sentinel/non-uuid => create instead of update
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    const rid = String(recordId || '').trim()
    const low = rid.toLowerCase()
    const isSentinel = !rid || low === 'create' || low === 'new' || low === 'null' || low === 'undefined'
    const isUuid = uuidRe.test(rid)
    if (isSentinel || !isUuid) {
      const created = await de.createCustomEntityRecord({
        entityId,
        recordId: undefined,
        organizationId: targetOrgId,
        tenantId: auth.tenantId!,
        values: norm,
      })
      return NextResponse.json({ ok: true, item: { entityId, recordId: created.id } })
    }

    try {
      const currentUpdatedAt = await readCustomEntityRecordUpdatedAt(em, {
        entityType: entityId,
        entityId: rid,
        organizationId: targetOrgId,
      })
      await enforceCommandOptimisticLockWithGuards(container, {
        resourceKind: CUSTOM_ENTITY_RECORD_RESOURCE_KIND,
        resourceId: rid,
        current: currentUpdatedAt,
        request: req,
      })
    } catch (lockError) {
      if (isCrudHttpError(lockError)) {
        return NextResponse.json(lockError.body, { status: lockError.status })
      }
      throw lockError
    }

    await de.updateCustomEntityRecord({
      entityId,
      recordId: rid,
      organizationId: targetOrgId,
      tenantId: auth.tenantId!,
      values: norm,
    })
    return NextResponse.json({ ok: true, item: { entityId, recordId: rid } })
  } catch (e) {
    if (isCrudHttpError(e)) return NextResponse.json(e.body, { status: e.status })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

const deleteBodySchema = z.object({
  entityId: z.string().min(1),
  recordId: z.string().min(1),
})

export async function DELETE(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth || !auth.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const qpEntityId = url.searchParams.get('entityId')
  const qpRecordId = url.searchParams.get('recordId')
  let payload: any = qpEntityId && qpRecordId ? { entityId: qpEntityId, recordId: qpRecordId } : null
  if (!payload) {
    try { payload = await req.json() } catch { payload = null }
  }
  const parsed = deleteBodySchema.safeParse(payload)
  if (!parsed.success) return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })
  const { entityId, recordId } = parsed.data

  try {
    const container = await createRequestContainer()
    const { resolve } = container
    const de = resolve('dataEngine') as any
    const em = resolve('em') as any
    const rbac = resolve('rbacService') as RbacService
    const scope = await resolveOrganizationScope({ em, rbac, auth, selectedId: getSelectedOrganizationFromRequest(req) })
    const targetOrgId = scope.selectedId ?? auth.orgId
    if (!targetOrgId) return NextResponse.json({ error: 'Organization context is required' }, { status: 400 })
    const { kind: entityKind, restricted: isRestricted } = await classifyRecordsEntity(em, entityId, { tenantId: auth.tenantId ?? null, organizationId: scope.selectedId ?? auth.orgId ?? null })
    if (entityKind === 'system') return systemEntityRecordsRejection(entityId)
    const isCustomEntity = entityKind === 'custom'
    await assertEntityAclForRequest({ auth, entityId, action: 'manage', isCustomEntity, isRestricted, rbac })

    try {
      const currentUpdatedAt = await readCustomEntityRecordUpdatedAt(em, {
        entityType: entityId,
        entityId: recordId,
        organizationId: targetOrgId,
      })
      await enforceCommandOptimisticLockWithGuards(container, {
        resourceKind: CUSTOM_ENTITY_RECORD_RESOURCE_KIND,
        resourceId: recordId,
        current: currentUpdatedAt,
        request: req,
      })
    } catch (lockError) {
      if (isCrudHttpError(lockError)) {
        return NextResponse.json(lockError.body, { status: lockError.status })
      }
      throw lockError
    }

    await de.deleteCustomEntityRecord({ entityId, recordId, organizationId: targetOrgId, tenantId: auth.tenantId!, soft: true })
    return NextResponse.json({ ok: true })
  } catch (e) {
    if (isCrudHttpError(e)) return NextResponse.json(e.body, { status: e.status })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

function normalizeValues(input: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {}
  for (const [k, v] of Object.entries(input || {})) {
    const key = k.startsWith('cf_') ? k.replace(/^cf_/, '') : k
    out[key] = v
  }
  return out
}

const deleteResponseSchema = z.object({
  ok: z.literal(true),
})

const errorSchema = z.object({
  error: z.string(),
}).passthrough()

export const openApi: OpenApiRouteDoc = {
  tag: 'Entities',
  summary: 'CRUD operations on entity records',
  methods: {
    GET: {
      summary: 'List records',
      description:
        'Returns paginated records for the supplied entity. Supports custom field filters, exports, and soft-delete toggles.',
      query: listRecordsQuerySchema,
      responses: [
        {
          status: 200,
          description: 'Paginated records',
          schema: listRecordsResponseSchema,
        },
        {
          status: 400,
          description: 'Missing entity id',
          schema: errorSchema,
        },
        {
          status: 401,
          description: 'Missing authentication',
          schema: errorSchema,
        },
        {
          status: 500,
          description: 'Unexpected failure',
          schema: errorSchema,
        },
      ],
    },
    POST: {
      summary: 'Create record',
      description:
        'Creates a record for the given entity. When `recordId` is omitted or not a UUID the data engine will generate one automatically.',
      requestBody: {
        contentType: 'application/json',
        schema: postBodySchema,
      },
      responses: [
        {
          status: 200,
          description: 'Record created',
          schema: mutationResponseSchema,
        },
        {
          status: 400,
          description: 'Validation failure',
          schema: errorSchema,
        },
        {
          status: 401,
          description: 'Missing authentication',
          schema: errorSchema,
        },
        {
          status: 500,
          description: 'Unexpected failure',
          schema: errorSchema,
        },
      ],
    },
    PUT: {
      summary: 'Update record',
      description:
        'Updates an existing record. If the provided recordId is not a UUID the record will be created instead to support optimistic flows.',
      requestBody: {
        contentType: 'application/json',
        schema: putBodySchema,
      },
      responses: [
        {
          status: 200,
          description: 'Record updated',
          schema: mutationResponseSchema,
        },
        {
          status: 400,
          description: 'Validation failure',
          schema: errorSchema,
        },
        {
          status: 401,
          description: 'Missing authentication',
          schema: errorSchema,
        },
        {
          status: 500,
          description: 'Unexpected failure',
          schema: errorSchema,
        },
      ],
    },
    DELETE: {
      summary: 'Delete record',
      description: 'Soft deletes the specified record within the current tenant/org scope.',
      requestBody: {
        contentType: 'application/json',
        schema: deleteBodySchema,
      },
      responses: [
        {
          status: 200,
          description: 'Record deleted',
          schema: deleteResponseSchema,
        },
        {
          status: 400,
          description: 'Missing entity id or record id',
          schema: errorSchema,
        },
        {
          status: 401,
          description: 'Missing authentication',
          schema: errorSchema,
        },
        {
          status: 404,
          description: 'Record not found',
          schema: errorSchema,
        },
        {
          status: 500,
          description: 'Unexpected failure',
          schema: errorSchema,
        },
      ],
    },
  },
}
