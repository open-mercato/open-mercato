import {
  Entity,
  PrimaryKey,
  Property,
  Index,
  Unique,
  OptionalProps,
} from '@mikro-orm/core'

// ---------------------------------------------------------------------------
// Shared Types
// ---------------------------------------------------------------------------

export interface ThreadMessage {
  messageId?: string
  from: { name?: string; email: string }
  to: { name?: string; email: string }[]
  cc?: { name?: string; email: string }[]
  subject?: string
  date: string
  body: string
  contentType: 'text' | 'html'
  isForwarded: boolean
}

export interface ExtractedParticipant {
  name: string
  email: string
  role: 'buyer' | 'seller' | 'logistics' | 'finance' | 'other'
  matchedContactId?: string | null
  matchedContactType?: 'person' | 'company' | null
  matchConfidence?: number
}

export type InboxEmailStatus = 'received' | 'processing' | 'processed' | 'needs_review' | 'failed'
export type InboxProposalStatus = 'pending' | 'partial' | 'accepted' | 'rejected'
export type InboxActionType =
  | 'create_order'
  | 'create_quote'
  | 'update_order'
  | 'update_shipment'
  | 'create_contact'
  | 'create_product'
  | 'link_contact'
  | 'log_activity'
  | 'draft_reply'
export type InboxActionStatus = 'pending' | 'processing' | 'accepted' | 'rejected' | 'executed' | 'failed'
export type InboxDiscrepancyType =
  | 'price_mismatch'
  | 'quantity_mismatch'
  | 'unknown_contact'
  | 'currency_mismatch'
  | 'date_conflict'
  | 'product_not_found'
  | 'duplicate_order'
  | 'other'

// ---------------------------------------------------------------------------
// InboxSettings
// ---------------------------------------------------------------------------

@Entity({ tableName: 'inbox_settings' })
@Index({ properties: ['organizationId', 'tenantId'] })
@Unique({ properties: ['inboxAddress'] })
export class InboxSettings {
  [OptionalProps]?: 'isActive' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'inbox_address', type: 'text' })
  inboxAddress!: string

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

// ---------------------------------------------------------------------------
// InboxEmail
// ---------------------------------------------------------------------------

@Entity({ tableName: 'inbox_emails' })
@Index({ properties: ['organizationId', 'tenantId'] })
@Index({ properties: ['organizationId', 'tenantId', 'status'] })
@Index({ properties: ['organizationId', 'tenantId', 'receivedAt'] })
@Unique({
  properties: ['organizationId', 'tenantId', 'messageId'],
  options: { where: 'message_id IS NOT NULL' },
})
@Unique({
  properties: ['organizationId', 'tenantId', 'contentHash'],
  options: { where: 'content_hash IS NOT NULL' },
})
export class InboxEmail {
  [OptionalProps]?: 'status' | 'isActive' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'message_id', type: 'text', nullable: true })
  messageId?: string | null

  @Property({ name: 'content_hash', type: 'text', nullable: true })
  contentHash?: string | null

  @Property({ name: 'forwarded_by_address', type: 'text' })
  forwardedByAddress!: string

  @Property({ name: 'forwarded_by_name', type: 'text', nullable: true })
  forwardedByName?: string | null

  @Property({ name: 'to_address', type: 'text' })
  toAddress!: string

  @Property({ name: 'subject', type: 'text' })
  subject!: string

  @Property({ name: 'reply_to', type: 'text', nullable: true })
  replyTo?: string | null

  @Property({ name: 'in_reply_to', type: 'text', nullable: true })
  inReplyTo?: string | null

  @Property({ name: 'references', type: 'json', nullable: true })
  emailReferences?: string[] | null

  @Property({ name: 'raw_text', type: 'text', nullable: true })
  rawText?: string | null

  @Property({ name: 'raw_html', type: 'text', nullable: true })
  rawHtml?: string | null

  @Property({ name: 'cleaned_text', type: 'text', nullable: true })
  cleanedText?: string | null

  @Property({ name: 'thread_messages', type: 'json', nullable: true })
  threadMessages?: ThreadMessage[] | null

  @Property({ name: 'detected_language', type: 'text', nullable: true })
  detectedLanguage?: string | null

  @Property({ name: 'attachment_ids', type: 'json', nullable: true })
  attachmentIds?: string[] | null

  @Property({ name: 'received_at', type: Date })
  receivedAt!: Date

  @Property({ name: 'status', type: 'text' })
  status: InboxEmailStatus = 'received'

  @Property({ name: 'processing_error', type: 'text', nullable: true })
  processingError?: string | null

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'metadata', type: 'json', nullable: true })
  metadata?: Record<string, unknown> | null

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

