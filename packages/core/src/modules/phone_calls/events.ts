import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: 'phone_calls.call.ingested', label: 'Phone Call Ingested', entity: 'call', category: 'crud' },
  { id: 'phone_calls.call.updated', label: 'Phone Call Updated', entity: 'call', category: 'crud' },
  { id: 'phone_calls.call.ingest_failed', label: 'Phone Call Ingest Failed', entity: 'call', category: 'crud' },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'phone_calls',
  events,
})

/** Type-safe event emitter for phone_calls module */
export const emitPhoneCallsEvent = eventsConfig.emit

/** Event IDs that can be emitted by the phone_calls module */
export type PhoneCallsEventId = typeof events[number]['id']

export default eventsConfig
