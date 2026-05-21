import { Entity, Index, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy'

export type FormStatus = 'draft' | 'active' | 'archived'
export type FormVersionStatus = 'draft' | 'published' | 'archived'
export type FormSubmissionStatus = 'draft' | 'submitted' | 'reopened' | 'archived'
export type FormSubmissionRevisionChangeSource = 'user' | 'admin' | 'system'

@Entity({ tableName: 'forms_form' })
@Unique({ name: 'forms_form_org_key_unique', properties: ['organizationId', 'key'] })
@Index({ name: 'forms_form_org_status_idx', properties: ['organizationId', 'status'] })
@Index({ name: 'forms_form_org_tenant_deleted_idx', properties: ['organizationId', 'tenantId', 'deletedAt'] })
export class Form {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'key', type: 'text' })
  key!: string

  @Property({ name: 'name', type: 'text' })
  name!: string

  @Property({ name: 'description', type: 'text', nullable: true })
  description?: string | null

  @Property({ name: 'status', type: 'text', default: 'draft' })
  status: FormStatus = 'draft'

  @Property({ name: 'current_published_version_id', type: 'uuid', nullable: true })
  currentPublishedVersionId?: string | null

  @Property({ name: 'default_locale', type: 'text' })
  defaultLocale!: string

  @Property({ name: 'supported_locales', type: 'text[]' })
  supportedLocales!: string[]

  @Property({ name: 'created_by', type: 'uuid' })
  createdBy!: string

  @Property({ name: 'archived_at', type: Date, nullable: true })
  archivedAt?: Date | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'forms_form_version' })
@Unique({ name: 'forms_form_version_form_id_version_number_unique', properties: ['formId', 'versionNumber'] })
@Index({ name: 'forms_form_version_form_id_status_idx', properties: ['formId', 'status'] })
@Index({ name: 'forms_form_version_org_tenant_idx', properties: ['organizationId', 'tenantId'] })
export class FormVersion {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'form_id', type: 'uuid' })
  formId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'version_number', type: 'int' })
  versionNumber!: number

  @Property({ name: 'status', type: 'text', default: 'draft' })
  status: FormVersionStatus = 'draft'

  @Property({ name: 'schema', type: 'json' })
  schema!: Record<string, unknown>

  @Property({ name: 'ui_schema', type: 'json' })
  uiSchema!: Record<string, unknown>

  @Property({ name: 'roles', type: 'json' })
  roles!: string[]

  @Property({ name: 'schema_hash', type: 'text' })
  schemaHash!: string

  @Property({ name: 'registry_version', type: 'text' })
  registryVersion!: string

  @Property({ name: 'published_at', type: Date, nullable: true })
  publishedAt?: Date | null

  @Property({ name: 'published_by', type: 'uuid', nullable: true })
  publishedBy?: string | null

  @Property({ name: 'changelog', type: 'text', nullable: true })
  changelog?: string | null

  @Property({ name: 'archived_at', type: Date, nullable: true })
  archivedAt?: Date | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

/**
 * Form submission — a fillable artifact bound to a pinned form_version.
 *
 * Phase 1c entity. Subject identifiers (`subjectType`, `subjectId`) are kept
 * polymorphic and validated at the application layer; cross-module ORM
 * relations are intentionally avoided. The `currentRevisionId` advances on
 * every successful save.
 */
@Entity({ tableName: 'forms_form_submission' })
@Index({ name: 'forms_form_submission_org_version_status_idx', properties: ['organizationId', 'formVersionId', 'status'] })
@Index({ name: 'forms_form_submission_subject_idx', properties: ['subjectType', 'subjectId'] })
@Index({ name: 'forms_form_submission_org_submitted_at_idx', properties: ['organizationId', 'submittedAt'] })
@Index({ name: 'forms_form_submission_org_tenant_deleted_idx', properties: ['organizationId', 'tenantId', 'deletedAt'] })
export class FormSubmission {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'form_version_id', type: 'uuid' })
  formVersionId!: string

  @Property({ name: 'subject_type', type: 'text' })
  subjectType!: string

  @Property({ name: 'subject_id', type: 'uuid' })
  subjectId!: string

  @Property({ name: 'status', type: 'text', default: 'draft' })
  status: FormSubmissionStatus = 'draft'

  @Property({ name: 'current_revision_id', type: 'uuid', nullable: true })
  currentRevisionId?: string | null

  @Property({ name: 'started_by', type: 'uuid' })
  startedBy!: string

  @Property({ name: 'submitted_by', type: 'uuid', nullable: true })
  submittedBy?: string | null

  @Property({ name: 'first_saved_at', type: Date, onCreate: () => new Date() })
  firstSavedAt: Date = new Date()

  @Property({ name: 'submitted_at', type: Date, nullable: true })
  submittedAt?: Date | null

  @Property({ name: 'submit_metadata', type: 'json', nullable: true })
  submitMetadata?: Record<string, unknown> | null

  @Property({ name: 'pdf_snapshot_attachment_id', type: 'uuid', nullable: true })
  pdfSnapshotAttachmentId?: string | null

  @Property({ name: 'anonymized_at', type: Date, nullable: true })
  anonymizedAt?: Date | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

