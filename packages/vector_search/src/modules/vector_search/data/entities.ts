import { Entity, PrimaryKey, Property, Index, JsonType } from '@mikro-orm/core'
import { PgVectorType } from './pgVectorType'

export type VectorSearchRecordLink = {
  href: string
  label: string
  icon?: string | null
  relation?: string | null
}

@Entity({ tableName: 'vector_search_records' })
@Index({ name: 'vector_search_records_entity_idx', properties: ['entityType', 'recordId'] })
export class VectorSearchRecord {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'entity_type', type: 'text' })
  entityType!: string

  @Property({ name: 'record_id', type: 'text' })
  recordId!: string

  @Property({ name: 'module_id', type: 'text' })
  moduleId!: string

  @Property({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId?: string | null

  @Property({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId?: string | null

  @Property({ name: 'title', type: 'text' })
  title!: string

  @Property({ name: 'lead', type: 'text', nullable: true })
  lead?: string | null

  @Property({ name: 'icon', type: 'text', nullable: true })
  icon?: string | null

  @Property({ name: 'primary_url', type: 'text' })
  primaryUrl!: string

  @Property({ name: 'links', type: JsonType, nullable: true })
  links?: VectorSearchRecordLink[] | null

  @Property({ name: 'search_terms', type: JsonType, nullable: true })
  searchTerms?: string[] | null

  @Property({ name: 'payload', type: JsonType, nullable: true })
  payload?: Record<string, unknown> | null

  @Property({ name: 'combined_text', type: 'text' })
  combinedText!: string

  @Property({ type: PgVectorType, columnType: 'vector(1536)', nullable: true })
  embedding?: number[] | null

  @Property({ name: 'embedding_model', type: 'text', nullable: true })
  embeddingModel?: string | null

  @Property({ name: 'embedding_dimensions', type: 'int', nullable: true })
  embeddingDimensions?: number | null

  @Property({ name: 'checksum', type: 'text' })
  checksum!: string

  @Property({ name: 'last_indexed_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  lastIndexedAt: Date = new Date()

  @Property({ name: 'embedding_error', type: 'text', nullable: true })
  embeddingError?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}
