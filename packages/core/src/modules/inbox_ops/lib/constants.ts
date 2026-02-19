import type { InboxActionType } from '../data/entities'

export const REQUIRED_FEATURES_MAP: Record<InboxActionType, string> = {
  create_order: 'sales.orders.manage',
  create_quote: 'sales.quotes.manage',
  update_order: 'sales.orders.manage',
  update_shipment: 'sales.shipments.manage',
  create_contact: 'customers.people.manage',
  link_contact: 'customers.people.manage',
  log_activity: 'customers.activities.manage',
  draft_reply: 'inbox_ops.replies.send',
} as const
