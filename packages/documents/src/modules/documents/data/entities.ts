import { OptionalProps } from '@mikro-orm/core'
import { Check, Entity, Index, ManyToOne, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy'
import { preserveMonotonicDocumentVersionOnUpdate } from '../lib/versioning'

export type DocumentSharePrincipalType = 'user' | 'role'
export type DocumentSharePermission = 'viewer' | 'commenter' | 'editor'
export type DocumentEntityLinkCustomerKind = 'person' | 'company'
export type DocumentEntityLinkSource = 'chip' | 'template' | 'related-panel'

@Entity({ tableName: 'documents' })
@Index({ name: 'documents_scope_idx', properties: ['organizationId', 'tenantId', 'deletedAt'] })
@Index({ name: 'documents_folder_idx', properties: ['folderId'] })
@Index({ name: 'documents_owner_idx', properties: ['ownerUserId'] })
@Index({
  name: 'documents_list_sort_idx',
  expression:
    'create index "documents_list_sort_idx" on "documents" ("organization_id", "tenant_id", "updated_at") where "deleted_at" is null',
})
export class Document {
  [OptionalProps]?: 'folderId' | 'isActive' | 'archivedAt' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ type: 'varchar', length: 512 })
  title!: string

  @ManyToOne(() => DocumentFolder, {
    fieldName: 'folder_id',
    mapToPk: true,
    nullable: true,
    deleteRule: 'set null',
  })
  folderId?: string | null

  @Property({ name: 'owner_user_id', type: 'uuid' })
  ownerUserId!: string

  @Property({ name: 'created_by_user_id', type: 'uuid' })
  createdByUserId!: string

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'archived_at', type: Date, nullable: true })
  archivedAt?: Date | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: preserveMonotonicDocumentVersionOnUpdate })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'document_contents' })
@Index({ name: 'document_contents_scope_idx', properties: ['organizationId', 'tenantId'] })
@Unique({ name: 'document_contents_document_unique', properties: ['documentId'] })
export class DocumentContent {
  [OptionalProps]?:
    | 'yjsState'
    | 'contentHtml'
    | 'contentText'
    | 'collaborationGeneration'
    | 'createdAt'
    | 'updatedAt'
    | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @ManyToOne(() => Document, { fieldName: 'document_id', mapToPk: true, deleteRule: 'cascade' })
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

  /**
   * Server-owned identity for the current collaborative content lineage.
   * Normal Yjs stores preserve it; authoritative replacements and lifecycle
   * resets advance it while holding the content-row lock.
   */
  @Property({ name: 'collaboration_generation', type: 'integer', default: 1 })
  collaborationGeneration: number = 1

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: preserveMonotonicDocumentVersionOnUpdate })
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

  @ManyToOne(() => DocumentFolder, {
    fieldName: 'parent_folder_id',
    mapToPk: true,
    nullable: true,
    deleteRule: 'set null',
  })
  parentFolderId?: string | null

  @Property({ name: 'owner_user_id', type: 'uuid' })
  ownerUserId!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: preserveMonotonicDocumentVersionOnUpdate })
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

  @ManyToOne(() => Document, { fieldName: 'document_id', mapToPk: true, deleteRule: 'cascade' })
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

  @Property({ name: 'updated_at', type: Date, onUpdate: preserveMonotonicDocumentVersionOnUpdate })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'document_favorites' })
@Index({
  name: 'document_favorites_active_user_uq',
  expression:
    'create unique index "document_favorites_active_user_uq" on "document_favorites" ("document_id", "user_id") where "deleted_at" is null',
})
@Index({
  name: 'document_favorites_user_lookup_idx',
  properties: ['tenantId', 'organizationId', 'userId'],
})
export class DocumentFavorite {
  [OptionalProps]?: 'createdAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @ManyToOne(() => Document, { fieldName: 'document_id', mapToPk: true, deleteRule: 'cascade' })
  documentId!: string

  @Property({ name: 'user_id', type: 'uuid' })
  userId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'document_watchers' })
@Index({
  name: 'document_watchers_active_user_uq',
  expression:
    'create unique index "document_watchers_active_user_uq" on "document_watchers" ("document_id", "user_id") where "deleted_at" is null',
})
@Index({
  name: 'document_watchers_user_lookup_idx',
  properties: ['tenantId', 'organizationId', 'userId'],
})
export class DocumentWatcher {
  [OptionalProps]?: 'createdAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @ManyToOne(() => Document, { fieldName: 'document_id', mapToPk: true, deleteRule: 'cascade' })
  documentId!: string

