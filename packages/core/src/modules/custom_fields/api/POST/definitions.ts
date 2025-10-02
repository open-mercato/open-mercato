import { NextResponse } from 'next/server'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import { CustomFieldDef } from '@open-mercato/core/modules/custom_fields/data/entities'
import { upsertCustomFieldDefSchema } from '@open-mercato/core/modules/custom_fields/data/validators'

export const metadata = {
  POST: { requireAuth: true, requireRoles: ['admin'] },
}

export default async function handler(req: Request) {
  const auth = getAuthFromRequest(req)
  if (!auth || !auth.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const parsed = upsertCustomFieldDefSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })
  const input = parsed.data

  const { resolve } = await createRequestContainer()
  const em = resolve('em') as any

  // Upsert by entityId + org/tenant + key (simple, no implicit undelete logic)
  const where: any = { entityId: input.entityId, key: input.key, organizationId: auth.orgId ?? null, tenantId: auth.tenantId ?? null }
  let def = await em.findOne(CustomFieldDef, where)
  if (!def) def = em.create(CustomFieldDef, { ...where, createdAt: new Date() })
  def.kind = input.kind
  // Merge sensible defaults for newly created definitions
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
