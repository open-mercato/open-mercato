import { isDefVisible } from '../utils/customFieldDefs'
import type { CrudFormSectionSurfaceAlternativeFact } from '@open-mercato/shared/modules/form-section-facts'
import { parseCrudFormOwnedPath, readInitialCustomFieldValue } from '../crud/form-field-paths'
import type { CustomFieldDefDto } from '../utils/customFieldDefs'
import type { CrudFormSectionRuntime } from './crud-form-section-runtime'

export type CrudFormSectionCustomFieldDefinitionSets = Readonly<Record<string, readonly string[]>>

export type CrudFormSectionCustomFields = {
  definitions: CustomFieldDefDto[]
  keysBySection: ReadonlyMap<string, ReadonlySet<string>>
  valid: boolean
  needsDefinitions: boolean
}

export function projectCrudFormSectionCustomFields<TValues, TPayload>({
  surface, descriptors, definitions, entityIds, definitionSets,
}: {
  surface: CrudFormSectionSurfaceAlternativeFact
  descriptors: readonly CrudFormSectionRuntime<TValues, TPayload>[]
  definitions: CustomFieldDefDto[]
  entityIds: readonly string[]
  definitionSets?: CrudFormSectionCustomFieldDefinitionSets
}): CrudFormSectionCustomFields {
  const keysBySection = new Map<string, ReadonlySet<string>>()
  const selected = new Set<CustomFieldDefDto>()
  const selectedKeys = new Set<string>()
  const needsDefinitions = surface.ownershipFacts.some(({ customFieldOwnership: owner }) =>
    owner.mode === 'all' || (owner.mode === 'ids' && owner.ids.length > 0))
  const invalid = { definitions: [], keysBySection: new Map(), valid: false, needsDefinitions }
  const ownership = new Map(surface.ownershipFacts.map((owner) => [owner.sectionId, owner.customFieldOwnership]))
  if (ownership.size !== surface.ownershipFacts.length) return invalid
  for (const descriptor of descriptors) {
    const sectionId = descriptor.group.id
    const fact = ownership.get(sectionId)
    const authored = descriptor.ownedCustomFieldIds
    const setId = fact?.mode === 'ids' || fact?.mode === 'all' ? fact.definitionSetId : undefined
    if (setId !== descriptor.customFieldDefinitionSetId) return invalid
    if (!fact || fact.mode === 'none') {
      if (authored === 'all' || authored?.length) return invalid
      continue
    }
    if (fact.mode === 'all' && authored !== 'all') return invalid
    const ids = fact.mode === 'ids' ? new Set(fact.ids) : null
    if (ids && fact.mode === 'ids' && (!authored || authored === 'all' || new Set(authored).size !== authored.length
        || ids.size !== fact.ids.length || ids.size !== authored.length || authored.some((key) => !ids.has(key)))) return invalid
    if (ids?.size === 0) continue
    const bound = setId
      ? (definitionSets && Object.hasOwn(definitionSets, setId) ? definitionSets[setId] : entityIds.includes(setId) ? [setId] : undefined)
      : entityIds
    if (!bound?.length || new Set(bound).size !== bound.length || bound.some((entityId) => !entityIds.includes(entityId))) return invalid
    const ownerKeys = new Set<string>()
    for (const definition of definitions) {
      if ((ids && !ids.has(definition.key)) || !isDefVisible(definition, 'form')) continue
      const entityId = definition.entityId ?? (entityIds.length === 1 ? entityIds[0] : undefined)
      if (!entityId) return invalid
      if (!bound.includes(entityId)) continue
      const key = definition.key
      if (parseCrudFormOwnedPath(key)?.length !== 1 || selectedKeys.has(key)) return invalid
      selectedKeys.add(key)
      ownerKeys.add(key)
      selected.add(definition)
    }
    if (ids && ownerKeys.size !== ids.size) return invalid
    keysBySection.set(sectionId, ownerKeys)
  }
  return { definitions: definitions.filter((definition) => selected.has(definition)), keysBySection, valid: true, needsDefinitions }
}

export function readCrudFormSectionCustomFieldValue(values: Record<string, unknown>, key: string, bareCustomFields: boolean): unknown {
  const id = bareCustomFields ? key : `cf_${key}`
  return Object.hasOwn(values, id) ? values[id] : readInitialCustomFieldValue(values, key)
}
