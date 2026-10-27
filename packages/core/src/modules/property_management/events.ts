import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: 'property_management.building.created', label: 'Building Created', entity: 'building', category: 'crud' },
  { id: 'property_management.building.updated', label: 'Building Updated', entity: 'building', category: 'crud' },
  { id: 'property_management.building.archived', label: 'Building Archived', entity: 'building', category: 'lifecycle' },
  { id: 'property_management.building.deleted', label: 'Building Deleted', entity: 'building', category: 'crud' },
  { id: 'property_management.floor.created', label: 'Floor Created', entity: 'floor', category: 'crud' },
  { id: 'property_management.floor.updated', label: 'Floor Updated', entity: 'floor', category: 'crud' },
  { id: 'property_management.floor.deleted', label: 'Floor Deleted', entity: 'floor', category: 'crud' },
  { id: 'property_management.space.created', label: 'Space Created', entity: 'space', category: 'crud' },
  { id: 'property_management.space.updated', label: 'Space Updated', entity: 'space', category: 'crud' },
  { id: 'property_management.space.deleted', label: 'Space Deleted', entity: 'space', category: 'crud' },
  { id: 'property_management.unit.created', label: 'Unit Created', entity: 'unit', category: 'crud' },
  { id: 'property_management.unit.updated', label: 'Unit Updated', entity: 'unit', category: 'crud' },
  { id: 'property_management.unit.deleted', label: 'Unit Deleted', entity: 'unit', category: 'crud' },
  { id: 'property_management.unit.product_changed', label: 'Unit Product Changed', entity: 'unit', category: 'lifecycle' },
  { id: 'property_management.common_area.created', label: 'Common Area Created', entity: 'common_area', category: 'crud' },
  { id: 'property_management.common_area.updated', label: 'Common Area Updated', entity: 'common_area', category: 'crud' },
  { id: 'property_management.common_area.deleted', label: 'Common Area Deleted', entity: 'common_area', category: 'crud' },
  { id: 'property_management.unavailability.created', label: 'Unavailability Created', entity: 'unavailability', category: 'crud' },
  { id: 'property_management.unavailability.ended', label: 'Unavailability Ended', entity: 'unavailability', category: 'lifecycle' },
  { id: 'property_management.lease.created', label: 'Lease Created', entity: 'lease', category: 'crud' },
  { id: 'property_management.lease.updated', label: 'Lease Updated', entity: 'lease', category: 'crud' },
  { id: 'property_management.lease.activated', label: 'Lease Activated', entity: 'lease', category: 'lifecycle' },
  { id: 'property_management.lease.extended', label: 'Lease Extended', entity: 'lease', category: 'lifecycle' },
  { id: 'property_management.lease.ended', label: 'Lease Ended', entity: 'lease', category: 'lifecycle' },
  { id: 'property_management.lease.deleted', label: 'Lease Deleted', entity: 'lease', category: 'crud' },
  { id: 'property_management.lease.order_orphaned', label: 'Lease Order Orphaned', entity: 'lease', category: 'system' },
  { id: 'property_management.lease_proposal.sent', label: 'Lease Proposal Sent', entity: 'lease_proposal', category: 'lifecycle' },
  { id: 'property_management.lease_proposal.withdrawn', label: 'Lease Proposal Withdrawn', entity: 'lease_proposal', category: 'lifecycle' },
  { id: 'property_management.lease_proposal.approved', label: 'Lease Proposal Approved', entity: 'lease_proposal', category: 'lifecycle' },
  { id: 'property_management.lease_proposal.declined', label: 'Lease Proposal Declined', entity: 'lease_proposal', category: 'lifecycle' },
  { id: 'property_management.lease_proposal.expired', label: 'Lease Proposal Expired', entity: 'lease_proposal', category: 'lifecycle' },
  { id: 'property_management.booking.created', label: 'Booking Created', entity: 'booking', category: 'crud' },
  { id: 'property_management.booking.cancelled', label: 'Booking Cancelled', entity: 'booking', category: 'lifecycle' },
  { id: 'property_management.booking.completed', label: 'Booking Completed', entity: 'booking', category: 'lifecycle' },
  { id: 'property_management.booking.order_orphaned', label: 'Booking Order Orphaned', entity: 'booking', category: 'system' },
  {
    id: 'property_management.booking.portal_changed',
    label: 'Booking Changed (portal)',
    entity: 'booking',
    category: 'system',
    portalBroadcast: true,
    excludeFromTriggers: true,
  },
  {
    id: 'property_management.lease.portal_changed',
    label: 'Lease Changed (portal)',
    entity: 'lease',
    category: 'system',
    portalBroadcast: true,
    excludeFromTriggers: true,
  },
  {
    id: 'property_management.lease_proposal.portal_changed',
    label: 'Lease Proposal Changed (portal)',
    entity: 'lease_proposal',
    category: 'system',
    portalBroadcast: true,
    excludeFromTriggers: true,
  },
] as const

export const eventsConfig = createModuleEvents({ moduleId: 'property_management', events })

export const emitPropertyManagementEvent = eventsConfig.emit

export type PropertyManagementEventId = typeof events[number]['id']

export default eventsConfig
