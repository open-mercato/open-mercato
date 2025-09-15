// Shared entity/extension/custom-field types used by generators and DI

export type EntityId = string // format: '<module>:<entity>' e.g., 'auth:user'

export type EntityExtension = {
  // Base entity to extend, e.g., 'auth:user'
  base: EntityId
  // The extension entity that holds extra columns/relations, defined by the extending module
  // Usually one-to-one keyed by base PK; other cardinalities allowed via explicit join keys
  extension: EntityId
  // Join description for query builder to link base <-> extension
  join: {
    baseKey: string // column name on base (e.g., 'id')
    extensionKey: string // column name on extension (e.g., 'user_id')
  }
  cardinality?: 'one-to-one' | 'one-to-many' | 'many-to-one' | 'many-to-many'
  required?: boolean
  description?: string
}

export type CustomFieldKind =
  | 'text'
  | 'multiline'
  | 'integer'
  | 'float'
  | 'boolean'
  | 'select'

export type CustomFieldDefinition = {
  id?: string // stable id; generated if omitted
  key: string // unique within entity (snake_case)
  kind: CustomFieldKind
  label?: string
  description?: string
  required?: boolean
  multi?: boolean // allow multiple values
  options?: string[] // for 'select'
  defaultValue?: string | number | boolean | null
  filterable?: boolean
  indexed?: boolean
}

export type CustomFieldSet = {
  entity: EntityId
  fields: CustomFieldDefinition[]
  // Optional: module id or other provenance
  source?: string
}

export type EntityRegistrySpec = {
  // Static, per-module declared extensions
  extensions?: EntityExtension[]
  // Static, per-module declared custom fields (seeded via migrations/CLI)
  customFieldSets?: CustomFieldSet[]
}

