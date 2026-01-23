import { Entity, PrimaryKey, Property, Index, OptionalProps } from '@mikro-orm/core'
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
