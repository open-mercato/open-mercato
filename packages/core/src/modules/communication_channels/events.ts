import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  // ── Bridge events ────────────────────────────────────────
  {
    id: 'communication_channels.message.received',
    label: 'External Message Received',
    entity: 'external_message',
    category: 'custom',
    clientBroadcast: true,
  },
  {
    id: 'communication_channels.message.sent',
    label: 'External Message Sent (Outbound)',
    entity: 'external_message',
    category: 'custom',
    clientBroadcast: true,
  },
  {
    id: 'communication_channels.message.delivery_failed',
    label: 'External Message Delivery Failed',
    entity: 'external_message',
    category: 'custom',
    clientBroadcast: true,
  },
  {
    id: 'communication_channels.conversation.created',
    label: 'External Conversation Created',
    entity: 'external_conversation',
    category: 'custom',
  },
  {
    id: 'communication_channels.conversation.reassigned',
    label: 'External Conversation Reassigned',
    entity: 'external_conversation',
    category: 'custom',
  },
  {
    id: 'communication_channels.contact.resolved',
    label: 'External Contact Resolved to CRM Person',
    entity: 'external_conversation',
    category: 'custom',
  },
  // ── Channel lifecycle events ─────────────────────────────
  {
    id: 'communication_channels.channel.requires_reauth',
    label: 'Channel Requires Re-authentication',
    entity: 'communication_channel',
    category: 'lifecycle',
    clientBroadcast: true,
  },
  {
    id: 'communication_channels.channel.disconnected',
    label: 'Channel Disconnected',
    entity: 'communication_channel',
    category: 'lifecycle',
    clientBroadcast: true,
  },
  {
    id: 'communication_channels.channel.deleted',
    label: 'Channel Deleted',
    entity: 'communication_channel',
    category: 'lifecycle',
    clientBroadcast: true,
  },
  {
    id: 'communication_channels.channel.primary_changed',
    label: 'Primary Channel Changed',
    entity: 'communication_channel',
    category: 'lifecycle',
    clientBroadcast: true,
  },
  // ── Reaction events ──────────────────────────────────────
  {
    id: 'communication_channels.reaction.added',
    label: 'Reaction Added',
    entity: 'message_reaction',
    category: 'custom',
    clientBroadcast: true,
  },
  {
    id: 'communication_channels.reaction.removed',
    label: 'Reaction Removed',
    entity: 'message_reaction',
    category: 'custom',
    clientBroadcast: true,
  },
  // ── Push delivery lifecycle (Spec C) ─────────────────────
  {
    id: 'communication_channels.push.registered',
    label: 'Push Delivery Registered',
    entity: 'communication_channel',
    category: 'lifecycle',
    clientBroadcast: true,
  },
  {
    id: 'communication_channels.push.failed',
    label: 'Push Delivery Failed (Falling Back to Polling)',
    entity: 'communication_channel',
    category: 'lifecycle',
    clientBroadcast: true,
  },
  {
    id: 'communication_channels.push.renewed',
    label: 'Push Delivery Renewed',
    entity: 'communication_channel',
    category: 'lifecycle',
  },
  {
    id: 'communication_channels.push.deactivated',
    label: 'Push Delivery Deactivated',
    entity: 'communication_channel',
    category: 'lifecycle',
    clientBroadcast: true,
  },
] as const

export const eventsConfig = createModuleEvents({ moduleId: 'communication_channels', events })
export const emitCommunicationChannelsEvent = eventsConfig.emit
export type CommunicationChannelsEventId = (typeof events)[number]['id']

export default eventsConfig
