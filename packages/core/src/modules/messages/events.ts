import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: 'messages.sent', label: 'Message Sent', entity: 'message', category: 'custom' },
  { id: 'messages.action.taken', label: 'Message Action Taken', entity: 'message', category: 'custom' },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'messages',
  events,
})

export default eventsConfig
