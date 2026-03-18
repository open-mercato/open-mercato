import { createModuleEvents } from '@open-mercato/shared/modules/events'

/**
 * Attachments Module Events
 *
 * Declares all events that can be emitted by the attachments module.
 */
const events = [
  { id: 'attachments.attachment.created', label: 'Attachment Created', entity: 'attachment', category: 'crud' },
  { id: 'attachments.attachment.updated', label: 'Attachment Updated', entity: 'attachment', category: 'crud' },
  { id: 'attachments.attachment.deleted', label: 'Attachment Deleted', entity: 'attachment', category: 'crud' },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'attachments',
  events,
})

/** Type-safe event emitter for attachments module */
export const emitAttachmentsEvent = eventsConfig.emit

/** Event IDs that can be emitted by the attachments module */
export type AttachmentsEventId = typeof events[number]['id']

export default eventsConfig
