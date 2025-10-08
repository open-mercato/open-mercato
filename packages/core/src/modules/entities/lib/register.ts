import type { EntityManager } from '@mikro-orm/postgresql'
import { CustomEntity } from '../data/entities'

export type UpsertEntityOptions = {
  label: string
  description?: string | null
  organizationId?: string | null
  tenantId?: string | null
  showInSidebar?: boolean
}

/**
 * Ensure a logical (virtual) entity exists in the DB. If present, updates label/description.
 * Use from module code (e.g., during CLI install/seed or module bootstrap).
 * 
 * This function handles race conditions by retrying if a unique constraint violation occurs.
 */
export async function upsertCustomEntity(em: EntityManager, entityId: string, opts: UpsertEntityOptions): Promise<void> {
  const where: any = { entityId, organizationId: opts.organizationId ?? null, tenantId: opts.tenantId ?? null }
  
  // Use a transaction to ensure atomic operations
  await em.transactional(async (tem) => {
    try {
      let ent = await tem.findOne(CustomEntity as any, where)
      if (!ent) {
        ent = tem.create(CustomEntity as any, { ...where, createdAt: new Date() })
      }
      ;(ent as any).label = opts.label
      ;(ent as any).description = opts.description ?? null
      ;(ent as any).isActive = true
      if (typeof opts.showInSidebar === 'boolean') {
        ;(ent as any).showInSidebar = !!opts.showInSidebar
      }
      ;(ent as any).updatedAt = new Date()
      tem.persist(ent)
      await tem.flush()
    } catch (error: any) {
      // If unique constraint violation, try to update the existing record
      if (error?.code === '23505' || error?.message?.includes('duplicate key')) {
        // Re-fetch and update
        const ent = await tem.findOne(CustomEntity as any, where)
        if (ent) {
          ;(ent as any).label = opts.label
          ;(ent as any).description = opts.description ?? null
          ;(ent as any).isActive = true
          if (typeof opts.showInSidebar === 'boolean') {
            ;(ent as any).showInSidebar = !!opts.showInSidebar
          }
          ;(ent as any).updatedAt = new Date()
          await tem.flush()
        }
      } else {
        throw error
      }
    }
  })
}

