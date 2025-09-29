import { getAuthFromCookies } from '@/lib/auth/server'
import { createRequestContainer } from '@/lib/di/container'
import { CustomFieldValue } from '@open-mercato/core/modules/custom_fields/data/entities'

export const metadata = {
  GET: { requireAuth: true, requireRoles: ['admin', 'superuser'] },
}

export async function GET(request: Request) {
  try {
    const auth = await getAuthFromCookies()
    if (!auth?.orgId) {
      return new Response(JSON.stringify({ items: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    const { resolve } = await createRequestContainer()
    const em = resolve('em') as any
    const rows = await em.find(CustomFieldValue, {
      entityId: 'example:todo',
      fieldKey: 'labels',
      $or: [ { organizationId: auth.orgId as any }, { organizationId: null } ],
    })
    const set = new Set<string>()
    for (const r of rows) {
      const raw = (r as any).valueText || (r as any).valueMultiline || ''
      const s = String(raw || '').trim()
      if (!s) continue
      set.add(s)
    }
    const items = Array.from(set).map((t) => ({ value: t, label: t }))
    return new Response(JSON.stringify({ items }), { headers: { 'content-type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ items: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
}
