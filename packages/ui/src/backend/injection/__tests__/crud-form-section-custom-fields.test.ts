import type { CrudFormCustomFieldOwnershipFact, CrudFormSectionSurfaceAlternativeFact } from '@open-mercato/shared/modules/form-section-facts'
import { isDefVisible } from "../../utils/customFieldDefs"
import { projectCrudFormSectionCustomFields } from '../crud-form-section-custom-fields'
import { defineCrudFormSectionRuntime } from '../crud-form-section-runtime'

const entityIds = ['example:record', 'example:extra']
const definitionSetId = 'example.allowed-fields'
const definitions = [
  { key: 'priority', kind: 'text', entityId: entityIds[0] },
  { key: 'unrelated', kind: 'text', entityId: entityIds[1] },
  { key: 'internal', kind: 'text', entityId: entityIds[0], formEditable: false },
]

function project(
  ownership: CrudFormCustomFieldOwnershipFact,
  ownedCustomFieldIds: readonly string[] | 'all',
  opts: { bound?: readonly string[]; definitions?: typeof definitions; descriptorSet?: string } = {},
) {
  const surface: CrudFormSectionSurfaceAlternativeFact = {
    id: 'example.surface', hostId: 'example.record', formVariant: 'showcase', formOperation: 'create',
    orderedSectionIds: ['details'], callerIds: [], contributionIds: [], mutationSurfaceIds: [], dependencies: [],
    ownershipFacts: [{ sectionId: 'details', payloadPaths: [], customFieldOwnership: ownership }],
  }
  const descriptor = defineCrudFormSectionRuntime({
    id: 'example.details', roundTripId: 'example.details@v1',
    group: { id: 'details', kind: 'customFields' }, ownedFieldPaths: [],
    ownedCustomFieldIds, customFieldDefinitionSetId: opts.descriptorSet ?? definitionSetId,
    validate: () => ({ success: true, data: null }), projectPayload: () => ({}),
  })
  return projectCrudFormSectionCustomFields({
    surface, descriptors: [descriptor], definitions: opts.definitions ?? definitions, entityIds,
    definitionSets: opts.bound ? { [definitionSetId]: opts.bound } : undefined,
  })
}

it('selects only exact declared IDs from their scoped definition set', () => {
  const ownership = { mode: 'ids', ids: ['priority'], definitionSetId } as const
  const result = project(ownership, ['priority'], { bound: [entityIds[0]] })
  expect(result.valid).toBe(true)
  expect(result.definitions).toEqual([definitions[0]])
  expect(result.keysBySection.get('details')).toEqual(new Set(['priority']))
  expect(project(ownership, ['priority', 'unrelated'], { bound: entityIds }).valid).toBe(false)
  expect(project(ownership, ['priority'], { bound: [entityIds[1]] }).valid).toBe(false)
  expect(project(ownership, ['priority'], { bound: entityIds, descriptorSet: 'example.different' }).valid).toBe(false)
})

it('matches all only to unambiguous scoped entities and rejects duplicate derived keys', () => {
  const ownership = { mode: 'all', definitionSetId } as const
  expect(project(ownership, 'all', { bound: [entityIds[0]] }).definitions).toEqual([definitions[0]])
  expect(project(ownership, 'all').valid).toBe(false)
  expect(project(ownership, 'all', { bound: ['example:unknown'] }).valid).toBe(false)
  expect(project(ownership, 'all', { bound: entityIds, definitions: [
    ...definitions, { ...definitions[0], entityId: entityIds[1] },
  ] }).valid).toBe(false)
  expect(project(ownership, 'all', { bound: entityIds, definitions: [
    ...definitions, { key: 'ambiguous', kind: 'text', entityId: '' },
  ] }).valid).toBe(false)
})

it('keeps compiled fields out of ordinary forms and projects them for their exact policy', () => {
  const season = { key: 'season', kind: 'text', entityId: entityIds[0], sectionOnly: true as const }
  const ownership = { mode: 'ids', ids: ['season'], definitionSetId } as const
  expect(isDefVisible(season, 'form')).toBe(false)
  const result = project(ownership, ['season'], { bound: [entityIds[0]], definitions: [season] })
  expect(result.valid).toBe(true)
  expect(result.definitions).toEqual([season])
  expect(project(ownership, ['season'], { bound: [entityIds[0]], definitions: [{ ...season, formEditable: false }] }).valid).toBe(false)
})
