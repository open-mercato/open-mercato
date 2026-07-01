import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { FeatureToggle } from '@open-mercato/core/modules/feature_toggles/data/entities'
import type { FeatureTogglesService } from '@open-mercato/core/modules/feature_toggles/lib/feature-flag-check'

export const WMS_INTEGRATION_TOGGLES = [
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

export type WmsIntegrationToggleIdentifier = (typeof WMS_INTEGRATION_TOGGLES)[number]['identifier']

export function findWmsIntegrationToggleDefinition(identifier: string) {
  return WMS_INTEGRATION_TOGGLES.find((toggle) => toggle.identifier === identifier) ?? null
}

export async function seedWmsIntegrationToggles(em: EntityManager): Promise<void> {
  for (const toggle of WMS_INTEGRATION_TOGGLES) {
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
      }),
    )
  }
  await em.flush()
}

export async function resolveWmsIntegrationToggleEnabled(
  featureTogglesService: FeatureTogglesService,
  em: EntityManager,
  identifier: WmsIntegrationToggleIdentifier,
  tenantId: string,
): Promise<boolean> {
  const definition = findWmsIntegrationToggleDefinition(identifier)
  const fallback = definition?.defaultValue ?? true

  const result = await featureTogglesService.getBoolConfig(identifier, tenantId)
  if (result.ok) return result.value

  if (result.error?.code !== 'MISSING_TOGGLE' || !definition) {
    return fallback
  }

  await seedWmsIntegrationToggles(em)
  await featureTogglesService.invalidateIsEnabledCacheByKey(identifier, tenantId)

  const retried = await featureTogglesService.getBoolConfig(identifier, tenantId)
  return retried.ok ? retried.value : fallback
}