  @Property({ name: 'user_id', type: 'uuid' })
  userId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

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

  @ManyToOne(() => Document, { fieldName: 'document_id', mapToPk: true, deleteRule: 'cascade' })
  documentId!: string

  @ManyToOne(() => DocumentComment, {
    fieldName: 'parent_comment_id',
    mapToPk: true,
    nullable: true,
    deleteRule: 'set null',
  })
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

  @Property({ name: 'updated_at', type: Date, onUpdate: preserveMonotonicDocumentVersionOnUpdate })
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

  @ManyToOne(() => Document, { fieldName: 'document_id', mapToPk: true, deleteRule: 'cascade' })
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
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @ManyToOne(() => Document, { fieldName: 'document_id', mapToPk: true, deleteRule: 'cascade' })
  documentId!: string

  @Property({ name: 'attachment_id', type: 'uuid' })
  attachmentId!: string

  @Property({ name: 'created_by_user_id', type: 'uuid' })
  createdByUserId!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: preserveMonotonicDocumentVersionOnUpdate })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'document_templates' })
@Index({ name: 'document_templates_scope_idx', properties: ['organizationId', 'tenantId', 'deletedAt'] })
@Index({
  name: 'document_templates_active_seed_key_uq',
  expression:
    'create unique index "document_templates_active_seed_key_uq" on "document_templates" ("tenant_id", "organization_id", "seed_key") where "seed_key" is not null and "deleted_at" is null',
})
export class DocumentTemplate {
  [OptionalProps]?: 'description' | 'contextSlots' | 'seedKey' | 'isActive' | 'createdAt' | 'updatedAt' | 'deletedAt'

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

  @Property({ name: 'seed_key', type: 'varchar', length: 128, nullable: true })
  seedKey?: string | null

