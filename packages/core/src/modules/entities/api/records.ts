import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import type { QueryEngine, QueryOptions, Where, Sort } from '@open-mercato/shared/lib/query/types'
import { normalizeExportFormat, serializeExport, defaultExportFilename, ensureColumns } from '@open-mercato/shared/lib/crud/exporters'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { resolveOrganizationScope, getSelectedOrganizationFromRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { parseBooleanToken, parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
import { setRecordCustomFields } from '../lib/helpers'
import { CustomFieldValue } from '../data/entities'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['entities.records.view'] },
  POST: { requireAuth: true, requireFeatures: ['entities.records.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['entities.records.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['entities.records.manage'] },
}

function parseBool(v: string | null, d = false) {
  return parseBooleanWithDefault(v ?? undefined, d)
}

const DEFAULT_EXPORT_PAGE_SIZE = 1000

const listRecordsQuerySchema = z
  .object({
    entityId: z.string().min(1),
    page: z.coerce.number().int().min(1).optional(),
    pageSize: z.coerce.number().int().min(1).max(100).optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
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
  const exportFullRequested = requestedExport != null && (exportScopeRaw === 'full' || parseBool(url.searchParams.get('full'), false))
  const exportAll = parseBool(url.searchParams.get('all'), false)
  const noPagination = exportAll || requestedExport != null
  const page = noPagination ? 1 : Math.max(parseInt(url.searchParams.get('page') || '1', 10) || 1, 1)
  const basePageSize = Math.min(Math.max(parseInt(url.searchParams.get('pageSize') || '50', 10) || 50, 1), 100)
  const pageSize = noPagination ? Math.max(basePageSize, DEFAULT_EXPORT_PAGE_SIZE) : basePageSize
  const sortField = url.searchParams.get('sortField') || 'id'
  const sortDir = (url.searchParams.get('sortDir') || 'asc').toLowerCase() === 'desc' ? 'desc' : 'asc'
  const withDeleted = parseBool(url.searchParams.get('withDeleted'), false)

  const qpEntries: Array<[string, string]> = []
  for (const [key, val] of url.searchParams.entries()) {
    if (['entityId','page','pageSize','sortField','sortDir','withDeleted','format','exportScope','export_scope','all','full'].includes(key)) continue
    qpEntries.push([key, val])
  }

  try {
    const { resolve } = await createRequestContainer()
    const qe = resolve('queryEngine') as QueryEngine
    const em = resolve('em') as any
    const rbac = resolve('rbacService') as RbacService
    const scope = await resolveOrganizationScope({ em, rbac, auth, selectedId: getSelectedOrganizationFromRequest(req) })
    let organizationIds: string[] | null = scope.filterIds
    let isCustomEntity = false
    try {
      const { CustomEntity } = await import('../data/entities')
      const found = await em.findOne(CustomEntity as any, { entityId, isActive: true })
      isCustomEntity = !!found
    } catch {}
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
          const values = val.split(',').map((s) => s.trim()).filter(Boolean)
          ;(filtersObj as any)[base] = { $in: values }
        } else {
          if (val.includes(',')) {
            const values = val.split(',').map((s) => s.trim()).filter(Boolean)
            ;(filtersObj as any)[key] = { $in: values }
          } else {
            const parsed = parseBooleanToken(val)
            ;(filtersObj as any)[key] = parsed === null ? val : parsed
          }
        }
      } else if (allowAnyKey) {
        if (val.includes(',')) {
          const values = val.split(',').map((s) => s.trim()).filter(Boolean)
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
    for (const [k, v] of qpEntries) buildFilter(k, v, isCustomEntity)
    const res = await qe.query(entityId as any, qopts)
    const rawItems = res.items || []
    const viewPageItems = rawItems.map(mapRow)
    const fullPageItems = rawItems.map(mapFullRow)
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
    try { console.error('[entities.records.GET] Error', e) } catch {}
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
    const norm = normalizeValues(values)

    // Validate against custom field definitions
    try {
      const { validateCustomFieldValuesServer } = await import('../lib/validation')
      const check = await validateCustomFieldValuesServer(em, { entityId, organizationId: targetOrgId, tenantId: auth.tenantId!, values: norm })
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
    try { console.error('[entities.records.POST] Error', e) } catch {}
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
    const { resolve } = await createRequestContainer()
    const de = resolve('dataEngine') as any
    const em = resolve('em') as any
    const rbac = resolve('rbacService') as RbacService
    const scope = await resolveOrganizationScope({ em, rbac, auth, selectedId: getSelectedOrganizationFromRequest(req) })
    const targetOrgId = scope.selectedId ?? auth.orgId
    if (!targetOrgId) return NextResponse.json({ error: 'Organization context is required' }, { status: 400 })
    const norm = normalizeValues(values)


    // Validate against custom field definitions
    try {
      const { validateCustomFieldValuesServer } = await import('../lib/validation')
      const check = await validateCustomFieldValuesServer(em, { entityId, organizationId: targetOrgId, tenantId: auth.tenantId!, values: norm })
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

    await de.updateCustomEntityRecord({
      entityId,
      recordId: rid,
      organizationId: targetOrgId,
      tenantId: auth.tenantId!,
      values: norm,
    })
    return NextResponse.json({ ok: true, item: { entityId, recordId: rid } })
  } catch (e) {
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
    const { resolve } = await createRequestContainer()
    const de = resolve('dataEngine') as any
    const em = resolve('em') as any
    const rbac = resolve('rbacService') as RbacService
    const scope = await resolveOrganizationScope({ em, rbac, auth, selectedId: getSelectedOrganizationFromRequest(req) })
    const targetOrgId = scope.selectedId ?? auth.orgId
    if (!targetOrgId) return NextResponse.json({ error: 'Organization context is required' }, { status: 400 })
    await de.deleteCustomEntityRecord({ entityId, recordId, organizationId: targetOrgId, tenantId: auth.tenantId!, soft: true })
    return NextResponse.json({ ok: true })
  } catch (e) {
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
