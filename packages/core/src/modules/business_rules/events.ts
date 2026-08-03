import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: 'business_rules.rule.execution_failed', label: 'Rule Execution Failed', entity: 'rule', category: 'lifecycle' },
] as const

export const eventsConfig = createModuleEvents({ moduleId: 'business_rules', events })
export const emitBusinessRulesEvent = eventsConfig.emit
export type BusinessRulesEventId = typeof events[number]['id']
export default eventsConfig
