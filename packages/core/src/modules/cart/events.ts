import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: 'cart.cart.created', label: 'Cart Created', entity: 'cart', category: 'crud' },
  { id: 'cart.cart.updated', label: 'Cart Updated', entity: 'cart', category: 'crud', clientBroadcast: true },
  { id: 'cart.cart.expired', label: 'Cart Expired', entity: 'cart', category: 'lifecycle' },
  { id: 'cart.cart.abandoned', label: 'Cart Abandoned', entity: 'cart', category: 'lifecycle' },
  { id: 'cart.cart.merged', label: 'Cart Merged', entity: 'cart', category: 'lifecycle', clientBroadcast: true },
  { id: 'cart.cart.adopted', label: 'Cart Adopted', entity: 'cart', category: 'lifecycle' },
  { id: 'cart.cart.converted', label: 'Cart Converted', entity: 'cart', category: 'lifecycle' },
  { id: 'cart.cart.purged', label: 'Cart Purged', entity: 'cart', category: 'lifecycle' },
  { id: 'cart.line.added', label: 'Cart Line Added', entity: 'line', category: 'crud', clientBroadcast: true },
  { id: 'cart.line.updated', label: 'Cart Line Updated', entity: 'line', category: 'crud', clientBroadcast: true },
  { id: 'cart.line.removed', label: 'Cart Line Removed', entity: 'line', category: 'crud', clientBroadcast: true },
  { id: 'cart.promotion.applied', label: 'Cart Promotion Applied', entity: 'promotion', category: 'lifecycle', clientBroadcast: true },
  { id: 'cart.promotion.removed', label: 'Cart Promotion Removed', entity: 'promotion', category: 'lifecycle', clientBroadcast: true },
  { id: 'cart.promotion.no_longer_valid', label: 'Cart Promotion No Longer Valid', entity: 'promotion', category: 'lifecycle', clientBroadcast: true },
  { id: 'cart.price.changed', label: 'Cart Price Changed', entity: 'cart', category: 'lifecycle', clientBroadcast: true },
  { id: 'cart.approval.requested', label: 'Cart Approval Requested', entity: 'approval', category: 'lifecycle' },
  { id: 'cart.lock.acquired', label: 'Cart Lock Acquired', entity: 'cart', category: 'lifecycle' },
  { id: 'cart.lock.released', label: 'Cart Lock Released', entity: 'cart', category: 'lifecycle' },
  { id: 'cart.lock.timed_out', label: 'Cart Lock Timed Out', entity: 'cart', category: 'lifecycle' },
  // D-R4-23: emitted once per REQUEST with a rejected count, never once per rejected line,
  // and never clientBroadcast — the buyer already sees the product_unavailable warning in
  // the response body; this is the operator-facing signal.
  { id: 'cart.line.visibility_rejected', label: 'Cart Line Visibility Rejected', entity: 'line', category: 'lifecycle' },
  { id: 'cart.proposal.created', label: 'Cart Proposal Created', entity: 'proposal', category: 'lifecycle', clientBroadcast: true },
  { id: 'cart.proposal.accepted', label: 'Cart Proposal Accepted', entity: 'proposal', category: 'lifecycle', clientBroadcast: true },
  { id: 'cart.proposal.rejected', label: 'Cart Proposal Rejected', entity: 'proposal', category: 'lifecycle', clientBroadcast: true },
  { id: 'cart.proposal.expired', label: 'Cart Proposal Expired', entity: 'proposal', category: 'lifecycle', clientBroadcast: true },
  { id: 'cart.proposal.acceptance_undone', label: 'Cart Proposal Acceptance Undone', entity: 'proposal', category: 'lifecycle', clientBroadcast: true },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'cart',
  events,
})

export const emitCartEvent = eventsConfig.emit

export type CartEventId = typeof events[number]['id']

export default eventsConfig
