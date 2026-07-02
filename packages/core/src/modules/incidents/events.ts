import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: 'incidents.incident.created', label: 'Incident Created', entity: 'incident', category: 'crud', clientBroadcast: true },
  { id: 'incidents.incident.updated', label: 'Incident Updated', entity: 'incident', category: 'crud', clientBroadcast: true },
  { id: 'incidents.incident.deleted', label: 'Incident Deleted', entity: 'incident', category: 'crud' },
  { id: 'incidents.incident.acknowledged', label: 'Incident Acknowledged', entity: 'incident', category: 'lifecycle', clientBroadcast: true },
  { id: 'incidents.incident.status_changed', label: 'Incident Status Changed', entity: 'incident', category: 'lifecycle', clientBroadcast: true },
  { id: 'incidents.incident.severity_changed', label: 'Incident Severity Changed', entity: 'incident', category: 'lifecycle', clientBroadcast: true },
  { id: 'incidents.incident.assigned', label: 'Incident Assigned', entity: 'incident', category: 'lifecycle', clientBroadcast: true },
  { id: 'incidents.incident.escalated', label: 'Incident Escalated', entity: 'incident', category: 'lifecycle', clientBroadcast: true },
  { id: 'incidents.incident.escalation_started', label: 'Escalation Started', entity: 'incident', category: 'lifecycle', clientBroadcast: true },
  { id: 'incidents.incident.escalation_exhausted', label: 'Escalation Exhausted', entity: 'incident', category: 'lifecycle', clientBroadcast: true },
  { id: 'incidents.incident.snoozed', label: 'Incident Snoozed', entity: 'incident', category: 'lifecycle' },
  { id: 'incidents.incident.resolved', label: 'Incident Resolved', entity: 'incident', category: 'lifecycle', clientBroadcast: true },
  { id: 'incidents.incident.closed', label: 'Incident Closed', entity: 'incident', category: 'lifecycle' },
  { id: 'incidents.incident.reopened', label: 'Incident Reopened', entity: 'incident', category: 'lifecycle' },
  { id: 'incidents.incident.merged', label: 'Incident Merged', entity: 'incident', category: 'lifecycle' },
  { id: 'incidents.incident.linked', label: 'Incident Linked', entity: 'incident', category: 'lifecycle' },
  { id: 'incidents.incident.customer_updated', label: 'Incident Customer Update Posted', entity: 'incident', category: 'lifecycle', portalBroadcast: true },
  { id: 'incidents.incident.update_overdue', label: 'Incident Update Overdue', entity: 'incident', category: 'lifecycle', clientBroadcast: true },
  { id: 'incidents.trigger.created', label: 'Incident Trigger Created', entity: 'trigger', category: 'crud' },
  { id: 'incidents.trigger.updated', label: 'Incident Trigger Updated', entity: 'trigger', category: 'crud' },
  { id: 'incidents.trigger.deleted', label: 'Incident Trigger Deleted', entity: 'trigger', category: 'crud' },
  { id: 'incidents.timeline_entry.added', label: 'Timeline Entry Added', entity: 'timeline_entry', category: 'crud', clientBroadcast: true },
  { id: 'incidents.impact.added', label: 'Incident Impact Added', entity: 'impact', category: 'crud', clientBroadcast: true },
  { id: 'incidents.impact.updated', label: 'Incident Impact Updated', entity: 'impact', category: 'crud', clientBroadcast: true },
  { id: 'incidents.impact.removed', label: 'Incident Impact Removed', entity: 'impact', category: 'crud', clientBroadcast: true },
  { id: 'incidents.action_item.created', label: 'Action Item Created', entity: 'action_item', category: 'crud', clientBroadcast: true },
  { id: 'incidents.action_item.completed', label: 'Action Item Completed', entity: 'action_item', category: 'lifecycle', clientBroadcast: true },
  { id: 'incidents.postmortem.created', label: 'Postmortem Created', entity: 'postmortem', category: 'crud', clientBroadcast: true },
  { id: 'incidents.postmortem.published', label: 'Postmortem Published', entity: 'postmortem', category: 'lifecycle', clientBroadcast: true },
] as const

export const eventsConfig = createModuleEvents({ moduleId: 'incidents', events })
export const emitIncidentsEvent = eventsConfig.emit
export type IncidentsEventId = typeof events[number]['id']
export default eventsConfig
