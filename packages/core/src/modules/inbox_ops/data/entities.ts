import { OptionalProps } from '@mikro-orm/core'
import { Entity, Index, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy'

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

export interface ProposalTranslationEntry {
  summary: string
  actions: Record<string, string>
  translatedAt: string
}

export type ProposalTranslations = Record<string, ProposalTranslationEntry>

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
export type InboxProposalCategory =
  | 'rfq'
  | 'order'
  | 'order_update'
  | 'complaint'
  | 'shipping_update'
  | 'inquiry'
  | 'payment'
  | 'other'
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
export type InboxEmailAttachmentsStatus = 'pending' | 'processing' | 'completed'
export type InboxEmailAttachmentDisposition = 'attachment' | 'inline'
export type InboxEmailAttachmentStatus = 'pending' | 'stored' | 'skipped' | 'failed' | 'released'
export type InboxEmailAttachmentReason =
  | 'inline_decoration'
  | 'too_many'
  | 'too_large'
  | 'total_too_large'
  | 'dangerous_executable'
  | 'active_content'
  | 'unguarded_reader'
  | 'quota_exceeded'
  | 'partition_unavailable'
  | 'fetch_failed'
  | 'store_failed'
  | 'processing_failed'
  | 'ingest_timeout'

export interface InboxProposalActionSourceRef {
  kind: 'email_body' | 'attachment'
  attachmentId?: string
  fileName?: string
  page?: number
  sheet?: string
  row?: number
  snippet: string
}
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
  [OptionalProps]?: 'isActive' | 'workingLanguage' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'inbox_address', type: 'text' })
  inboxAddress!: string

  // Per-tenant inbound-webhook secret. When set, custom-provider webhook
  // signatures for this inbox MUST verify against THIS secret (not the global
  // INBOX_OPS_WEBHOOK_SECRET), binding the shared signing key to a single
  // tenant and preventing cross-tenant injection by a holder of the global key.
  @Property({ name: 'webhook_secret', type: 'text', nullable: true })
  webhookSecret?: string | null

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'working_language', type: 'text', default: 'en' })
  workingLanguage: string = 'en'

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
// Stranded-ingest lookups of the webhook catch-up and the maintenance sweep.
@Index({ properties: ['attachmentsStatus', 'attachmentsNextRunAt'] })
@Index({ properties: ['attachmentsStatus', 'attachmentsClaimedAt'] })
// Deleted emails whose attachments still await release: the deny set of the
// `inbox_ops.email-attachments` access resolver and the release sweep. Emails
// deleted before attachment ingestion existed have neither column set and never
// enter it.
@Index({
  name: 'inbox_emails_attachments_release_pending_idx',
  expression:
    `create index "inbox_emails_attachments_release_pending_idx" on "inbox_emails" ("tenant_id", "organization_id") where deleted_at is not null and attachments_released_at is null and (attachments_status is not null or attachments_release_requested_at is not null)`,
})
export class InboxEmail {
  [OptionalProps]?: 'status' | 'isActive' | 'attachmentsIngestGeneration' | 'attachmentsCurrentGeneration' | 'createdAt' | 'updatedAt' | 'deletedAt'

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

  // Attachment ingestion state. `null` for emails without ingested attachments
  // and for emails received before ingestion existed. Everything below except
  // `attachmentsStatus` is internal and never serialized (`api/emails/response.ts`).
  @Property({ name: 'attachments_status', type: 'text', nullable: true })
  attachmentsStatus?: InboxEmailAttachmentsStatus | null

  @Property({ name: 'attachments_claim_token', type: 'uuid', nullable: true })
  attachmentsClaimToken?: string | null

  @Property({ name: 'attachments_claimed_at', type: Date, nullable: true })
  attachmentsClaimedAt?: Date | null

  @Property({ name: 'attachments_first_failure_at', type: Date, nullable: true })
  attachmentsFirstFailureAt?: Date | null

  @Property({ name: 'attachments_release_requested_at', type: Date, nullable: true })
  attachmentsReleaseRequestedAt?: Date | null

