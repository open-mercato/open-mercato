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
    organizationId: { $in: [auth.orgId, null] as any },
    tenantId: { $in: [auth.tenantId, null] as any },
    isActive: true,
  })

  // Choose best definition per key with clear tie-breakers:
  // 1) Scope specificity: tenant > org > global
  // 2) Latest updatedAt wins within same scope
  const scopeScore = (x: any) => (x.tenantId ? 2 : 0) + (x.organizationId ? 1 : 0)
  const byKey = new Map<string, any>()
  for (const d of defs) {
    const existing = byKey.get(d.key)
    if (!existing) { byKey.set(d.key, d); continue }
    const sNew = scopeScore(d)
    const sOld = scopeScore(existing)
    if (sNew > sOld) { byKey.set(d.key, d); continue }
    if (sNew < sOld) continue
    const tNew = (d.updatedAt instanceof Date) ? d.updatedAt.getTime() : new Date(d.updatedAt).getTime()
    const tOld = (existing.updatedAt instanceof Date) ? existing.updatedAt.getTime() : new Date(existing.updatedAt).getTime()
    if (tNew >= tOld) byKey.set(d.key, d)
  }

  const items = Array.from(byKey.values()).map((d) => ({
    key: d.key,
    kind: d.kind,
    label: d.configJson?.label || d.key,
    description: d.configJson?.description || undefined,
    multi: Boolean(d.configJson?.multi),
    options: Array.isArray(d.configJson?.options) ? d.configJson.options : undefined,
    filterable: Boolean(d.configJson?.filterable),
    formEditable: d.configJson?.formEditable !== undefined ? Boolean(d.configJson.formEditable) : true,
    // Optional UI hints for client renderers
    editor: typeof d.configJson?.editor === 'string' ? d.configJson.editor : undefined,
    input: typeof d.configJson?.input === 'string' ? d.configJson.input : undefined,
  }))

  return NextResponse.json({ items })
}
