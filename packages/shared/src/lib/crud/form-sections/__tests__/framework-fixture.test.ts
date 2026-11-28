import { crudFormSections } from '../../../../../../../.ai/qa/fixtures/crudform-section-policy/src/modules/form_policy_fixture/form-sections'
import { guards } from '../../../../../../../.ai/qa/fixtures/crudform-section-policy/src/modules/form_policy_fixture/data/guards'
import { fixtureCreate } from '../../../../../../../.ai/qa/fixtures/crudform-section-policy/src/modules/form_policy_fixture/data/validators'
import type { CrudFormCustomFieldOwnershipFact, CrudFormSectionSurfaceAlternativeFact } from '../../../../modules/form-section-facts'
import type { CrudFormSectionsDeclaration } from '../../../../modules/form-sections'
import { registerMutationGuards } from '../../mutation-guard-store'
import { crudFormSectionHostKey } from '../composition'
import { buildCrudFormSectionManifest } from '../manifest'

const moduleId = 'form_policy_fixture'
const showcaseKey = crudFormSectionHostKey({ hostId: `${moduleId}.record`, formVariant: 'showcase', formOperation: 'update' })
const c3Key = crudFormSectionHostKey({ hostId: `${moduleId}.record`, formVariant: 'c3', formOperation: 'create' })
type Ownership = CrudFormSectionSurfaceAlternativeFact['ownershipFacts']

function build(
  sections: CrudFormSectionsDeclaration = crudFormSections,
  finalGuards = guards,
) {
  registerMutationGuards([{ moduleId, guards: finalGuards }])
  return buildCrudFormSectionManifest([{ moduleId, sections }], sections.contributedOverrides)
}

afterEach(() => registerMutationGuards([]))

it('accepts the add, hide and replace together, while retaining the uncovered C3 host as blocked', () => {
  const manifest = build()
  expect(manifest.policies.get(showcaseKey)).toMatchObject({
    surface: { orderedSectionIds: ['display', 'details'] },
    requiredLeaves: [
      { payloadPath: 'name', mode: 'section', sectionId: 'details' },
      { payloadPath: 'privateCode', mode: 'preserve-from-record', fieldLabelKey: `${moduleId}.fields.private` },
    ],
  })
  expect(manifest.ledger.hosts).toEqual(expect.arrayContaining([
    { hostId: `${moduleId}.record`, formVariant: 'c3', formOperation: 'create' },
  ]))
  expect(manifest.providers.has(c3Key)).toBe(true)
  expect(manifest.policies.has(c3Key)).toBe(false)
  expect(fixtureCreate.safeParse({ name: 'visible only' }).success).toBe(false)
})

function updateOwnership(
  transform: (owners: Ownership) => Ownership,
): CrudFormSectionsDeclaration {
  const [host] = crudFormSections.hostFacts
  return {
    ...crudFormSections,
    hostFacts: [{ ...host, alternatives: host.alternatives.map((alternative) =>
      alternative.surface.id === `${moduleId}.update-customized` ? {
        ...alternative, surface: { ...alternative.surface, ownershipFacts: transform(alternative.surface.ownershipFacts) },
      } : alternative) }],
  }
}

it.each([
  { sectionId: 'display', payloadPaths: ['name'], customFieldOwnership: { mode: 'none' } },
  { sectionId: 'display', payloadPaths: [], customFieldOwnership: { mode: 'ids', ids: ['region'] } },
] as const)('rejects overlapping ownership across active sections', (duplicate) => {
  const sections = updateOwnership((owners) => [...owners, duplicate])
  const manifest = build(sections)
  expect(manifest.ledger.hosts).toHaveLength(2)
  expect(manifest.policies.has(showcaseKey)).toBe(false)
})

function replaceCapabilityOwnership(ownership: CrudFormCustomFieldOwnershipFact) {
  return guards.map((guard) => ({
    ...guard,
    crudFormSectionCapabilities: guard.crudFormSectionCapabilities?.map((capability) =>
      capability.capabilityId === `${moduleId}.accept-details`
        ? { ...capability, customFieldOwnership: ownership }
        : capability),
  }))
}

it('matches the exact definition set for ids ownership and rejects a drifted capability', () => {
  expect(build().policies.has(showcaseKey)).toBe(true)
  expect(build(crudFormSections, replaceCapabilityOwnership({
    mode: 'ids', ids: ['region'], definitionSetId: `${moduleId}.different-set`,
  })).policies.has(showcaseKey)).toBe(false)
})

it('matches all ownership only with its exact definition-set identity', () => {
  const ownership = { mode: 'all', definitionSetId: `${moduleId}.region-v1` } as const
  const sections = {
    ...updateOwnership((owners) => owners.map((owner) => ({ ...owner, customFieldOwnership: ownership }))),
    contributionFacts: crudFormSections.contributionFacts.map((contribution) =>
      contribution.operation === 'replace' ? {
      ...contribution, requiredCapabilities: contribution.requiredCapabilities.map((capability) => ({
        ...capability, customFieldOwnership: ownership,
      })),
      } : contribution),
  }
  expect(build(sections, replaceCapabilityOwnership(ownership)).policies.has(showcaseKey)).toBe(true)
  expect(build(sections, replaceCapabilityOwnership({
    ...ownership, definitionSetId: `${moduleId}.different-set`,
  })).policies.has(showcaseKey)).toBe(false)
})
