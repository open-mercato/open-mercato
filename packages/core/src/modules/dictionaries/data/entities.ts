import {
  Entity,
  PrimaryKey,
  Property,
  Unique,
  Index,
  ManyToOne,
} from '@mikro-orm/core'

export type DictionaryManagerVisibility = 'default' | 'hidden'

@Entity({ tableName: 'dictionaries' })
@Unique({ name: 'dictionaries_scope_key_unique', properties: ['organizationId', 'tenantId', 'key'] })
export class Dictionary {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ type: 'text' })
  key!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ type: 'text', nullable: true })
  description?: string | null

  @Property({ name: 'is_system', type: 'boolean', default: false })
  isSystem: boolean = false

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'manager_visibility', type: 'text', default: 'default' })
  managerVisibility: DictionaryManagerVisibility = 'default'

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'dictionary_entries' })
@Index({ name: 'dictionary_entries_scope_idx', properties: ['dictionary', 'organizationId', 'tenantId'] })
@Unique({ name: 'dictionary_entries_unique', properties: ['dictionary', 'organizationId', 'tenantId', 'normalizedValue'] })
export class DictionaryEntry {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @ManyToOne(() => Dictionary, { fieldName: 'dictionary_id' })
  dictionary!: Dictionary

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ type: 'text' })
  value!: string

  @Property({ name: 'normalized_value', type: 'text' })
  normalizedValue!: string

  @Property({ type: 'text' })
  label!: string

  @Property({ type: 'text', nullable: true })
  color?: string | null

  @Property({ type: 'text', nullable: true })
  icon?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}
