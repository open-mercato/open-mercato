import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: 'warranty_claims.claim.created', label: 'Warranty Claim Created', entity: 'claim', category: 'crud' },
  { id: 'warranty_claims.claim.updated', label: 'Warranty Claim Updated', entity: 'claim', category: 'crud' },
  { id: 'warranty_claims.claim.deleted', label: 'Warranty Claim Deleted', entity: 'claim', category: 'crud' },
  { id: 'warranty_claims.claim.submitted', label: 'Warranty Claim Submitted', entity: 'claim', category: 'lifecycle' },
  {
    id: 'warranty_claims.claim.status_changed',
    label: 'Warranty Claim Status Changed',
    entity: 'claim',
    category: 'lifecycle',
    clientBroadcast: true,
    portalBroadcast: true,
  },
  { id: 'warranty_claims.claim.assigned', label: 'Warranty Claim Assigned', entity: 'claim', category: 'lifecycle' },
  {
    id: 'warranty_claims.claim.comment_added',
    label: 'Warranty Claim Comment Added',
    entity: 'claim',
    category: 'lifecycle',
    portalBroadcast: true,
  },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'warranty_claims',
  events,
})

export const emitWarrantyClaimsEvent = eventsConfig.emit

export type WarrantyClaimsEventId = typeof events[number]['id']

export default eventsConfig
