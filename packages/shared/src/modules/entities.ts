// Shared entity/extension/custom-field types used by generators and DI

import type { VectorSearchEntitySpec } from './vector-search'

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
  | 'relation'
  | 'attachment'
  | 'dictionary'

export type CustomFieldDefinition = {
  id?: string // stable id; generated if omitted
  key: string // unique within entity (snake_case)
  kind: CustomFieldKind
  label?: string
  description?: string
  required?: boolean
  multi?: boolean // allow multiple values
  options?: string[] // for 'select'
  // Optional dynamic options source for selects/tags relations
  optionsUrl?: string
  defaultValue?: string | number | boolean | null
  filterable?: boolean
  // whether field should be editable in generated CRUD forms
  formEditable?: boolean
  indexed?: boolean
  listVisible?: boolean
  // Optional UI hints for generated forms/filters
  // Editors for multiline-rich text fields:
  //  - 'markdown' -> UIW Markdown editor
  //  - 'simpleMarkdown' -> minimal toolbar markdown
  //  - 'htmlRichText' -> contenteditable rich text
  editor?: 'markdown' | 'simpleMarkdown' | 'htmlRichText'
  // Input hint for plain text fields (e.g., tags input when multi=true)
  // Allow additional custom renderers (e.g., listbox from modules)
  input?: string
  // Relation helper metadata
  relatedEntityId?: string
  // Backed by global dictionaries module
  dictionaryId?: string
  dictionaryInlineCreate?: boolean
  // Advanced validation rules applied in UI + API
  validation?: Array<{ rule: string; param?: unknown; message?: string }>
  // Attachments config passthrough (handled by attachments module)
  maxAttachmentSizeMb?: number
  acceptExtensions?: string[]
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

export type CustomEntitySpec = {
  id: EntityId
  label?: string
  description?: string
  labelField?: string
  defaultEditor?: string
  showInSidebar?: boolean
  global?: boolean
  fields?: CustomFieldDefinition[]
  vectorSearch?: VectorSearchEntitySpec
}
