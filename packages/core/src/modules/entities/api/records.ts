import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import type { QueryEngine, Where, Sort } from '@open-mercato/shared/lib/query/types'
import { setRecordCustomFields } from '../lib/helpers'
import { CustomFieldValue } from '../data/entities'

export const metadata = {
  GET: { requireAuth: true, requireRoles: ['admin'] },
  POST: { requireAuth: true, requireRoles: ['admin'] },
  PUT: { requireAuth: true, requireRoles: ['admin'] },
  DELETE: { requireAuth: true, requireRoles: ['admin'] },
}

function parseBool(v: string | null, d = false) {
  if (v == null) return d
  const s = String(v).toLowerCase()
  return s === '1' || s === 'true' || s === 'yes'
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const entityId = url.searchParams.get('entityId') || ''
  if (!entityId) return NextResponse.json({ error: 'entityId is required' }, { status: 400 })

  const auth = getAuthFromRequest(req)
  if (!auth || !auth.orgId || !auth.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const format = (url.searchParams.get('format') || '').toLowerCase()
  const exportAll = parseBool(url.searchParams.get('all'), false)
  const page = exportAll ? 1 : Math.max(parseInt(url.searchParams.get('page') || '1', 10) || 1, 1)
  const pageSize = exportAll ? 100000 : Math.min(Math.max(parseInt(url.searchParams.get('pageSize') || '50', 10) || 50, 1), 100)
  const sortField = url.searchParams.get('sortField') || 'id'
  const sortDir = (url.searchParams.get('sortDir') || 'asc').toLowerCase() === 'desc' ? 'desc' : 'asc'
  const withDeleted = parseBool(url.searchParams.get('withDeleted'), false)

  const filtersObj: Where<any> = {}
  for (const [key, val] of url.searchParams.entries()) {
    if (key === 'entityId' || key === 'page' || key === 'pageSize' || key === 'sortField' || key === 'sortDir' || key === 'withDeleted' || key === 'format') continue
    if (key.startsWith('cf_')) {
      if (key.endsWith('In')) {
        const base = key.slice(0, -2)
        const values = val.split(',').map((s) => s.trim()).filter(Boolean)
        ;(filtersObj as any)[base] = { $in: values }
      } else {
        if (val.includes(',')) {
          const values = val.split(',').map((s) => s.trim()).filter(Boolean)
          ;(filtersObj as any)[key] = { $in: values }
        } else if (val === 'true' || val === 'false') {
          ;(filtersObj as any)[key] = (val === 'true')
        } else {
          ;(filtersObj as any)[key] = val
        }
      }
    } else {
      if (['id', 'created_at', 'updated_at', 'deleted_at', 'name', 'title', 'email'].includes(key)) {
        ;(filtersObj as any)[key] = val
      }
    }
  }

  try {
    const { resolve } = await createRequestContainer()
    const qe = resolve('queryEngine') as QueryEngine
    const res = await qe.query(entityId as any, {
      organizationId: auth.orgId!,
      tenantId: auth.tenantId!,
      includeCustomFields: true,
      page: { page, pageSize },
      sort: [{ field: sortField as any, dir: sortDir as any }] as Sort<any>[],
      filters: filtersObj,
      withDeleted,
    })

    const payload = {
      items: res.items || [],
      total: res.total || 0,
      page: res.page || page,
      pageSize: res.pageSize || pageSize,
      totalPages: Math.ceil((res.total || 0) / (res.pageSize || pageSize)),
    }

    if (format === 'csv') {
      const items = payload.items as any[]
      const headers = Array.from(new Set(items.flatMap((it) => Object.keys(it || {}))))
      const esc = (s: any) => {
        const str = Array.isArray(s) ? s.join('; ') : (s == null ? '' : String(s))
        return /[",\n\r]/.test(str) ? '"' + str.replace(/"/g, '""') + '"' : str
      }
      const lines = [headers.join(','), ...items.map((it) => headers.map((h) => esc((it as any)[h])).join(','))]
      return new Response(lines.join('\n'), {
        headers: {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': `attachment; filename="${(entityId || 'records').replace(/[^a-z0-9_\-]/gi, '_')}.csv"`,
        },
      })
    }

    if (format === 'json') {
      const body = JSON.stringify(payload.items || [])
      return new Response(body, {
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'content-disposition': `attachment; filename="${(entityId || 'records').replace(/[^a-z0-9_\-]/gi, '_')}.json"`,
        },
      })
    }

    if (format === 'xml') {
      const items = (payload.items || []) as any[]
      const escapeXml = (s: any) => String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;')
      const toXml = (obj: Record<string, any>) => {
        const parts: string[] = []
        for (const [k, v] of Object.entries(obj)) {
          const tag = k.replace(/[^a-zA-Z0-9_:-]/g, '_')
          if (Array.isArray(v)) {
            for (const vv of v) parts.push(`<${tag}>${escapeXml(vv)}</${tag}>`)
          } else if (v != null && typeof v === 'object') {
            parts.push(`<${tag}>${toXml(v)}</${tag}>`)
          } else {
            parts.push(`<${tag}>${escapeXml(v)}</${tag}>`)
          }
        }
        return parts.join('')
      }
      const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<records>${items.map((it) => `<record>${toXml(it || {})}</record>`).join('')}</records>`
      return new Response(xml, {
        headers: {
          'content-type': 'application/xml; charset=utf-8',
          'content-disposition': `attachment; filename="${(entityId || 'records').replace(/[^a-z0-9_\-]/gi, '_')}.xml"`,
        },
      })
    }

    return NextResponse.json(payload)
  } catch (e) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

const postBodySchema = z.object({
  entityId: z.string().min(1),
  recordId: z.string().min(1).optional(),
  values: z.record(z.string(), z.any()).default({}),
})

export async function POST(req: Request) {
  const auth = getAuthFromRequest(req)
  if (!auth || !auth.orgId || !auth.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let json: unknown
  try { json = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const parsed = postBodySchema.safeParse(json)
  if (!parsed.success) return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })
  const { entityId } = parsed.data
  let { recordId, values } = parsed.data as { recordId?: string; values: Record<string, any> }

  try {
    const { resolve } = await createRequestContainer()
    const em = resolve('em') as any

    const id = (!recordId || String(recordId).toLowerCase() === 'create') ? crypto.randomUUID() : recordId

    await setRecordCustomFields(em, {
      entityId,
      recordId: id!,
      organizationId: auth.orgId!,
      tenantId: auth.tenantId!,
      values: normalizeValues(values),
    })

    return NextResponse.json({ ok: true, item: { entityId, recordId: id } })
  } catch (e) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

const putBodySchema = z.object({
  entityId: z.string().min(1),
  recordId: z.string().min(1),
  values: z.record(z.any()).default({}),
})

export async function PUT(req: Request) {
  const auth = getAuthFromRequest(req)
  if (!auth || !auth.orgId || !auth.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let json: unknown
  try { json = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const parsed = putBodySchema.safeParse(json)
  if (!parsed.success) return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })
  const { entityId, recordId, values } = parsed.data

  try {
    const { resolve } = await createRequestContainer()
    const em = resolve('em') as any

    await setRecordCustomFields(em, {
      entityId,
      recordId,
      organizationId: auth.orgId!,
      tenantId: auth.tenantId!,
      values: normalizeValues(values),
    })

    return NextResponse.json({ ok: true, item: { entityId, recordId } })
  } catch (e) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

const deleteBodySchema = z.object({
  entityId: z.string().min(1),
  recordId: z.string().min(1),
})

export async function DELETE(req: Request) {
  const auth = getAuthFromRequest(req)
  if (!auth || !auth.orgId || !auth.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
    const em = resolve('em') as any

    const rows = await em.find(CustomFieldValue, {
      entityId,
      recordId,
      organizationId: auth.orgId!,
      tenantId: auth.tenantId!,
    })
    if (!rows.length) return NextResponse.json({ ok: true })
    const now = new Date()
    for (const r of rows) {
      r.deletedAt = r.deletedAt ?? now
    }
    await em.persistAndFlush(rows)

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


