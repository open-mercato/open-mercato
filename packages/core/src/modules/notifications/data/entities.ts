import { OptionalProps } from '@mikro-orm/core'
import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/decorators/legacy'
import type { NotificationActionData } from '@open-mercato/shared/modules/notifications/types'

export type NotificationStatus = 'unread' | 'read' | 'actioned' | 'dismissed'
export type NotificationSeverity = 'info' | 'warning' | 'success' | 'error'

@Entity({ tableName: 'notifications' })
@Index({ name: 'notifications_recipient_status_idx', properties: ['recipientUserId', 'status', 'createdAt'] })
@Index({ name: 'notifications_source_idx', properties: ['sourceEntityType', 'sourceEntityId'] })
@Index({ name: 'notifications_tenant_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'notifications_expires_idx', properties: ['expiresAt'] })
@Index({ name: 'notifications_group_idx', properties: ['groupKey', 'recipientUserId'] })
export class Notification {
  [OptionalProps]?: 'status' | 'severity' | 'createdAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'recipient_user_id', type: 'uuid' })
  recipientUserId!: string

  @Property({ name: 'type', type: 'text' })
  type!: string

  // i18n keys (preferred for i18n-first approach)
  @Property({ name: 'title_key', type: 'text', nullable: true })
  titleKey?: string | null

  @Property({ name: 'body_key', type: 'text', nullable: true })
  bodyKey?: string | null

  // Template variables for i18n interpolation (stored as JSONB)
  @Property({ name: 'title_variables', type: 'json', nullable: true })
  titleVariables?: Record<string, string> | null

  @Property({ name: 'body_variables', type: 'json', nullable: true })
  bodyVariables?: Record<string, string> | null

  // Fallback text (for backward compatibility or when keys are not available)
  @Property({ name: 'title', type: 'text' })
  title!: string

  @Property({ name: 'body', type: 'text', nullable: true })
  body?: string | null

  @Property({ name: 'icon', type: 'text', nullable: true })
  icon?: string | null

  @Property({ name: 'severity', type: 'text', default: 'info' })
  severity: NotificationSeverity = 'info'

  @Property({ name: 'status', type: 'text', default: 'unread' })
  status: NotificationStatus = 'unread'

  @Property({ name: 'action_data', type: 'json', nullable: true })
  actionData?: NotificationActionData | null

  @Property({ name: 'action_result', type: 'json', nullable: true })
  actionResult?: Record<string, unknown> | null

  @Property({ name: 'action_taken', type: 'text', nullable: true })
  actionTaken?: string | null

  @Property({ name: 'source_module', type: 'text', nullable: true })
  sourceModule?: string | null

  @Property({ name: 'source_entity_type', type: 'text', nullable: true })
  sourceEntityType?: string | null

  @Property({ name: 'source_entity_id', type: 'uuid', nullable: true })
  sourceEntityId?: string | null

  @Property({ name: 'link_href', type: 'text', nullable: true })
  linkHref?: string | null

  @Property({ name: 'group_key', type: 'text', nullable: true })
  groupKey?: string | null

  // Arbitrary app-readable key/values delivered with the push payload and exposed to in-app clients.
  @Property({ name: 'data', type: 'json', nullable: true })
  data?: Record<string, string> | null

  // Per-provider push customization (sound/badge/image/priority/channelId/body); push-only.
  // Typed loosely to keep notifications decoupled from communication_channels' PushOptions.
  @Property({ name: 'push_options', type: 'json', nullable: true })
  pushOptions?: Record<string, unknown> | null

  // Resolved delivery channels for this notification (target ∩ type-eligibility ∩ registered ∩ preference).
  // Authoritative target filter the dispatcher loops over; `in_app` membership also gates bell/inbox visibility.
  // NULL = legacy/all-channels (delivered and visible everywhere) — preserves pre-Phase-7 behavior.
  @Property({ name: 'channels', type: 'json', nullable: true })
  channels?: string[] | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'read_at', type: Date, nullable: true })
  readAt?: Date | null

  @Property({ name: 'actioned_at', type: Date, nullable: true })
  actionedAt?: Date | null

  @Property({ name: 'dismissed_at', type: Date, nullable: true })
  dismissedAt?: Date | null

  @Property({ name: 'expires_at', type: Date, nullable: true })
  expiresAt?: Date | null

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId?: string | null
}