/**
 * Form submission actor — an active or revoked role assignment for a
 * (submission, user) pair. The same user may be assigned multiple roles, but
 * only one *active* row per (submission, user) is permitted via partial
 * unique index where `revoked_at IS NULL` (enforced in the migration).
 */
@Entity({ tableName: 'forms_form_submission_actor' })
@Index({ name: 'forms_form_submission_actor_submission_role_idx', properties: ['submissionId', 'role'] })
@Index({ name: 'forms_form_submission_actor_org_idx', properties: ['organizationId'] })
export class FormSubmissionActor {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'submission_id', type: 'uuid' })
  submissionId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'user_id', type: 'uuid' })
  userId!: string

  @Property({ name: 'role', type: 'text' })
  role!: string

  @Property({ name: 'assigned_at', type: Date, onCreate: () => new Date() })
  assignedAt: Date = new Date()

  @Property({ name: 'revoked_at', type: Date, nullable: true })
  revokedAt?: Date | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

/**
 * Form submission revision — append-only revision chain for a submission.
 *
 * Invariants (enforced at the service layer; the only allowed UPDATE paths
 * are the anonymization tombstone (phase 2b) and the coalesce-after-cap
 * branch in `SubmissionService.save` when `revision_number` would exceed
 * `FORMS_REVISION_CAP`). Never DELETE.
 *
 * The `data` column is an envelope ciphertext managed directly by the
 * forms-module `EncryptionService` — NOT the global `findWithDecryption`
 * pipeline. The header self-describes the key version
 * (`version(2B) | key_version(2B) | iv(12B) | ciphertext | tag(16B)`).
 */
@Entity({ tableName: 'forms_form_submission_revision' })
@Index({ name: 'forms_form_submission_revision_submission_idx', properties: ['submissionId', 'revisionNumber'] })
@Index({ name: 'forms_form_submission_revision_org_saved_idx', properties: ['organizationId', 'savedAt'] })
export class FormSubmissionRevision {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'submission_id', type: 'uuid' })
  submissionId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'revision_number', type: 'int' })
  revisionNumber!: number

  // Envelope-encrypted JSON payload — see EncryptionService for the format.
  @Property({ name: 'data', type: 'bytea' })
  data!: Buffer

  @Property({ name: 'encryption_key_version', type: 'int' })
  encryptionKeyVersion!: number

  @Property({ name: 'saved_at', type: Date, onCreate: () => new Date() })
  savedAt: Date = new Date()

  @Property({ name: 'saved_by', type: 'uuid' })
  savedBy!: string

  @Property({ name: 'saved_by_role', type: 'text' })
  savedByRole!: string

  @Property({ name: 'change_source', type: 'text', default: 'user' })
  changeSource: FormSubmissionRevisionChangeSource = 'user'

  @Property({ name: 'changed_field_keys', type: 'text[]' })
  changedFieldKeys: string[] = []

  @Property({ name: 'change_summary', type: 'text', nullable: true })
  changeSummary?: string | null

  @Property({ name: 'anonymized_at', type: Date, nullable: true })
  anonymizedAt?: Date | null
}

/**
 * Per-tenant envelope-encryption key. Stores the KMS-wrapped DEK; one row
 * per (organization_id, key_version). On rotate, the previous row is marked
 * `retired_at = now()` and a fresh row with `key_version + 1` is inserted.
 */
@Entity({ tableName: 'forms_encryption_key' })
@Unique({ name: 'forms_encryption_key_org_version_unique', properties: ['organizationId', 'keyVersion'] })
export class FormsEncryptionKey {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'key_version', type: 'int' })
  keyVersion!: number

  @Property({ name: 'wrapped_dek', type: 'bytea' })
  wrappedDek!: Buffer

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'retired_at', type: Date, nullable: true })
  retiredAt?: Date | null
}

export type FormAccessAuditPurpose = 'view' | 'export' | 'revert' | 'anonymize' | 'reopen'
export type FormAttachmentKind = 'user_upload' | 'snapshot' | 'generated'

