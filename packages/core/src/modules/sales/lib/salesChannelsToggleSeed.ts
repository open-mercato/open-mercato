import type { EntityManager } from '@mikro-orm/postgresql'
import { FeatureToggle } from '@open-mercato/core/modules/feature_toggles/data/entities'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { SALES_CHANNELS_TOGGLE_ID } from './salesChannelsToggleId'

export const SALES_CHANNELS_TOGGLE_DEFINITION = {
  identifier: SALES_CHANNELS_TOGGLE_ID,
  name: 'Sales Channels',
  description: 'Show sales channel pickers, filters, and management UI. Disable for tenants that do not use sales channels.',
  category: 'sales',
  type: 'boolean' as const,
  defaultValue: true,
} as const

// The sales module owns this toggle definition, so tenant setup registers it the
// same way portal, customers and wms register theirs. Shipping it only in the
// core defaults file left it unregistered on every database initialized before
// the toggle existed, and `useSalesChannelsEnabled` then 404s on every mount.
export async function seedSalesChannelsToggle(em: EntityManager): Promise<void> {
  const existing = await findOneWithDecryption(em, FeatureToggle, {
    identifier: SALES_CHANNELS_TOGGLE_DEFINITION.identifier,
    deletedAt: null,
  })
  if (existing) return
  em.persist(
    em.create(FeatureToggle, {
      identifier: SALES_CHANNELS_TOGGLE_DEFINITION.identifier,
      name: SALES_CHANNELS_TOGGLE_DEFINITION.name,
      description: SALES_CHANNELS_TOGGLE_DEFINITION.description,
      category: SALES_CHANNELS_TOGGLE_DEFINITION.category,
      type: SALES_CHANNELS_TOGGLE_DEFINITION.type,
      defaultValue: SALES_CHANNELS_TOGGLE_DEFINITION.defaultValue,
    }),
  )
  await em.flush()
}
