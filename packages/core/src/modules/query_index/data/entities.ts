import { Entity, PrimaryKey, Property, Index } from '@mikro-orm/core'

// Generic JSONB-backed index rows for any entity ('<module>:<entity>')
@Entity({ tableName: 'entity_indexes' })
@Index({
  name: 'entity_indexes_customer_entity_doc_idx',
  expression:
    `create index "entity_indexes_customer_entity_doc_idx" on "entity_indexes" ("entity_id", "organization_id", "tenant_id") include ("doc") where deleted_at is null and entity_type = 'customers:customer_entity' and organization_id is not null and tenant_id is not null`,
})
@Index({
  name: 'entity_indexes_customer_person_profile_doc_idx',
  expression:
    `create index "entity_indexes_customer_person_profile_doc_idx" on "entity_indexes" ("entity_id", "organization_id", "tenant_id") include ("doc") where deleted_at is null and entity_type = 'customers:customer_person_profile' and organization_id is not null and tenant_id is not null`,
})
@Index({
  name: 'entity_indexes_customer_company_profile_doc_idx',
  expression:
    `create index "entity_indexes_customer_company_profile_doc_idx" on "entity_indexes" ("entity_id", "organization_id", "tenant_id") include ("doc") where deleted_at is null and entity_type = 'customers:customer_company_profile' and organization_id is not null and tenant_id is not null`,
})
@Index({
  name: 'entity_indexes_customer_entity_tenant_doc_idx',
  expression:
    `create index "entity_indexes_customer_entity_tenant_doc_idx" on "entity_indexes" ("tenant_id", "entity_id") include ("doc") where deleted_at is null and entity_type = 'customers:customer_entity' and organization_id is null and tenant_id is not null`,
})
@Index({
  name: 'entity_indexes_customer_person_profile_tenant_doc_idx',
  expression:
    `create index "entity_indexes_customer_person_profile_tenant_doc_idx" on "entity_indexes" ("tenant_id", "entity_id") include ("doc") where deleted_at is null and entity_type = 'customers:customer_person_profile' and organization_id is null and tenant_id is not null`,
})
@Index({
  name: 'entity_indexes_customer_company_profile_tenant_doc_idx',
  expression:
    `create index "entity_indexes_customer_company_profile_tenant_doc_idx" on "entity_indexes" ("tenant_id", "entity_id") include ("doc") where deleted_at is null and entity_type = 'customers:customer_company_profile' and organization_id is null and tenant_id is not null`,
})
export class EntityIndexRow {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  // Entity identifier: '<module>:<entity>'
  @Property({ name: 'entity_type', type: 'text' })
  @Index({ name: 'entity_indexes_type_idx' })
  entityType!: string

  // Record id as text for compatibility with uuid/int
  @Property({ name: 'entity_id', type: 'text' })
  @Index({ name: 'entity_indexes_entity_idx' })
  entityId!: string

  @Property({ name: 'organization_id', type: 'uuid', nullable: true })
  @Index({ name: 'entity_indexes_org_idx' })
  organizationId?: string | null

  @Property({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId?: string | null

  // Flattened document of base fields and custom fields
  @Property({ name: 'doc', type: 'json' })
  doc!: any

  // Optional embedding vector or metadata produced by secondary indexers
  @Property({ name: 'embedding', type: 'json', nullable: true })
  embedding?: any | null

  @Property({ name: 'index_version', type: 'int', default: 1 })
  indexVersion: number = 1

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

// Track long-running index jobs (reindex/purge) per entity and org scope
@Entity({ tableName: 'entity_index_jobs' })
export class EntityIndexJob {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'entity_type', type: 'text' })
  @Index({ name: 'entity_index_jobs_type_idx' })
  entityType!: string

  @Property({ name: 'organization_id', type: 'uuid', nullable: true })
  @Index({ name: 'entity_index_jobs_org_idx' })
  organizationId?: string | null

  @Property({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId?: string | null

  // 'reindexing' | 'purging'
  @Property({ name: 'status', type: 'text' })
  status!: string

  @Property({ name: 'started_at', type: Date, onCreate: () => new Date() })
  startedAt: Date = new Date()

  @Property({ name: 'finished_at', type: Date, nullable: true })
  finishedAt?: Date | null
}

// Snapshot counts for coverage checks (per entity / tenant / org / withDeleted scope)
@Entity({ tableName: 'entity_index_coverage' })
@Index({
  name: 'entity_index_coverage_scope_idx',
  properties: ['entityType', 'tenantId', 'organizationId', 'withDeleted'],
  options: { unique: true },
})
export class EntityIndexCoverage {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'entity_type', type: 'text' })
  entityType!: string

  @Property({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId?: string | null

  @Property({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId?: string | null

  @Property({ name: 'with_deleted', type: 'boolean', default: false })
  withDeleted: boolean = false

  @Property({ name: 'base_count', type: 'int', unsigned: true, default: 0 })
  baseCount: number = 0

  @Property({ name: 'indexed_count', type: 'int', unsigned: true, default: 0 })
  indexedCount: number = 0

  @Property({ name: 'refreshed_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  refreshedAt: Date = new Date()
}
