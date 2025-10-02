import { NextResponse } from 'next/server'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import { CustomFieldDef, CustomEntity } from '@open-mercato/core/modules/custom_fields/data/entities'

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

  // Build safe $in arrays: always include null, add ids only when defined
  const orgIn: (string | null)[] = [null]
  if (auth.orgId) orgIn.push(auth.orgId)
  const tenantIn: (string | null)[] = [null]
  if (auth.tenantId) tenantIn.push(auth.tenantId)

  const where = {
    entityId,
    // Never include soft-deleted rows in candidates
    deletedAt: null,
    $and: [
      { $or: [ { organizationId: auth.orgId ?? undefined as any }, { organizationId: null } ] },
      { $or: [ { tenantId: auth.tenantId ?? undefined as any }, { tenantId: null } ] },
    ],
  } as any
  const defs = await em.find(CustomFieldDef, where as any)
  // Load tombstones to shadow lower-scope/global entries with the same key
  const tombstones = await em.find(CustomFieldDef, {
    entityId,
    deletedAt: { $ne: null } as any,
    $and: [
      { $or: [ { organizationId: auth.orgId ?? undefined as any }, { organizationId: null } ] },
      { $or: [ { tenantId: auth.tenantId ?? undefined as any }, { tenantId: null } ] },
    ],
  } as any)
  const tombstonedKeys = new Set<string>((tombstones as any[]).map((d: any) => d.key))

  // Resolve default editor preference for this entity (tenant/org scoped)
  let entityDefaultEditor: string | undefined
  try {
    const ent = await em.findOne(CustomEntity as any, {
      entityId,
      $and: [
        { $or: [ { organizationId: auth.orgId ?? undefined as any }, { organizationId: null } ] },
        { $or: [ { tenantId: auth.tenantId ?? undefined as any }, { tenantId: null } ] },
      ],
    } as any)
    if (ent && typeof (ent as any).defaultEditor === 'string') entityDefaultEditor = (ent as any).defaultEditor
  } catch {}

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

  // Exclude keys whose winning definition is not active, and those shadowed by a tombstone
  const winning = Array.from(byKey.values()).filter((d: any) => (d.isActive !== false) && !tombstonedKeys.has(d.key))
  let items = winning.map((d) => ({
    key: d.key,
    kind: d.kind,
    label: d.configJson?.label || d.key,
    description: d.configJson?.description || undefined,
    multi: Boolean(d.configJson?.multi),
    options: Array.isArray(d.configJson?.options) ? d.configJson.options : undefined,
    optionsUrl: typeof d.configJson?.optionsUrl === 'string' ? d.configJson.optionsUrl : undefined,
    filterable: Boolean(d.configJson?.filterable),
    formEditable: d.configJson?.formEditable !== undefined ? Boolean(d.configJson.formEditable) : true,
    listVisible: d.configJson?.listVisible !== undefined ? Boolean(d.configJson.listVisible) : true,
    // Optional UI hints for client renderers; fallback to entity default for multiline
    editor: typeof d.configJson?.editor === 'string'
      ? d.configJson.editor
      : (d.kind === 'multiline' ? entityDefaultEditor : undefined),
    input: typeof d.configJson?.input === 'string' ? d.configJson.input : undefined,
    priority: typeof d.configJson?.priority === 'number' ? d.configJson.priority : 0,
  }))
  // Sort by priority ascending to provide deterministic ordering for clients
  items.sort((a: any, b: any) => (a.priority ?? 0) - (b.priority ?? 0))

  return NextResponse.json({ items })
}
