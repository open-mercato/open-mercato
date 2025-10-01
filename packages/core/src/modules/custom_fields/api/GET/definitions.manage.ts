import { NextResponse } from 'next/server'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import { CustomFieldDef } from '@open-mercato/core/modules/custom_fields/data/entities'

export const metadata = {
  GET: { requireAuth: true, requireRoles: ['admin'] },
}

export default async function handler(req: Request) {
  const url = new URL(req.url)
  const entityId = url.searchParams.get('entityId') || ''
  if (!entityId) return NextResponse.json({ error: 'entityId is required' }, { status: 400 })
  const auth = getAuthFromRequest(req)
  if (!auth || !auth.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { resolve } = await createRequestContainer()
  const em = resolve('em') as any
  const defs = await em.find(CustomFieldDef, {
    entityId,
    $and: [
      { $or: [ { organizationId: auth.orgId ?? undefined as any }, { organizationId: null } ] },
      { $or: [ { tenantId: auth.tenantId ?? undefined as any }, { tenantId: null } ] },
    ],
  }, { orderBy: { key: 'asc' } as any })

  // Deduplicate by key, keeping the last defined (most recently updated)
  const byKey = new Map<string, any>()
  const ts = (x: any) => {
    const u = (x?.updatedAt instanceof Date) ? x.updatedAt.getTime() : (x?.updatedAt ? new Date(x.updatedAt).getTime() : 0)
    if (u) return u
    const c = (x?.createdAt instanceof Date) ? x.createdAt.getTime() : (x?.createdAt ? new Date(x.createdAt).getTime() : 0)
    return c
  }
  const scopeScore = (x: any) => (x?.tenantId ? 2 : 0) + (x?.organizationId ? 1 : 0)
  for (const d of defs) {
    const existing = byKey.get(d.key)
    if (!existing) { byKey.set(d.key, d); continue }
    const tNew = ts(d)
    const tOld = ts(existing)
    if (tNew > tOld) { byKey.set(d.key, d); continue }
    if (tNew < tOld) continue
    // tie-breaker on scope when timestamps equal
    if (scopeScore(d) >= scopeScore(existing)) byKey.set(d.key, d)
  }
  const items = Array.from(byKey.values()).map((d: any) => ({
    id: d.id,
    key: d.key,
    kind: d.kind,
    configJson: d.configJson,
    isActive: d.isActive,
    organizationId: d.organizationId ?? null,
    tenantId: d.tenantId ?? null,
  }))
  return NextResponse.json({ items })
}
