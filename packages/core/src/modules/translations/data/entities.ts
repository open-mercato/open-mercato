import { Entity, PrimaryKey, Property, Index } from '@mikro-orm/core'

@Entity({ tableName: 'entity_translations' })
@Index({ name: 'entity_translations_type_tenant_idx', properties: ['entityType', 'tenantId'] })
export class EntityTranslation {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'entity_type', type: 'text' })
  @Index({ name: 'entity_translations_type_idx' })
  entityType!: string

  @Property({ name: 'entity_id', type: 'text' })
  @Index({ name: 'entity_translations_entity_idx' })
  entityId!: string

  @Property({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId?: string | null

  @Property({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId?: string | null

  @Property({ name: 'translations', type: 'json' })
  translations!: Record<string, Record<string, unknown>>

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}
