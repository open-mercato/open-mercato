import { NextResponse } from 'next/server'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import { CustomFieldDef } from '@open-mercato/core/modules/entities/data/entities'
import { upsertCustomFieldDefSchema } from '@open-mercato/core/modules/entities/data/validators'

export const metadata = {
  // Reading definitions is needed by record forms; keep it auth-protected but not admin-only
  GET: { requireAuth: true, requireFeatures: ['entities.definitions.view'] },
  // Mutations remain admin-only
  POST: { requireAuth: true, requireRoles: ['admin'], requireFeatures: ['entities.definitions.manage'] },
  DELETE: { requireAuth: true, requireRoles: ['admin'], requireFeatures: ['entities.definitions.manage'] },
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const entityId = url.searchParams.get('entityId') || ''
  if (!entityId) return NextResponse.json({ error: 'entityId is required' }, { status: 400 })

  const auth = getAuthFromRequest(req)
  if (!auth || !auth.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { resolve } = await createRequestContainer()
  const em = resolve('em') as any

  // Tenant-only scoping: allow global (null) or exact tenant match; do not scope by organization here
  const where = {
    entityId,
    deletedAt: null,
    $and: [
      { $or: [ { tenantId: auth.tenantId ?? undefined as any }, { tenantId: null } ] },
    ],
  } as any
  const defs = await em.find(CustomFieldDef, where as any)
  const tombstones = await em.find(CustomFieldDef, {
    entityId,
    deletedAt: { $ne: null } as any,
    $and: [
      { $or: [ { tenantId: auth.tenantId ?? undefined as any }, { tenantId: null } ] },
    ],
  } as any)
  const tombstonedKeys = new Set<string>((tombstones as any[]).map((d: any) => d.key))

  let entityDefaultEditor: string | undefined
  try {
    const ent = await em.findOne('@open-mercato/core/modules/entities/data/entities:CustomEntity' as any, {
      entityId,
      $and: [
        { $or: [ { tenantId: auth.tenantId ?? undefined as any }, { tenantId: null } ] },
      ],
    } as any)
    if (ent && typeof (ent as any).defaultEditor === 'string') entityDefaultEditor = (ent as any).defaultEditor
  } catch {}

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
    editor: typeof d.configJson?.editor === 'string'
      ? d.configJson.editor
      : (d.kind === 'multiline' ? entityDefaultEditor : undefined),
    input: typeof d.configJson?.input === 'string' ? d.configJson.input : undefined,
    priority: typeof d.configJson?.priority === 'number' ? d.configJson.priority : 0,
    validation: Array.isArray(d.configJson?.validation) ? d.configJson.validation : undefined,
    // attachments config passthrough
    maxAttachmentSizeMb: typeof d.configJson?.maxAttachmentSizeMb === 'number' ? d.configJson.maxAttachmentSizeMb : undefined,
    acceptExtensions: Array.isArray(d.configJson?.acceptExtensions) ? d.configJson.acceptExtensions : undefined,
  }))
  items.sort((a: any, b: any) => (a.priority ?? 0) - (b.priority ?? 0))

  return NextResponse.json({ items })
}

export async function POST(req: Request) {
  const auth = getAuthFromRequest(req)
  if (!auth || !auth.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const parsed = upsertCustomFieldDefSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })
  const input = parsed.data

  const { resolve } = await createRequestContainer()
  const em = resolve('em') as any

  const where: any = { entityId: input.entityId, key: input.key, organizationId: auth.orgId ?? null, tenantId: auth.tenantId ?? null }
  let def = await em.findOne(CustomFieldDef, where)
  if (!def) def = em.create(CustomFieldDef, { ...where, createdAt: new Date() })
  def.kind = input.kind
  const inCfg = (input as any).configJson ?? {}
  const cfg: Record<string, any> = { ...inCfg }
  if (cfg.label == null || String(cfg.label).trim() === '') cfg.label = input.key
  if (cfg.formEditable === undefined) cfg.formEditable = true
  if (cfg.listVisible === undefined) cfg.listVisible = true
  if (input.kind === 'multiline' && (cfg.editor == null || String(cfg.editor).trim() === '')) {
    cfg.editor = 'markdown'
  }
  def.configJson = cfg
  def.isActive = input.isActive ?? true
  def.updatedAt = new Date()
  em.persist(def)
  await em.flush()
  return NextResponse.json({ ok: true, item: { id: def.id, key: def.key, kind: def.kind, configJson: def.configJson, isActive: def.isActive } })
}

export async function DELETE(req: Request) {
  const auth = getAuthFromRequest(req)
  if (!auth || !auth.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const { entityId, key } = body || {}
  if (!entityId || !key) return NextResponse.json({ error: 'entityId and key are required' }, { status: 400 })

  const { resolve } = await createRequestContainer()
  const em = resolve('em') as any
  const where: any = { entityId, key, organizationId: auth.orgId ?? null, tenantId: auth.tenantId ?? null }
  const def = await em.findOne(CustomFieldDef, where)
  if (!def) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  def.isActive = false
  def.updatedAt = new Date()
  def.deletedAt = def.deletedAt ?? new Date()
  em.persist(def)
  await em.flush()
  return NextResponse.json({ ok: true })
}
