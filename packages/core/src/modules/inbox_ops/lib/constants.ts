import type { InboxActionType } from '../data/entities'

/**
 * Synchronous action-type-to-RBAC-feature mapping.
 *
 * The generated inbox action registry (`getInboxAction(type)?.requiredFeature`)
 * provides the same data but requires async loading. This map exists as the
 * synchronous equivalent used by the extraction worker and execution engine.
 *
 * TODO: Consolidate with the generated registry once it supports sync access.
 */
export const REQUIRED_FEATURES_MAP: Record<InboxActionType, string> = {
  create_order: 'sales.orders.manage',
  create_quote: 'sales.quotes.manage',
  update_order: 'sales.orders.manage',
  update_shipment: 'sales.shipments.manage',
  create_contact: 'customers.people.manage',
  create_product: 'catalog.products.manage',
  link_contact: 'customers.people.manage',
  log_activity: 'customers.activities.manage',
  draft_reply: 'inbox_ops.replies.send',
} as const