/**
 * DB-backed mirror of the code-registered notification type catalogue
 * (the in-memory `NotificationTypeDefinition` seam stays the source of truth).
 * Lets remote clients (mobile apps) enumerate types over HTTP to render a
 * preferences screen without shipping a copy of the catalogue.
 *
 * `tenant_id` is nullable: code-registered types are system-wide (`null`).
 * The string `id` is the frozen notification-type id (e.g. `sales.order.created`).
 */
@Entity({ tableName: 'notification_types' })
@Index({ name: 'notification_types_tenant_idx', properties: ['tenantId'] })
export class NotificationType {
  [OptionalProps]?: 'tenantId' | 'descriptionKey' | 'category' | 'silent' | 'nonOptOut' | 'createdAt' | 'updatedAt'

  @PrimaryKey({ name: 'id', type: 'text' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId?: string | null

  @Property({ name: 'label_key', type: 'text' })
  labelKey!: string

  @Property({ name: 'description_key', type: 'text', nullable: true })
  descriptionKey?: string | null

  @Property({ name: 'category', type: 'text', nullable: true })
  category?: string | null

  @Property({ name: 'silent', type: 'boolean', default: false })
  silent: boolean = false

  @Property({ name: 'non_opt_out', type: 'boolean', default: false })
  nonOptOut: boolean = false

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

/**
 * Tenant-scoped operator override of a notification type's delivery contract.
 * Lazy-seeded like `NotificationPreference`: an absent row means the code
 * declarations apply unchanged. `channels` REPLACES the code-declared
 * `NotificationTypeDefinition.channels` when set (`null` inherits it) — a
 * channel outside the effective set never delivers for the type in this tenant
 * (checked before both the `nonOptOut` bypass and user preferences) and users
 * cannot opt into it; the preference UIs render the cell locked off.
 * `nonOptOut` overrides the code-declared flag the same way: `true` forces the
 * type on for the tenant's users, `false` makes a code-required type
 * user-editable, `null` inherits. The `notification_type_id` is a soft string
 * reference to a `notification_types.id` (no cross-module ORM relationship);
 * `syncNotificationTypes` never touches this table, so operator edits survive
 * catalogue re-syncs.
 */
@Entity({ tableName: 'notification_type_overrides' })
@Index({
  name: 'notification_type_overrides_unique',
  expression:
    'create unique index "notification_type_overrides_unique" on "notification_type_overrides" ("tenant_id", "notification_type_id");',
})
export class NotificationTypeOverride {
  [OptionalProps]?: 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'notification_type_id', type: 'text' })
  notificationTypeId!: string

  @Property({ name: 'channels', type: 'json', nullable: true })
  channels?: string[] | null

  @Property({ name: 'non_opt_out', type: 'boolean', nullable: true })
  nonOptOut?: boolean | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

/**
 * Channel-agnostic per-user notification preference. Lazy-seeded: an absent row
 * means the channel is enabled (default-on). Channels (in_app, push, future
 * email/sms) are free-form strings; the `notification_type_id` is a soft string
 * reference to a `notification_types.id` (no cross-module ORM relationship).
 */
@Entity({ tableName: 'notification_preferences' })
@Index({ name: 'notification_preferences_tenant_user_idx', properties: ['tenantId', 'userId'] })
@Index({
  name: 'notification_preferences_unique',
  expression:
    'create unique index "notification_preferences_unique" on "notification_preferences" ("tenant_id", "user_id", "notification_type_id", "channel");',
})
export class NotificationPreference {
  [OptionalProps]?: 'enabled' | 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'user_id', type: 'uuid' })
  userId!: string

  @Property({ name: 'notification_type_id', type: 'text' })
  notificationTypeId!: string

  @Property({ name: 'channel', type: 'text' })
  channel!: string

  @Property({ name: 'enabled', type: 'boolean', default: true })
  enabled: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}