/**
 * Per-admin-read audit row. Written by `AccessAuditLogger` for every
 * admin-surface read of a submission. The body never contains payload
 * values — only metadata (user, purpose, IP, UA, optional `revision_id`).
 *
 * Runtime (patient/customer) reads of one's own submission do NOT write
 * audit rows — phase 1c R1 posture.
 */
@Entity({ tableName: 'forms_form_access_audit' })
@Index({ name: 'forms_access_audit_submission_idx', properties: ['submissionId', 'accessedAt'] })
@Index({ name: 'forms_access_audit_org_idx', properties: ['organizationId', 'accessedAt'] })
export class FormAccessAudit {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'submission_id', type: 'uuid' })
  submissionId!: string

  @Property({ name: 'accessed_by', type: 'uuid' })
  accessedBy!: string

  @Property({ name: 'accessed_at', type: Date, onCreate: () => new Date() })
  accessedAt: Date = new Date()

  @Property({ name: 'access_purpose', type: 'text' })
  accessPurpose!: FormAccessAuditPurpose

  @Property({ name: 'ip', type: 'text', nullable: true })
  ip?: string | null

  @Property({ name: 'ua', type: 'text', nullable: true })
  ua?: string | null

  @Property({ name: 'revision_id', type: 'uuid', nullable: true })
  revisionId?: string | null
}

/**
 * Form attachment indirection — links a submission/field to a stored file.
 *
 * `kind` distinguishes user uploads (phase 2c file field) from the
 * single PDF snapshot generated at submit time (phase 2b) or other
 * system-generated artifacts. The `file_id` references the project's
 * files-module storage; `payload_inline` is a short-circuit field for
 * deployments without a files module — phase 2b's PdfSnapshotRenderer
 * uses one or the other depending on which is wired in DI.
 *
 * `removed_at` lets phase 2c soft-remove user uploads on revoke/replace
 * without destroying the audit chain.
 */
@Entity({ tableName: 'forms_form_attachment' })
@Index({ name: 'forms_attachment_submission_field_idx', properties: ['submissionId', 'fieldKey'] })
@Index({ name: 'forms_attachment_org_kind_idx', properties: ['organizationId', 'kind'] })
export class FormAttachment {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'submission_id', type: 'uuid' })
  submissionId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'field_key', type: 'text' })
  fieldKey!: string

  @Property({ name: 'kind', type: 'text' })
  kind!: FormAttachmentKind

  // FK id to the project's files module (nullable when storage is inline).
  @Property({ name: 'file_id', type: 'uuid', nullable: true })
  fileId?: string | null

  // Inline payload bytes for deployments without a files module. Use
  // sparingly — large blobs belong in object storage.
  @Property({ name: 'payload_inline', type: 'bytea', nullable: true })
  payloadInline?: Buffer | null

  @Property({ name: 'content_type', type: 'text', nullable: true })
  contentType?: string | null

  @Property({ name: 'filename', type: 'text', nullable: true })
  filename?: string | null

  @Property({ name: 'size_bytes', type: 'int', nullable: true })
  sizeBytes?: number | null

  @Property({ name: 'uploaded_by', type: 'uuid', nullable: true })
  uploadedBy?: string | null

  @Property({ name: 'uploaded_at', type: Date, onCreate: () => new Date() })
  uploadedAt: Date = new Date()

  @Property({ name: 'removed_at', type: Date, nullable: true })
  removedAt?: Date | null
}

export type FormDistributionMode = 'open' | 'personal'
export type FormDistributionStatus = 'active' | 'paused' | 'closed'

/**
 * Form distribution — a publishable channel that exposes a form to external
 * participants. `mode = 'open'` opens an anonymous public link keyed by
 * `public_slug`; `mode = 'personal'` issues per-recipient invitations
 * (`forms_invitation`). `pinned_version_id` optionally locks the served
 * version; when null the distribution serves the form's current published
 * version. Cross-module identifiers (`form_id`, `pinned_version_id`) are plain
 * uuid columns — no ORM relations.
 *
 * The `forms_distribution_org_public_slug_idx` index backs the partial unique
 * index on (organization_id, public_slug) WHERE public_slug IS NOT NULL —
 * declared in the migration SQL because the partial predicate cannot be
 * expressed via the @Unique decorator.
 */
