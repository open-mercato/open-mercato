import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: 'messages.message.sent', label: 'Message Sent', entity: 'message', category: 'custom' },
  { id: 'messages.message.read', label: 'Message Read', entity: 'message', category: 'custom' },
  { id: 'messages.message.marked_unread', label: 'Message Marked Unread', entity: 'message', category: 'custom' },
  { id: 'messages.message.archived', label: 'Message Archived', entity: 'message', category: 'custom' },
  { id: 'messages.message.unarchived', label: 'Message Unarchived', entity: 'message', category: 'custom' },
  { id: 'messages.message.deleted', label: 'Message Deleted', entity: 'message', category: 'custom' },
  { id: 'messages.message.action_taken', label: 'Message Action Taken', entity: 'message', category: 'custom' },
  { id: 'messages.message.email_sent', label: 'Message Email Sent', entity: 'message', category: 'custom' },
  { id: 'messages.message.email_failed', label: 'Message Email Failed', entity: 'message', category: 'custom' },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'messages',
  events,
})

export const emitMessagesEvent = eventsConfig.emit

export type MessagesEventId = typeof events[number]['id']

export default eventsConfig
