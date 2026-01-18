import type { CustomFieldDefinition, CustomFieldSet, EntityExtension, EntityId } from '@open-mercato/shared/modules/entities'

export function entityId(moduleId: string, entity: string): EntityId {
  return `${moduleId}:${entity}`
}

export function linkable(moduleId: string, entities: string[]): Record<string, EntityId> {
  return Object.fromEntries(entities.map((e) => [e, entityId(moduleId, e)]))
}

export function defineLink(
  base: EntityId,
  extension: EntityId,
  opts: Pick<EntityExtension, 'join' | 'cardinality' | 'required' | 'description'>
): EntityExtension {
  return { base, extension, ...opts }
}

export const cf = {
  text: (key: string, opts: Omit<CustomFieldDefinition, 'key' | 'kind'> = {}): CustomFieldDefinition => ({ key, kind: 'text', ...opts }),
  multiline: (key: string, opts: Omit<CustomFieldDefinition, 'key' | 'kind'> = {}): CustomFieldDefinition => ({ key, kind: 'multiline', ...opts }),
  integer: (key: string, opts: Omit<CustomFieldDefinition, 'key' | 'kind'> = {}): CustomFieldDefinition => ({ key, kind: 'integer', ...opts }),
  float: (key: string, opts: Omit<CustomFieldDefinition, 'key' | 'kind'> = {}): CustomFieldDefinition => ({ key, kind: 'float', ...opts }),
  boolean: (key: string, opts: Omit<CustomFieldDefinition, 'key' | 'kind'> = {}): CustomFieldDefinition => ({ key, kind: 'boolean', ...opts }),
  select: (key: string, options: string[], opts: Omit<CustomFieldDefinition, 'key' | 'kind' | 'options'> = {}): CustomFieldDefinition => ({ key, kind: 'select', options, ...opts }),
  dictionary: (key: string, dictionaryId: string, opts: Omit<CustomFieldDefinition, 'key' | 'kind' | 'dictionaryId'> = {}): CustomFieldDefinition => ({ key, kind: 'dictionary', dictionaryId, ...opts }),
}

export function defineFields(entity: EntityId, fields: CustomFieldDefinition[], source?: string): CustomFieldSet {
  return { entity, fields, source }
}
