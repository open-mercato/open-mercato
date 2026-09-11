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
  try {
    return await em.transactional(async (transaction) => {
      const existing = await Promise.all([
        findOneWithDecryption(transaction, Site, { ...scope, deletedAt: null }, undefined, scope),
        findOneWithDecryption(transaction, Warehouse, { ...scope, deletedAt: null }, undefined, scope),
        findOneWithDecryption(transaction, SiteWarehouseRole, { ...scope, deletedAt: null }, undefined, scope),
        findOneWithDecryption(transaction, WarehouseZone, { ...scope, deletedAt: null }, undefined, scope),
        findOneWithDecryption(transaction, WarehouseLocation, { ...scope, deletedAt: null }, undefined, scope),
      ])

      if (existing.some(Boolean)) return false

      const site = transaction.create(Site, {
        ...scope,
        code: 'MAIN',
        name: 'Main Site',
        isActive: true,
      })
      const warehouse = transaction.create(Warehouse, {
        ...scope,
        code: 'MAIN',
        name: 'Main Warehouse',
        isActive: true,
        isPrimary: true,
      })
      const role = transaction.create(SiteWarehouseRole, {
        ...scope,
        site,
        warehouse,
        role: 'finished_goods',
        isDefault: true,
      })

      transaction.persist(site)
      transaction.persist(warehouse)
      transaction.persist(role)
      await transaction.flush()
      return true
    })
  } catch (error) {
    if (isUniqueViolation(error)) return false
    throw error
  }
}
