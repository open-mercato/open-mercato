import type { EntityManager } from '@mikro-orm/postgresql'
import { CustomEntity } from '../data/entities'

export type UpsertEntityOptions = {
  label: string
  description?: string | null
  organizationId?: string | null
  tenantId?: string | null
}

/**
 * Ensure a logical (virtual) entity exists in the DB. If present, updates label/description.
 * Use from module code (e.g., during CLI install/seed or module bootstrap).
 */
export async function upsertCustomEntity(em: EntityManager, entityId: string, opts: UpsertEntityOptions): Promise<void> {
  const where: any = { entityId, organizationId: opts.organizationId ?? null, tenantId: opts.tenantId ?? null }
  let ent = await em.findOne(CustomEntity as any, where)
  if (!ent) ent = em.create(CustomEntity as any, { ...where, createdAt: new Date() })
  ;(ent as any).label = opts.label
  ;(ent as any).description = opts.description ?? null
  ;(ent as any).isActive = true
  ;(ent as any).updatedAt = new Date()
  em.persist(ent)
  await em.flush()
}

