import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: 'planner.availability_rule.created', label: 'Availability Rule Created', entity: 'availability_rule', category: 'crud' },
  { id: 'planner.availability_rule.updated', label: 'Availability Rule Updated', entity: 'availability_rule', category: 'crud' },
  { id: 'planner.availability_rule.deleted', label: 'Availability Rule Deleted', entity: 'availability_rule', category: 'crud' },
  { id: 'planner.availability_rule_set.created', label: 'Availability Rule Set Created', entity: 'availability_rule_set', category: 'crud' },
  { id: 'planner.availability_rule_set.updated', label: 'Availability Rule Set Updated', entity: 'availability_rule_set', category: 'crud' },
  { id: 'planner.availability_rule_set.deleted', label: 'Availability Rule Set Deleted', entity: 'availability_rule_set', category: 'crud' },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'planner',
  events,
})

export const emitPlannerEvent = eventsConfig.emit

export type PlannerEventId = typeof events[number]['id']

export default eventsConfig
