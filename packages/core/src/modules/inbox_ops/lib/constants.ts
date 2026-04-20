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
  create_order: 'sales.order.manage',
  create_quote: 'sales.quote.manage',
  update_order: 'sales.order.manage',
  update_shipment: 'sales.shipment.manage',
  create_contact: 'customers.person.manage',
  create_product: 'catalog.product.manage',
  link_contact: 'customers.person.manage',
  log_activity: 'customers.activity.manage',
  draft_reply: 'inbox_ops.replies.send',
} as const
