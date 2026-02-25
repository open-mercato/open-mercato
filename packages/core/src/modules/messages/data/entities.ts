import { Entity, PrimaryKey, Property, Index, OptionalProps, Unique } from '@mikro-orm/core'

export type MessageStatus = 'draft' | 'sent'
export type MessagePriority = 'low' | 'normal' | 'high' | 'urgent'
export type MessageBodyFormat = 'text' | 'markdown'

export type MessageAction = {
  id: string
  label: string
  labelKey?: string
  variant?: 'default' | 'secondary' | 'destructive' | 'outline' | 'ghost'
  icon?: string
  commandId?: string
  href?: string
  isTerminal?: boolean
  confirmRequired?: boolean
  confirmMessage?: string
}

export type MessageActionData = {
  actions: MessageAction[]
  primaryActionId?: string
  expiresAt?: string
}

@Entity({ tableName: 'messages' })
@Index({ name: 'messages_sender_idx', properties: ['senderUserId', 'sentAt'] })
@Index({ name: 'messages_thread_idx', properties: ['threadId'] })
@Index({ name: 'messages_type_idx', properties: ['type', 'tenantId'] })
@Index({ name: 'messages_tenant_idx', properties: ['tenantId', 'organizationId'] })
export class Message {
  [OptionalProps]?: 'type' | 'status' | 'priority' | 'bodyFormat' | 'isDraft' | 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'type', type: 'text' })
  type: string = 'default'

  @Property({ name: 'thread_id', type: 'uuid', nullable: true })
  threadId?: string | null

  @Property({ name: 'parent_message_id', type: 'uuid', nullable: true })
  parentMessageId?: string | null

  @Property({ name: 'sender_user_id', type: 'uuid' })
  senderUserId!: string

  @Property({ name: 'subject', type: 'text' })
  subject!: string

  @Property({ name: 'body', type: 'text' })
  body!: string

  @Property({ name: 'body_format', type: 'text' })
  bodyFormat: MessageBodyFormat = 'text'

  @Property({ name: 'priority', type: 'text' })
  priority: MessagePriority = 'normal'

  @Property({ name: 'status', type: 'text' })
  status: MessageStatus = 'draft'

  @Property({ name: 'is_draft', type: 'boolean' })
  isDraft: boolean = true

  @Property({ name: 'sent_at', type: Date, nullable: true })
  sentAt?: Date | null

  @Property({ name: 'action_data', type: 'json', nullable: true })
  actionData?: MessageActionData | null

  @Property({ name: 'action_result', type: 'json', nullable: true })
  actionResult?: Record<string, unknown> | null

  @Property({ name: 'action_taken', type: 'text', nullable: true })
  actionTaken?: string | null

  @Property({ name: 'action_taken_by_user_id', type: 'uuid', nullable: true })
  actionTakenByUserId?: string | null

  @Property({ name: 'action_taken_at', type: Date, nullable: true })
  actionTakenAt?: Date | null

  @Property({ name: 'send_via_email', type: 'boolean', default: false })
  sendViaEmail: boolean = false

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null

  @Property({ name: 'visibility', type: 'text', nullable: true })
  visibility?: 'public' | 'internal' | null

  @Property({ name: 'source_entity_type', type: 'text', nullable: true })
  sourceEntityType?: string | null

  @Property({ name: 'source_entity_id', type: 'uuid', nullable: true })
  sourceEntityId?: string | null

  @Property({ name: 'external_email', type: 'text', nullable: true })
  externalEmail?: string | null

  @Property({ name: 'external_name', type: 'text', nullable: true })
  externalName?: string | null

  @Property({ name: 'external_email_sent_at', type: Date, nullable: true })
  externalEmailSentAt?: Date | null

  @Property({ name: 'external_email_failed_at', type: Date, nullable: true })
  externalEmailFailedAt?: Date | null

  @Property({ name: 'external_email_error', type: 'text', nullable: true })
  externalEmailError?: string | null
}

export type RecipientType = 'to' | 'cc' | 'bcc'
export type RecipientStatus = 'unread' | 'read' | 'archived' | 'deleted'

