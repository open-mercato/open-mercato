import { OptionalProps } from '@mikro-orm/core'
import { Entity, Index, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy'

export type DocumentSharePrincipalType = 'user' | 'role'
export type DocumentSharePermission = 'viewer' | 'commenter' | 'editor'

@Entity({ tableName: 'documents' })
@Index({ name: 'documents_scope_idx', properties: ['organizationId', 'tenantId', 'deletedAt'] })
@Index({ name: 'documents_folder_idx', properties: ['folderId'] })
@Index({ name: 'documents_owner_idx', properties: ['ownerUserId'] })
export class Document {
  [OptionalProps]?: 'folderId' | 'isActive' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ type: 'varchar', length: 512 })
  title!: string

  @Property({ name: 'folder_id', type: 'uuid', nullable: true })
  folderId?: string | null

  @Property({ name: 'owner_user_id', type: 'uuid' })
  ownerUserId!: string

  @Property({ name: 'created_by_user_id', type: 'uuid' })
  createdByUserId!: string

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'document_contents' })
@Index({ name: 'document_contents_scope_idx', properties: ['organizationId', 'tenantId'] })
@Unique({ name: 'document_contents_document_unique', properties: ['documentId'] })
export class DocumentContent {
  [OptionalProps]?: 'yjsState' | 'contentHtml' | 'contentText' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'document_id', type: 'uuid' })
  documentId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'yjs_state', type: 'blob', nullable: true })
  yjsState?: Buffer | null

  @Property({ name: 'content_html', type: 'text', nullable: true })
  contentHtml?: string | null

  @Property({ name: 'content_text', type: 'text', nullable: true })
  contentText?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'document_folders' })
@Index({ name: 'document_folders_scope_idx', properties: ['organizationId', 'tenantId', 'deletedAt'] })
@Index({ name: 'document_folders_parent_idx', properties: ['parentFolderId'] })
@Index({ name: 'document_folders_owner_idx', properties: ['ownerUserId'] })
export class DocumentFolder {
  [OptionalProps]?: 'parentFolderId' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ type: 'varchar', length: 256 })
  name!: string

  @Property({ name: 'parent_folder_id', type: 'uuid', nullable: true })
  parentFolderId?: string | null

  @Property({ name: 'owner_user_id', type: 'uuid' })
  ownerUserId!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'document_shares' })
@Index({ name: 'document_shares_scope_idx', properties: ['organizationId', 'tenantId', 'deletedAt'] })
@Index({ name: 'document_shares_document_idx', properties: ['documentId'] })
@Index({
  name: 'document_shares_active_principal_unique',
  expression:
    `create unique index "document_shares_active_principal_unique" on "document_shares" ("document_id", "principal_type", "principal_id") where "deleted_at" is null`,
})
export class DocumentShare {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'document_id', type: 'uuid' })
  documentId!: string

  @Property({ name: 'principal_type', type: 'varchar', length: 16 })
  principalType!: DocumentSharePrincipalType

  @Property({ name: 'principal_id', type: 'uuid' })
  principalId!: string

  @Property({ type: 'varchar', length: 16 })
  permission!: DocumentSharePermission

  @Property({ name: 'created_by_user_id', type: 'uuid' })
  createdByUserId!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'document_comments' })
@Index({ name: 'document_comments_scope_idx', properties: ['organizationId', 'tenantId', 'deletedAt'] })
@Index({ name: 'document_comments_document_idx', properties: ['documentId'] })
@Index({ name: 'document_comments_parent_idx', properties: ['parentCommentId'] })
export class DocumentComment {
  [OptionalProps]?:
    | 'parentCommentId'
    | 'anchor'
    | 'mentions'
    | 'resolvedAt'
    | 'resolvedByUserId'
    | 'createdAt'
    | 'updatedAt'
    | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'document_id', type: 'uuid' })
  documentId!: string

  @Property({ name: 'parent_comment_id', type: 'uuid', nullable: true })
  parentCommentId?: string | null

  @Property({ name: 'author_user_id', type: 'uuid' })
  authorUserId!: string

  @Property({ type: 'text' })
  body!: string

  @Property({ type: 'json', nullable: true })
  anchor?: Record<string, unknown> | null

  @Property({ name: 'mentions', type: 'json', nullable: true })
  mentions?: { userId: string }[] | null

  @Property({ name: 'resolved_at', type: Date, nullable: true })
  resolvedAt?: Date | null

  @Property({ name: 'resolved_by_user_id', type: 'uuid', nullable: true })
  resolvedByUserId?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'document_versions' })
@Index({ name: 'document_versions_scope_idx', properties: ['organizationId', 'tenantId'] })
@Index({ name: 'document_versions_document_idx', properties: ['documentId', 'createdAt'] })
export class DocumentVersion {
  [OptionalProps]?: 'label' | 'contentHtml' | 'createdAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'document_id', type: 'uuid' })
  documentId!: string

  @Property({ type: 'varchar', length: 256, nullable: true })
  label?: string | null

  @Property({ name: 'yjs_snapshot', type: 'blob' })
  yjsSnapshot!: Buffer

  @Property({ name: 'content_html', type: 'text', nullable: true })
  contentHtml?: string | null

  @Property({ name: 'created_by_user_id', type: 'uuid' })
  createdByUserId!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

@Entity({ tableName: 'document_attachments' })
@Index({ name: 'document_attachments_scope_idx', properties: ['organizationId', 'tenantId', 'deletedAt'] })
@Index({ name: 'document_attachments_document_idx', properties: ['documentId'] })
@Index({ name: 'document_attachments_attachment_idx', properties: ['attachmentId'] })
export class DocumentAttachment {
  [OptionalProps]?: 'createdAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'document_id', type: 'uuid' })
  documentId!: string

  @Property({ name: 'attachment_id', type: 'uuid' })
  attachmentId!: string

  @Property({ name: 'created_by_user_id', type: 'uuid' })
  createdByUserId!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'document_templates' })
@Index({ name: 'document_templates_scope_idx', properties: ['organizationId', 'tenantId', 'deletedAt'] })
export class DocumentTemplate {
  [OptionalProps]?: 'description' | 'contextSlots' | 'isActive' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ type: 'varchar', length: 256 })
  name!: string

  @Property({ type: 'text', nullable: true })
  description?: string | null

  @Property({ name: 'body_html', type: 'text' })
  bodyHtml!: string

  @Property({ name: 'context_slots', type: 'json', nullable: true })
  contextSlots?: { slot: string; entityType: string; required?: boolean }[] | null

  @Property({ name: 'created_by_user_id', type: 'uuid' })
  createdByUserId!: string

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

export default [
  Document,
  DocumentContent,
  DocumentFolder,
  DocumentShare,
  DocumentComment,
  DocumentVersion,
  DocumentAttachment,
  DocumentTemplate,
]
