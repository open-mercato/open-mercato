import { NextResponse } from 'next/server'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import type { QueryEngine, Where, Sort } from '@open-mercato/shared/lib/query/types'

export const metadata = {
  GET: { requireAuth: true, requireRoles: ['admin'] },
}

function parseBool(v: string | null, d = false) {
  if (v == null) return d
  const s = String(v).toLowerCase()
  return s === '1' || s === 'true' || s === 'yes'
}

export default async function handler(req: Request) {
  const url = new URL(req.url)
  const entityId = url.searchParams.get('entityId') || ''
  if (!entityId) return NextResponse.json({ error: 'entityId is required' }, { status: 400 })

  const auth = getAuthFromRequest(req)
  if (!auth || !auth.orgId || !auth.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const page = Math.max(parseInt(url.searchParams.get('page') || '1', 10) || 1, 1)
  const pageSize = Math.min(Math.max(parseInt(url.searchParams.get('pageSize') || '50', 10) || 50, 1), 100)
  const sortField = url.searchParams.get('sortField') || 'id'
  const sortDir = (url.searchParams.get('sortDir') || 'asc').toLowerCase() === 'desc' ? 'desc' : 'asc'
  const withDeleted = parseBool(url.searchParams.get('withDeleted'), false)

  // Build filters: accept cf_* params and forward base field params verbatim where reasonable
  const filtersObj: Where<any> = {}
  for (const [key, val] of url.searchParams.entries()) {
    if (key === 'entityId' || key === 'page' || key === 'pageSize' || key === 'sortField' || key === 'sortDir' || key === 'withDeleted' || key === 'format') continue
    if (key.startsWith('cf_')) {
      // cf_keyIn => $in; cf_key => $eq (or array -> $in)
      if (key.endsWith('In')) {
        const base = key.slice(0, -2) // remove 'In'
        const values = val.split(',').map((s) => s.trim()).filter(Boolean)
        ;(filtersObj as any)[base] = { $in: values }
      } else {
        // allow comma-separated to be treated as $in
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
      // Opportunistically forward some base field filters (eq only)
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
      // Select all base columns; include all custom fields
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

    // CSV export when requested
    if ((url.searchParams.get('format') || '').toLowerCase() === 'csv') {
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

    return NextResponse.json(payload)
  } catch (e) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