// ---------------------------------------------------------------------------
// InboxProposal
// ---------------------------------------------------------------------------

@Entity({ tableName: 'inbox_proposals' })
@Index({ properties: ['organizationId', 'tenantId'] })
@Index({ properties: ['organizationId', 'tenantId', 'status'] })
@Index({ properties: ['inboxEmailId'] })
export class InboxProposal {
  [OptionalProps]?: 'status' | 'possiblyIncomplete' | 'isActive' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'inbox_email_id', type: 'uuid' })
  inboxEmailId!: string

  @Property({ name: 'summary', type: 'text' })
  summary!: string

  @Property({ name: 'participants', type: 'json' })
  participants!: ExtractedParticipant[]

  @Property({ name: 'confidence', type: 'numeric', precision: 3, scale: 2 })
  confidence!: string

  @Property({ name: 'detected_language', type: 'text', nullable: true })
  detectedLanguage?: string | null

  @Property({ name: 'status', type: 'text' })
  status: InboxProposalStatus = 'pending'

  @Property({ name: 'possibly_incomplete', type: 'boolean', default: false })
  possiblyIncomplete: boolean = false

  @Property({ name: 'reviewed_by_user_id', type: 'uuid', nullable: true })
  reviewedByUserId?: string | null

  @Property({ name: 'reviewed_at', type: Date, nullable: true })
  reviewedAt?: Date | null

  @Property({ name: 'llm_model', type: 'text', nullable: true })
  llmModel?: string | null

  @Property({ name: 'llm_tokens_used', type: 'integer', nullable: true })
  llmTokensUsed?: number | null

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'metadata', type: 'json', nullable: true })
  metadata?: Record<string, unknown> | null

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

// ---------------------------------------------------------------------------
// InboxProposalAction
// ---------------------------------------------------------------------------

@Entity({ tableName: 'inbox_proposal_actions' })
@Index({ properties: ['proposalId'] })
@Index({ properties: ['organizationId', 'tenantId', 'status'] })
export class InboxProposalAction {
  [OptionalProps]?: 'status' | 'isActive' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'proposal_id', type: 'uuid' })
  proposalId!: string

  @Property({ name: 'sort_order', type: 'integer' })
  sortOrder!: number

  @Property({ name: 'action_type', type: 'text' })
  actionType!: InboxActionType

  @Property({ name: 'description', type: 'text' })
  description!: string

  @Property({ name: 'payload', type: 'json' })
  payload!: Record<string, unknown>

  @Property({ name: 'status', type: 'text' })
  status: InboxActionStatus = 'pending'

  @Property({ name: 'confidence', type: 'numeric', precision: 3, scale: 2 })
  confidence!: string

  @Property({ name: 'required_feature', type: 'text', nullable: true })
  requiredFeature?: string | null

  @Property({ name: 'matched_entity_id', type: 'uuid', nullable: true })
  matchedEntityId?: string | null

  @Property({ name: 'matched_entity_type', type: 'text', nullable: true })
  matchedEntityType?: string | null

  @Property({ name: 'created_entity_id', type: 'uuid', nullable: true })
  createdEntityId?: string | null

  @Property({ name: 'created_entity_type', type: 'text', nullable: true })
  createdEntityType?: string | null

  @Property({ name: 'execution_error', type: 'text', nullable: true })
  executionError?: string | null

  @Property({ name: 'executed_at', type: Date, nullable: true })
  executedAt?: Date | null

  @Property({ name: 'executed_by_user_id', type: 'uuid', nullable: true })
  executedByUserId?: string | null

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'metadata', type: 'json', nullable: true })
  metadata?: Record<string, unknown> | null

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

// ---------------------------------------------------------------------------
// InboxDiscrepancy
// ---------------------------------------------------------------------------

@Entity({ tableName: 'inbox_discrepancies' })
@Index({ properties: ['proposalId'] })
export class InboxDiscrepancy {
  [OptionalProps]?: 'resolved' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'proposal_id', type: 'uuid' })
  proposalId!: string

  @Property({ name: 'action_id', type: 'uuid', nullable: true })
  actionId?: string | null

  @Property({ name: 'type', type: 'text' })
  type!: InboxDiscrepancyType

  @Property({ name: 'severity', type: 'text' })
  severity!: 'warning' | 'error'

  @Property({ name: 'description', type: 'text' })
  description!: string

  @Property({ name: 'expected_value', type: 'text', nullable: true })
  expectedValue?: string | null

  @Property({ name: 'found_value', type: 'text', nullable: true })
  foundValue?: string | null

  @Property({ name: 'resolved', type: 'boolean', default: false })
  resolved: boolean = false

  @Property({ name: 'metadata', type: 'json', nullable: true })
  metadata?: Record<string, unknown> | null

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}
