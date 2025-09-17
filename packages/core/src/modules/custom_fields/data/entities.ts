import { Entity, PrimaryKey, Property, Index } from '@mikro-orm/core'

// Definitions of custom fields scoped to an entity type and organization
@Entity({ tableName: 'custom_field_defs' })
export class CustomFieldDef {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  // Entity identifier: '<module>:<entity>'
  @Property({ name: 'entity_id', type: 'text' })
  entityId!: string

  // Organization scope (nullable for global)
  @Property({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId?: string | null

  // Tenant scope (nullable for global)
  @Property({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId?: string | null

  // Unique key within entity scope
  @Property({ type: 'text' })
  @Index({ name: 'cf_defs_entity_key_idx' })
  key!: string

  // Field kind: text|multiline|integer|float|boolean|select
  @Property({ type: 'text' })
  kind!: string

  // Optional select options or metadata in JSON
  @Property({ name: 'config_json', type: 'json', nullable: true })
  configJson?: any

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

// Values for custom fields (EAV); recordId is a text to support any PK
@Entity({ tableName: 'custom_field_values' })
export class CustomFieldValue {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'entity_id', type: 'text' })
  entityId!: string

  // Text to support int/uuid PKs equally
  @Property({ name: 'record_id', type: 'text' })
  recordId!: string

  @Property({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId?: string | null

  @Property({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId?: string | null

  // Field key for lookup; resolves to a CustomFieldDef
  @Property({ name: 'field_key', type: 'text' })
  @Index({ name: 'cf_values_entity_record_field_idx' })
  fieldKey!: string

  // One of the following value columns is used based on kind
  @Property({ name: 'value_text', type: 'text', nullable: true })
  valueText?: string | null

  @Property({ name: 'value_multiline', type: 'text', nullable: true })
  valueMultiline?: string | null

  @Property({ name: 'value_int', type: 'int', nullable: true })
  valueInt?: number | null

  @Property({ name: 'value_float', type: 'float', nullable: true })
  valueFloat?: number | null

  @Property({ name: 'value_bool', type: 'boolean', nullable: true })
  valueBool?: boolean | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}
