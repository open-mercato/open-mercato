import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: 'privacy.subject.erased', label: 'Privacy Subject Erased', category: 'lifecycle', excludeFromTriggers: true },
  { id: 'privacy.subject.anonymized', label: 'Privacy Subject Anonymized', category: 'lifecycle', excludeFromTriggers: true },
  { id: 'privacy.subject.purged', label: 'Privacy Subject Purged', category: 'lifecycle', excludeFromTriggers: true },
] as const

export const eventsConfig = createModuleEvents({ moduleId: 'audit_logs', events })
export const emitPrivacyEvent = eventsConfig.emit
export type PrivacyEventId = typeof events[number]['id']
export default eventsConfig