@Entity({ tableName: 'forms_distribution' })
@Index({ name: 'forms_distribution_org_public_slug_idx', properties: ['organizationId', 'publicSlug'] })
@Index({ name: 'forms_distribution_org_form_idx', properties: ['organizationId', 'formId'] })
@Index({ name: 'forms_distribution_org_status_idx', properties: ['organizationId', 'status'] })
export class FormDistribution {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'form_id', type: 'uuid' })
  formId!: string

  @Property({ name: 'pinned_version_id', type: 'uuid', nullable: true })
  pinnedVersionId?: string | null

  @Property({ name: 'mode', type: 'text' })
  mode!: FormDistributionMode

  @Property({ name: 'public_slug', type: 'text', nullable: true })
  publicSlug?: string | null

  @Property({ name: 'status', type: 'text', default: 'active' })
  status: FormDistributionStatus = 'active'

  @Property({ name: 'title', type: 'text', nullable: true })
  title?: string | null

  @Property({ name: 'default_locale', type: 'text' })
  defaultLocale!: string

  @Property({ name: 'require_customer_auth', type: 'boolean', default: false })
  requireCustomerAuth: boolean = false

  @Property({ name: 'allow_multiple_submissions', type: 'boolean', default: false })
  allowMultipleSubmissions: boolean = false

  @Property({ name: 'max_responses', type: 'int', nullable: true })
  maxResponses?: number | null

  @Property({ name: 'response_count', type: 'int', default: 0 })
  responseCount: number = 0

  @Property({ name: 'opens_at', type: Date, nullable: true })
  opensAt?: Date | null

  @Property({ name: 'closes_at', type: Date, nullable: true })
  closesAt?: Date | null

  @Property({ name: 'redirect_url', type: 'text', nullable: true })
  redirectUrl?: string | null

  @Property({ name: 'settings', type: 'json', nullable: true })
  settings?: Record<string, unknown> | null

  @Property({ name: 'created_by', type: 'uuid' })
  createdBy!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

export type FormInvitationStatus =
  | 'pending'
  | 'sent'
  | 'opened'
  | 'started'
  | 'submitted'
  | 'expired'
  | 'revoked'

/**
 * Form invitation — a per-recipient handle for a `personal`-mode
 * distribution. The row `id` doubles as the anonymous participant principal
 * (the subject identifier on the resulting submission), so the invitation
 * itself is the identity anchor for an unauthenticated respondent.
 *
 * `recipient_email` / `recipient_name` are PII routed through the global
 * `findWithDecryption` pipeline (declared in `encryption.ts`). `token_hash`
 * stores a one-way hash of the bearer token — never the raw token; its
 * partial unique index (WHERE token_hash IS NOT NULL) is declared in the
 * migration SQL. Cross-module identifiers (`distribution_id`,
 * `submission_id`, `recipient_ref`) are plain columns — no ORM relations.
 */
@Entity({ tableName: 'forms_invitation' })
@Index({ name: 'forms_invitation_distribution_status_idx', properties: ['distributionId', 'status'] })
@Index({ name: 'forms_invitation_org_submission_idx', properties: ['organizationId', 'submissionId'] })
@Index({ name: 'forms_invitation_token_hash_idx', properties: ['tokenHash'] })
export class FormInvitation {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'distribution_id', type: 'uuid' })
  distributionId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'recipient_email', type: 'text', nullable: true })
  recipientEmail?: string | null

  @Property({ name: 'recipient_name', type: 'text', nullable: true })
  recipientName?: string | null

  @Property({ name: 'recipient_ref', type: 'text', nullable: true })
  recipientRef?: string | null

  @Property({ name: 'role', type: 'text', nullable: true })
  role?: string | null

  @Property({ name: 'token_hash', type: 'text', nullable: true })
  tokenHash?: string | null

  @Property({ name: 'status', type: 'text', default: 'pending' })
  status: FormInvitationStatus = 'pending'

  @Property({ name: 'submission_id', type: 'uuid', nullable: true })
  submissionId?: string | null

  @Property({ name: 'locale', type: 'text', nullable: true })
  locale?: string | null

  @Property({ name: 'expires_at', type: Date, nullable: true })
  expiresAt?: Date | null

  @Property({ name: 'sent_at', type: Date, nullable: true })
  sentAt?: Date | null

  @Property({ name: 'opened_at', type: Date, nullable: true })
  openedAt?: Date | null

  @Property({ name: 'started_at', type: Date, nullable: true })
  startedAt?: Date | null

  @Property({ name: 'submitted_at', type: Date, nullable: true })
  submittedAt?: Date | null

  @Property({ name: 'send_count', type: 'int', default: 0 })
  sendCount: number = 0

  @Property({ name: 'last_error', type: 'text', nullable: true })
  lastError?: string | null

  @Property({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}