  @Property({ name: 'created_by_user_id', type: 'uuid' })
  createdByUserId!: string

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: preserveMonotonicDocumentVersionOnUpdate })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'document_entity_links' })
@Index({
  name: 'document_entity_links_document_lookup_idx',
  properties: ['tenantId', 'organizationId', 'documentId', 'deletedAt'],
})
@Index({
  name: 'document_entity_links_customer_active_uq',
  expression:
    'create unique index "document_entity_links_customer_active_uq" on "document_entity_links" ("document_id", "customer_entity_id") where "customer_entity_id" is not null and "deleted_at" is null',
})
@Index({
  name: 'document_entity_links_deal_active_uq',
  expression:
    'create unique index "document_entity_links_deal_active_uq" on "document_entity_links" ("document_id", "deal_id") where "deal_id" is not null and "deleted_at" is null',
})
@Index({
  name: 'document_entity_links_product_active_uq',
  expression:
    'create unique index "document_entity_links_product_active_uq" on "document_entity_links" ("document_id", "product_id") where "product_id" is not null and "deleted_at" is null',
})
@Index({
  name: 'document_entity_links_catalog_offer_active_uq',
  expression:
    'create unique index "document_entity_links_catalog_offer_active_uq" on "document_entity_links" ("document_id", "catalog_offer_id") where "catalog_offer_id" is not null and "deleted_at" is null',
})
@Index({
  name: 'document_entity_links_quote_active_uq',
  expression:
    'create unique index "document_entity_links_quote_active_uq" on "document_entity_links" ("document_id", "quote_id") where "quote_id" is not null and "deleted_at" is null',
})
@Index({
  name: 'document_entity_links_sales_order_active_uq',
  expression:
    'create unique index "document_entity_links_sales_order_active_uq" on "document_entity_links" ("document_id", "sales_order_id") where "sales_order_id" is not null and "deleted_at" is null',
})
@Index({
  name: 'document_entity_links_linked_document_active_uq',
  expression:
    'create unique index "document_entity_links_linked_document_active_uq" on "document_entity_links" ("document_id", "linked_document_id") where "linked_document_id" is not null and "deleted_at" is null',
})
@Index({
  name: 'document_entity_links_customer_reverse_idx',
  expression:
    'create index "document_entity_links_customer_reverse_idx" on "document_entity_links" ("tenant_id", "organization_id", "customer_entity_id") where "customer_entity_id" is not null and "deleted_at" is null',
})
@Index({
  name: 'document_entity_links_deal_reverse_idx',
  expression:
    'create index "document_entity_links_deal_reverse_idx" on "document_entity_links" ("tenant_id", "organization_id", "deal_id") where "deal_id" is not null and "deleted_at" is null',
})
@Index({
  name: 'document_entity_links_product_reverse_idx',
  expression:
    'create index "document_entity_links_product_reverse_idx" on "document_entity_links" ("tenant_id", "organization_id", "product_id") where "product_id" is not null and "deleted_at" is null',
})
@Index({
  name: 'document_entity_links_catalog_offer_reverse_idx',
  expression:
    'create index "document_entity_links_catalog_offer_reverse_idx" on "document_entity_links" ("tenant_id", "organization_id", "catalog_offer_id") where "catalog_offer_id" is not null and "deleted_at" is null',
})
@Index({
  name: 'document_entity_links_quote_reverse_idx',
  expression:
    'create index "document_entity_links_quote_reverse_idx" on "document_entity_links" ("tenant_id", "organization_id", "quote_id") where "quote_id" is not null and "deleted_at" is null',
})
@Index({
  name: 'document_entity_links_sales_order_reverse_idx',
  expression:
    'create index "document_entity_links_sales_order_reverse_idx" on "document_entity_links" ("tenant_id", "organization_id", "sales_order_id") where "sales_order_id" is not null and "deleted_at" is null',
})
@Index({
  name: 'document_entity_links_linked_document_reverse_idx',
  expression:
    'create index "document_entity_links_linked_document_reverse_idx" on "document_entity_links" ("tenant_id", "organization_id", "linked_document_id") where "linked_document_id" is not null and "deleted_at" is null',
})
@Check({
  name: 'document_entity_links_exactly_one_target_chk',
  expression:
    'num_nonnulls("customer_entity_id", "deal_id", "product_id", "catalog_offer_id", "quote_id", "sales_order_id", "linked_document_id") = 1',
})
@Check({
  name: 'document_entity_links_customer_kind_chk',
  expression:
    '(("customer_entity_id" is not null and "customer_kind" in (\'person\', \'company\')) or ("customer_entity_id" is null and "customer_kind" is null))',
})
@Check({
  name: 'document_entity_links_no_self_link_chk',
  expression: '"document_id" <> "linked_document_id"',
})
export class DocumentEntityLink {
  [OptionalProps]?:
    | 'customerEntityId'
    | 'customerKind'
    | 'dealId'
    | 'productId'
    | 'catalogOfferId'
    | 'quoteId'
    | 'salesOrderId'
    | 'linkedDocumentId'
    | 'createdAt'
    | 'updatedAt'
    | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @ManyToOne(() => Document, { fieldName: 'document_id', mapToPk: true, deleteRule: 'cascade' })
  documentId!: string

  @Property({ name: 'customer_entity_id', type: 'uuid', nullable: true })
  customerEntityId?: string | null

  @Property({ name: 'customer_kind', type: 'varchar', length: 16, nullable: true })
  customerKind?: DocumentEntityLinkCustomerKind | null

  @Property({ name: 'deal_id', type: 'uuid', nullable: true })
  dealId?: string | null

  @Property({ name: 'product_id', type: 'uuid', nullable: true })
  productId?: string | null

  @Property({ name: 'catalog_offer_id', type: 'uuid', nullable: true })
  catalogOfferId?: string | null

  @Property({ name: 'quote_id', type: 'uuid', nullable: true })
  quoteId?: string | null

  @Property({ name: 'sales_order_id', type: 'uuid', nullable: true })
  salesOrderId?: string | null

  @ManyToOne(() => Document, {
    fieldName: 'linked_document_id',
    mapToPk: true,
    nullable: true,
    deleteRule: 'cascade',
  })
  linkedDocumentId?: string | null

  @Property({ name: 'label_snapshot', type: 'text' })
  labelSnapshot!: string

  @Property({ name: 'href_snapshot', type: 'varchar', length: 1024 })
  hrefSnapshot!: string

  @Property({ type: 'varchar', length: 24 })
  source!: DocumentEntityLinkSource

  @Property({ name: 'created_by_user_id', type: 'uuid' })
  createdByUserId!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: preserveMonotonicDocumentVersionOnUpdate })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

export default [
  Document,
  DocumentContent,
  DocumentFolder,
  DocumentShare,
  DocumentFavorite,
  DocumentWatcher,
  DocumentComment,
  DocumentVersion,
  DocumentAttachment,
  DocumentTemplate,
  DocumentEntityLink,
]
