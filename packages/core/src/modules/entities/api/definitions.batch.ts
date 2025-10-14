import { NextResponse } from 'next/server'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import { CustomFieldDef } from '@open-mercato/core/modules/entities/data/entities'
import { upsertCustomFieldDefSchema } from '@open-mercato/core/modules/entities/data/validators'
import { z } from 'zod'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['entities.definitions.manage'] },
}

const batchSchema = z.object({
  entityId: z.string().regex(/^[a-z0-9_]+:[a-z0-9_]+$/),
  definitions: z.array(
    upsertCustomFieldDefSchema
      .omit({ entityId: true })
      .extend({
        configJson: z.any().optional(),
      })
  ),
})

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth || !auth.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const parsed = batchSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })
  const { entityId, definitions } = parsed.data

  const { resolve } = await createRequestContainer()
  const em = resolve('em') as any

  await em.begin()
  try {
    for (const [idx, d] of definitions.entries()) {
      const where: any = {
        entityId,
        key: d.key,
        organizationId: auth.orgId ?? null,
        tenantId: auth.tenantId ?? null,
      }
      let def = await em.findOne(CustomFieldDef, where)
      if (!def) def = em.create(CustomFieldDef, { ...where, createdAt: new Date() })
      def.kind = d.kind

      const inCfg = (d as any).configJson ?? {}
      const cfg: Record<string, any> = { ...inCfg }
      if (cfg.label == null || String(cfg.label).trim() === '') cfg.label = d.key
      if (cfg.formEditable === undefined) cfg.formEditable = true
      if (cfg.listVisible === undefined) cfg.listVisible = true
      if (d.kind === 'multiline' && (cfg.editor == null || String(cfg.editor).trim() === '')) cfg.editor = 'markdown'
      cfg.priority = idx

      def.configJson = cfg
      def.isActive = d.isActive ?? true
      def.updatedAt = new Date()
      em.persist(def)
    }
    await em.flush()
    await em.commit()
  } catch (e) {
    try { await em.rollback() } catch {}
    return NextResponse.json({ error: 'Failed to save definitions batch' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

