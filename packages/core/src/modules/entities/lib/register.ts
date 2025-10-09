import type { EntityManager } from '@mikro-orm/postgresql'
import { CustomEntity } from '../data/entities'

export type UpsertEntityOptions = {
  label: string
  description?: string | null
  organizationId?: string | null
  tenantId?: string | null
  showInSidebar?: boolean
  labelField?: string | null
  defaultEditor?: string | null
  isActive?: boolean
  dryRun?: boolean
}

export type UpsertCustomEntityResult = 'created' | 'updated' | 'unchanged'

/**
 * Ensure a logical (virtual) entity exists in the DB. If present, updates label/description.
 * Use from module code (e.g., during CLI install/seed or module bootstrap).
 * 
 * This function handles race conditions by retrying if a unique constraint violation occurs.
 */
export async function upsertCustomEntity(em: EntityManager, entityId: string, opts: UpsertEntityOptions): Promise<UpsertCustomEntityResult> {
  const where: any = { entityId, organizationId: opts.organizationId ?? null, tenantId: opts.tenantId ?? null }
  const desired = {
    label: opts.label,
    description: opts.description ?? null,
    isActive: opts.isActive ?? true,
    showInSidebar: !!opts.showInSidebar,
    labelField: opts.labelField ?? null,
    defaultEditor: opts.defaultEditor ?? null,
  }
  const dryRun = opts.dryRun === true

  const apply = (ent: any) => {
    ent.label = desired.label
    ent.description = desired.description
    ent.isActive = desired.isActive
    ent.showInSidebar = desired.showInSidebar
    ent.labelField = desired.labelField
    ent.defaultEditor = desired.defaultEditor
    ent.updatedAt = new Date()
    if (ent.deletedAt) ent.deletedAt = null
  }

  const isDifferent = (ent: any) => {
    if (ent.label !== desired.label) return true
    if ((ent.description ?? null) !== desired.description) return true
    if ((ent.isActive ?? true) !== desired.isActive) return true
    if ((ent.showInSidebar ?? false) !== desired.showInSidebar) return true
    if ((ent.labelField ?? null) !== desired.labelField) return true
    if ((ent.defaultEditor ?? null) !== desired.defaultEditor) return true
    if (ent.deletedAt != null) return true
    return false
  }

  return em.transactional(async (tem) => {
    const now = new Date()
    try {
      let ent = await tem.findOne(CustomEntity as any, where)
      if (!ent) {
        if (dryRun) return 'created'
        ent = tem.create(CustomEntity as any, { ...where, ...desired, createdAt: now, updatedAt: now, deletedAt: null })
        await tem.persistAndFlush(ent)
        return 'created' as UpsertCustomEntityResult
      }
      if (!isDifferent(ent)) return 'unchanged'
      if (dryRun) return 'updated'
      apply(ent)
      await tem.flush()
      return 'updated' as UpsertCustomEntityResult
    } catch (error: any) {
      if (error?.code === '23505' || error?.message?.includes('duplicate key')) {
        const ent = await tem.findOne(CustomEntity as any, where)
        if (!ent) throw error
        if (!isDifferent(ent)) return 'unchanged'
        if (dryRun) return 'updated'
        apply(ent)
        await tem.flush()
        return 'updated'
      }
      throw error
    }
  })
}
