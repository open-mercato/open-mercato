import { Entity, PrimaryKey, Property, Index } from '@mikro-orm/core'

// Definitions of custom fields scoped to an entity type and organization
@Entity({ tableName: 'custom_field_defs' })
@Index({
  name: 'cf_defs_entity_tenant_org_idx',
  properties: ['entityId', 'tenantId', 'organizationId'],
})
@Index({
  name: 'cf_defs_entity_tenant_idx',
  properties: ['entityId', 'tenantId'],
})
@Index({
  name: 'cf_defs_entity_org_idx',
  properties: ['entityId', 'organizationId'],
})
@Index({
  name: 'cf_defs_entity_global_idx',
  properties: ['entityId'],
})
@Index({
  name: 'cf_defs_entity_key_scope_idx',
  properties: ['entityId', 'key', 'tenantId', 'organizationId'],
})
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

@Entity({ tableName: 'custom_field_entity_configs' })
@Index({
  name: 'cf_entity_cfgs_entity_scope_idx',
  properties: ['entityId', 'tenantId', 'organizationId'],
})
@Index({
  name: 'cf_entity_cfgs_entity_tenant_idx',
  properties: ['entityId', 'tenantId'],
})
@Index({
  name: 'cf_entity_cfgs_entity_org_idx',
  properties: ['entityId', 'organizationId'],
})
export class CustomFieldEntityConfig {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'entity_id', type: 'text' })
  entityId!: string

  @Property({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId?: string | null

  @Property({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId?: string | null

  @Property({ name: 'config_json', type: 'jsonb', nullable: true })
  configJson?: Record<string, unknown> | null

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

// User-defined logical entities registry (for dynamic data types)
@Entity({ tableName: 'custom_entities' })
@Index({ name: 'custom_entities_unique_idx', properties: ['entityId', 'organizationId', 'tenantId'], options: { unique: true } })
export class CustomEntity {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  // Identifier: '<module>:<entity>' (snake_case entity part preferred)
  @Property({ name: 'entity_id', type: 'text' })
  entityId!: string

  @Property({ type: 'text' })
  label!: string

  @Property({ type: 'text', nullable: true })
  description?: string | null

  // Preferred display label field for relation options (e.g., 'name')
  @Property({ name: 'label_field', type: 'text', nullable: true })
  labelField?: string | null

  // Default editor preference for multiline custom fields
  // Allowed: 'markdown' | 'simpleMarkdown' | 'htmlRichText'
  @Property({ name: 'default_editor', type: 'text', nullable: true })
  defaultEditor?: string | null

  // Whether to show this entity in the sidebar navigation
  @Property({ name: 'show_in_sidebar', type: 'boolean', default: false })
  showInSidebar: boolean = false

  // Note: Per-field UI preferences (list visibility, filter visibility, form editability)
  // are stored in CustomFieldDef.configJson, not at entity level.

  // Optional org/tenant scoping
  @Property({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId?: string | null

  @Property({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId?: string | null

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

// Storage for custom entity records (JSONB document store)
@Entity({ tableName: 'custom_entities_storage' })
@Index({ name: 'custom_entities_storage_unique_idx', properties: ['entityType', 'entityId', 'organizationId'], options: { unique: true } })
export class CustomEntityStorage {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'entity_type', type: 'text' })
  entityType!: string

  @Property({ name: 'entity_id', type: 'text' })
  entityId!: string

  @Property({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId?: string | null

  @Property({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId?: string | null

  @Property({ name: 'doc', type: 'json' })
  doc!: any

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

// Values for custom fields (EAV); recordId is a text to support any PK
@Entity({ tableName: 'custom_field_values' })
@Index({
  name: 'cf_values_entity_record_tenant_idx',
  properties: ['entityId', 'recordId', 'tenantId'],
})
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

// Encryption maps declared per entity/tenant/organization
@Entity({ tableName: 'encryption_maps' })
@Index({
  name: 'encryption_maps_entity_scope_idx',
  properties: ['entityId', 'tenantId', 'organizationId'],
})
export class EncryptionMap {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'entity_id', type: 'text' })
  entityId!: string

  @Property({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId?: string | null

  @Property({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId?: string | null

  @Property({ name: 'fields_json', type: 'jsonb', nullable: true })
  fieldsJson?: Array<{ field: string; hashField?: string | null }> | null

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}
