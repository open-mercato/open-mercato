import type { EntityExtension } from '@open-mercato/shared/modules/entities'

/**
 * Cross-module entity links declared by the communication_channels hub.
 *
 * The hub knows about other modules (auth, customers, messages) but those modules
 * do NOT know about the hub — dependency direction is one-way (hub → others).
 * Lookups across these links happen via the query engine, never via raw SQL joins.
 *
 * Canonical EntityExtension shape from `@open-mercato/shared/modules/entities`:
 *   `{ base, extension, join: { baseKey, extensionKey }, cardinality?, required?, description? }`
 */

const entityExtensions: EntityExtension[] = [
  {
    base: 'messages:message',
    extension: 'communication_channels:message_channel_link',
    join: { baseKey: 'id', extensionKey: 'message_id' },
    cardinality: 'one-to-one',
    description: 'Links Messages to external channel conversations',
  },
  {
    base: 'messages:message',
    extension: 'communication_channels:message_reaction',
    join: { baseKey: 'id', extensionKey: 'message_id' },
    cardinality: 'one-to-many',
    description: 'Emoji reactions on messages from external channels and internal users',
  },
  {
    base: 'auth:user',
    extension: 'communication_channels:external_conversation',
    join: { baseKey: 'id', extensionKey: 'assigned_user_id' },
    cardinality: 'one-to-many',
    description: 'Conversations assigned to a user in the unified inbox',
  },
  {
    base: 'customers:customer_entity',
    extension: 'communication_channels:external_conversation',
    join: { baseKey: 'id', extensionKey: 'contact_person_id' },
    cardinality: 'one-to-many',
    description: 'Conversations matched to a CRM person',
  },
  /**
   * Per-user channel ownership (added by the email integration spec).
   *
   * Links every `CommunicationChannel` row whose `user_id IS NOT NULL` back to
   * its owning `auth:user`. Powers the per-user profile page, RBAC filters, and
   * future ownership-aware features (CRM, automations).
   */
  {
    base: 'auth:user',
    extension: 'communication_channels:communication_channel',
    join: { baseKey: 'id', extensionKey: 'user_id' },
    cardinality: 'one-to-many',
    description: 'Per-user owned channels (Gmail/IMAP personal mailboxes)',
  },
  /**
   * Per-user credentials scoping (added by the email integration spec).
   *
   * Links `integration_credentials.user_id` back to `auth:user`. Set when a
   * channel's credentials belong to a specific user (e.g. that user's OAuth
   * refresh token), NULL for tenant-wide shared secrets. The hub spec owns the
   * EXTENSION declaration; the integrations module owns the COLUMN — coordinated
   * change shipped in the same PR.
   */
  {
    base: 'auth:user',
    extension: 'integrations:integration_credentials',
    join: { baseKey: 'id', extensionKey: 'user_id' },
    cardinality: 'one-to-many',
    description: 'Per-user credentials (OAuth refresh tokens, per-user IMAP/SMTP passwords)',
  },
]

export const extensions = entityExtensions
export default entityExtensions