  @Property({ name: 'attachments_released_at', type: Date, nullable: true })
  attachmentsReleasedAt?: Date | null

  // Reserved by every ingest enqueue.
  @Property({ name: 'attachments_ingest_generation', type: 'integer', nullable: true, default: 0 })
  attachmentsIngestGeneration: number | null = 0

  // Confirmed once an enqueue succeeded; only the job carrying it may run.
  @Property({ name: 'attachments_current_generation', type: 'integer', nullable: true, default: 0 })
  attachmentsCurrentGeneration: number | null = 0

  // When the current ingest job is due to start.
  @Property({ name: 'attachments_next_run_at', type: Date, nullable: true })
  attachmentsNextRunAt?: Date | null

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
// InboxEmailAttachment — per-part ingestion ledger of an InboxEmail
// ---------------------------------------------------------------------------

@Entity({ tableName: 'inbox_email_attachments' })
@Index({ name: 'inbox_email_attachments_scope_email_idx', properties: ['organizationId', 'tenantId', 'inboxEmailId'] })
@Unique({ name: 'inbox_email_attachments_email_part_key_unique', properties: ['inboxEmailId', 'partKey'] })
export class InboxEmailAttachment {
  [OptionalProps]?: 'attempts' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'inbox_email_id', type: 'uuid' })
  inboxEmailId!: string

  // `resend:<attachment id>`
  @Property({ name: 'part_key', type: 'text' })
  partKey!: string

  // Original name for display (encrypted); cleared on release.
  @Property({ name: 'file_name', type: 'text', nullable: true })
  fileName?: string | null

  @Property({ name: 'declared_mime_type', type: 'text', nullable: true })
  declaredMimeType?: string | null

  // Sniffed type returned by `attachmentService.createScoped`.
  @Property({ name: 'mime_type', type: 'text', nullable: true })
  mimeType?: string | null

  @Property({ name: 'size_bytes', type: 'integer', nullable: true })
  sizeBytes?: number | null

  @Property({ name: 'content_id', type: 'text', nullable: true })
  contentId?: string | null

  // Acquisitions of the part interrupted by a crash.
  @Property({ name: 'attempts', type: 'integer', default: 0 })
  attempts: number = 0

  // Set before the first provider call for the part, cleared when its attempt ends.
  @Property({ name: 'in_flight_at', type: Date, nullable: true })
  inFlightAt?: Date | null

  @Property({ name: 'disposition', type: 'text' })
  disposition!: InboxEmailAttachmentDisposition

  @Property({ name: 'status', type: 'text' })
  status!: InboxEmailAttachmentStatus

  @Property({ name: 'reason', type: 'text', nullable: true })
  reason?: InboxEmailAttachmentReason | null

  // Id of the stored `attachments` row (no ORM relation across modules).
  @Property({ name: 'attachment_id', type: 'uuid', nullable: true })
  attachmentId?: string | null

  // Text extracted at upload (encrypted); cleared on release.
  @Property({ name: 'extracted_text', type: 'text', nullable: true })
  extractedText?: string | null

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
@Index({ properties: ['organizationId', 'tenantId', 'category'] })
@Index({ properties: ['inboxEmailId'] })
export class InboxProposal {
  [OptionalProps]?: 'status' | 'category' | 'possiblyIncomplete' | 'workingLanguage' | 'translations' | 'isActive' | 'createdAt' | 'updatedAt' | 'deletedAt'

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

  @Property({ name: 'category', type: 'text', nullable: true })
  category?: InboxProposalCategory | null

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

  @Property({ name: 'working_language', type: 'text', nullable: true })
  workingLanguage?: string | null

  @Property({ name: 'translations', type: 'json', nullable: true })
  translations?: ProposalTranslations | null

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

  // Field-level provenance of the proposed values (encrypted; quotes mail content).
  @Property({ name: 'source_refs', type: 'json', nullable: true })
  sourceRefs?: InboxProposalActionSourceRef[] | null

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
@Index({ properties: ['organizationId', 'tenantId'] })
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
