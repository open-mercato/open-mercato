import type { EntityManager } from '@mikro-orm/postgresql'
import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { ensureRoles } from '@open-mercato/core/modules/auth/lib/setup-app'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { FeatureToggle } from '@open-mercato/core/modules/feature_toggles/data/entities'
import {
  WMS_CUSTOM_ROLE_NAMES,
  WMS_OPERATOR_FEATURES,
  WMS_OPERATOR_ROLE,
  WMS_SUPERVISOR_FEATURES,
  WMS_SUPERVISOR_ROLE,
} from './lib/roleFeatures'

const wmsIntegrationToggles = [
  {
    identifier: 'wms_integration_sales_order_inventory',
    name: 'Sales Order Inventory Reservation',
    description: 'Allows WMS to reserve and release inventory from sales order lifecycle events.',
    category: 'wms',
    type: 'boolean' as const,
    defaultValue: true,
  },
  {
    identifier: 'wms_integration_shipping_shipments',
    name: 'Shipping Shipment Coordination',
    description: 'Allows WMS to react to shipping shipment lifecycle events when shipment orchestration is enabled.',
    category: 'wms',
    type: 'boolean' as const,
    defaultValue: true,
  },
  {
    identifier: 'wms_integration_procurement_goods_receipt',
    name: 'Procurement Goods Receipt Bridge',
    description: 'Reserved toggle for future procurement-driven receiving integration.',
    category: 'wms',
    type: 'boolean' as const,
    defaultValue: false,
  },
] as const

async function seedWmsFeatureToggles(em: EntityManager): Promise<void> {
  for (const toggle of wmsIntegrationToggles) {
    const existing = await findOneWithDecryption(em, FeatureToggle, {
      identifier: toggle.identifier,
      deletedAt: null,
    })
    if (existing) continue
    em.persist(
      em.create(FeatureToggle, {
        identifier: toggle.identifier,
        name: toggle.name,
        description: toggle.description,
        category: toggle.category,
        type: toggle.type,
        defaultValue: toggle.defaultValue,
      })
    )
  }
  await em.flush()
}

async function seedWmsRoles(em: EntityManager, tenantId: string): Promise<void> {
  await ensureRoles(em, { tenantId, roleNames: [...WMS_CUSTOM_ROLE_NAMES] })
}

export const setup: ModuleSetupConfig = {
  seedDefaults: async (ctx) => {
    await seedWmsFeatureToggles(ctx.em)
    await seedWmsRoles(ctx.em, ctx.tenantId)
  },
  defaultRoleFeatures: {
    admin: ['wms.*'],
    employee: ['wms.view'],
    [WMS_OPERATOR_ROLE]: [...WMS_OPERATOR_FEATURES],
    [WMS_SUPERVISOR_ROLE]: [...WMS_SUPERVISOR_FEATURES],
  },
}

export default setup
