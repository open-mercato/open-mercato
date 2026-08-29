import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { isUniqueViolation } from '@open-mercato/shared/lib/crud/errors'
import {
  Site,
  SiteWarehouseRole,
  Warehouse,
  WarehouseLocation,
  WarehouseZone,
} from '../data/entities'

export type WmsDefaultTopologyScope = {
  tenantId: string
  organizationId: string
}

export async function seedWmsDefaultTopology(
  em: EntityManager,
  scope: WmsDefaultTopologyScope,
): Promise<boolean> {
  const existing = await Promise.all([
    findOneWithDecryption(em, Site, { ...scope, deletedAt: null }, undefined, scope),
    findOneWithDecryption(em, Warehouse, { ...scope, deletedAt: null }, undefined, scope),
    findOneWithDecryption(em, SiteWarehouseRole, { ...scope, deletedAt: null }, undefined, scope),
    findOneWithDecryption(em, WarehouseZone, { ...scope, deletedAt: null }, undefined, scope),
    findOneWithDecryption(em, WarehouseLocation, { ...scope, deletedAt: null }, undefined, scope),
  ])

  if (existing.some(Boolean)) return false

  const site = em.create(Site, {
    ...scope,
    code: 'MAIN',
    name: 'Main Site',
    isActive: true,
  })
  const warehouse = em.create(Warehouse, {
    ...scope,
    code: 'MAIN',
    name: 'Main Warehouse',
    isActive: true,
    isPrimary: true,
  })
  const role = em.create(SiteWarehouseRole, {
    ...scope,
    site,
    warehouse,
    role: 'finished_goods',
    isDefault: true,
  })

  em.persist(site)
  em.persist(warehouse)
  em.persist(role)
  try {
    await em.flush()
    return true
  } catch (error) {
    if (isUniqueViolation(error)) return false
    throw error
  }
}
