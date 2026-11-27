import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: 'assisted_selling.thread.opened', label: 'Assisted Selling Thread Opened', entity: 'thread', category: 'lifecycle', clientBroadcast: true },
  { id: 'assisted_selling.thread.closed', label: 'Assisted Selling Thread Closed', entity: 'thread', category: 'lifecycle', clientBroadcast: true },
  { id: 'assisted_selling.participant.joined', label: 'Assisted Selling Participant Joined', entity: 'participant', category: 'lifecycle', clientBroadcast: true },
  { id: 'assisted_selling.participant.left', label: 'Assisted Selling Participant Left', entity: 'participant', category: 'lifecycle', clientBroadcast: true },
  { id: 'assisted_selling.message.posted', label: 'Assisted Selling Message Posted', entity: 'message', category: 'crud', clientBroadcast: true },
  { id: 'assisted_selling.proposal.published', label: 'Assisted Selling Proposal Published', entity: 'proposal', category: 'lifecycle', clientBroadcast: true },
  { id: 'assisted_selling.proposal.accepted', label: 'Assisted Selling Proposal Accepted', entity: 'proposal', category: 'lifecycle', clientBroadcast: true },
  { id: 'assisted_selling.proposal.rejected', label: 'Assisted Selling Proposal Rejected', entity: 'proposal', category: 'lifecycle', clientBroadcast: true },
  { id: 'assisted_selling.proposal.withdrawn', label: 'Assisted Selling Proposal Withdrawn', entity: 'proposal', category: 'lifecycle', clientBroadcast: true },
  { id: 'assisted_selling.proposal.superseded', label: 'Assisted Selling Proposal Superseded', entity: 'proposal', category: 'lifecycle', clientBroadcast: true },
  { id: 'assisted_selling.proposal.expired', label: 'Assisted Selling Proposal Expired', entity: 'proposal', category: 'lifecycle', clientBroadcast: true },
  { id: 'assisted_selling.attribution.degraded', label: 'Assisted Selling Attribution Degraded', entity: 'attribution', category: 'lifecycle' },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'assisted_selling',
  events,
})

export const emitAssistedSellingEvent = eventsConfig.emit

export type AssistedSellingEventId = typeof events[number]['id']

export default eventsConfig
