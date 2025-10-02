import { Entity, PrimaryKey, Property, Index } from '@mikro-orm/core'

// Generic JSONB-backed index rows for any entity ('<module>:<entity>')
@Entity({ tableName: 'entity_indexes' })
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

