import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: 'messages.sent', label: 'Message Sent', entity: 'message', category: 'custom' },
  { id: 'messages.read', label: 'Message Read', entity: 'message', category: 'custom' },
  { id: 'messages.unread', label: 'Message Marked Unread', entity: 'message', category: 'custom' },
  { id: 'messages.archived', label: 'Message Archived', entity: 'message', category: 'custom' },
  { id: 'messages.unarchived', label: 'Message Unarchived', entity: 'message', category: 'custom' },
  { id: 'messages.deleted', label: 'Message Deleted', entity: 'message', category: 'custom' },
  { id: 'messages.action.taken', label: 'Message Action Taken', entity: 'message', category: 'custom' },
  { id: 'messages.email.sent', label: 'Message Email Sent', entity: 'message', category: 'custom' },
  { id: 'messages.email.failed', label: 'Message Email Failed', entity: 'message', category: 'custom' },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'messages',
  events,
})

export const emitMessagesEvent = eventsConfig.emit

export type MessagesEventId = typeof events[number]['id']

export default eventsConfig