@Entity({ tableName: 'message_recipients' })
@Index({ name: 'message_recipients_user_idx', properties: ['recipientUserId', 'status'] })
@Index({ name: 'message_recipients_message_idx', properties: ['messageId'] })
@Unique({ name: 'message_recipients_message_user_unique', properties: ['messageId', 'recipientUserId'] })
export class MessageRecipient {
  [OptionalProps]?: 'recipientType' | 'status' | 'createdAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'message_id', type: 'uuid' })
  messageId!: string

  @Property({ name: 'recipient_user_id', type: 'uuid' })
  recipientUserId!: string

  @Property({ name: 'recipient_type', type: 'text' })
  recipientType: RecipientType = 'to'

  @Property({ name: 'status', type: 'text' })
  status: RecipientStatus = 'unread'

  @Property({ name: 'read_at', type: Date, nullable: true })
  readAt?: Date | null

  @Property({ name: 'archived_at', type: Date, nullable: true })
  archivedAt?: Date | null

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null

  @Property({ name: 'email_sent_at', type: Date, nullable: true })
  emailSentAt?: Date | null

  @Property({ name: 'email_delivered_at', type: Date, nullable: true })
  emailDeliveredAt?: Date | null

  @Property({ name: 'email_opened_at', type: Date, nullable: true })
  emailOpenedAt?: Date | null

  @Property({ name: 'email_failed_at', type: Date, nullable: true })
  emailFailedAt?: Date | null

  @Property({ name: 'email_error', type: 'text', nullable: true })
  emailError?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

@Entity({ tableName: 'message_objects' })
@Index({ name: 'message_objects_message_idx', properties: ['messageId'] })
@Index({ name: 'message_objects_entity_idx', properties: ['entityType', 'entityId'] })
export class MessageObject {
  [OptionalProps]?: 'actionRequired' | 'createdAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'message_id', type: 'uuid' })
  messageId!: string

  @Property({ name: 'entity_module', type: 'text' })
  entityModule!: string

  @Property({ name: 'entity_type', type: 'text' })
  entityType!: string

  @Property({ name: 'entity_id', type: 'uuid' })
  entityId!: string

  @Property({ name: 'action_required', type: 'boolean' })
  actionRequired: boolean = false

  @Property({ name: 'action_type', type: 'text', nullable: true })
  actionType?: string | null

  @Property({ name: 'action_label', type: 'text', nullable: true })
  actionLabel?: string | null

  @Property({ name: 'entity_snapshot', type: 'json', nullable: true })
  entitySnapshot?: Record<string, unknown> | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

@Entity({ tableName: 'message_access_tokens' })
@Index({ name: 'message_access_tokens_token_idx', properties: ['token'] })
@Index({ name: 'message_access_tokens_message_idx', properties: ['messageId'] })
export class MessageAccessToken {
  [OptionalProps]?: 'createdAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'message_id', type: 'uuid' })
  messageId!: string

  @Property({ name: 'recipient_user_id', type: 'uuid' })
  recipientUserId!: string

  @Property({ name: 'token', type: 'text', unique: true })
  token!: string

  @Property({ name: 'expires_at', type: Date })
  expiresAt!: Date

  @Property({ name: 'used_at', type: Date, nullable: true })
  usedAt?: Date | null

  @Property({ name: 'use_count', type: 'int', default: 0 })
  useCount: number = 0

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

@Entity({ tableName: 'message_confirmations' })
@Index({ name: 'message_confirmations_message_idx', properties: ['messageId'] })
@Index({ name: 'message_confirmations_scope_idx', properties: ['tenantId', 'organizationId'] })
@Unique({ name: 'message_confirmations_message_unique', properties: ['messageId'] })
export class MessageConfirmation {
  [OptionalProps]?: 'confirmed' | 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'message_id', type: 'uuid' })
  messageId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId?: string | null

  @Property({ name: 'confirmed', type: 'boolean' })
  confirmed: boolean = true

  @Property({ name: 'confirmed_by_user_id', type: 'uuid', nullable: true })
  confirmedByUserId?: string | null

  @Property({ name: 'confirmed_at', type: Date, nullable: true })
  confirmedAt?: Date | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

export default [Message, MessageRecipient, MessageObject, MessageAccessToken, MessageConfirmation]
