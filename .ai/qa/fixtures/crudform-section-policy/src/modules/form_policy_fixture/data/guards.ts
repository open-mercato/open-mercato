import type { MutationGuard } from '@open-mercato/shared/lib/crud/mutation-guard-registry'
import { crudFormSections } from '../form-sections'

const alternatives = crudFormSections.hostFacts[0].alternatives
const update = alternatives[1].mutationSurfaces?.[0]
const create = alternatives[3].mutationSurfaces?.[0]
if (!update || !create) throw new Error('[internal] Fixture mutation surfaces are missing')

export const guards: MutationGuard[] = [{
  id: 'form_policy_fixture.capabilities',
  targetEntity: 'form_policy_fixture.record',
  operations: ['create', 'update'],
  validate: async () => ({ ok: true }),
  crudFormSectionCapabilities: [
    {
      hostId: 'form_policy_fixture.record', formVariant: 'showcase', formOperation: 'update',
      capabilityId: 'form_policy_fixture.preserve-private', protocol: 'crud-form-sections/v1', roundTripId: 'form_policy_fixture.hide-private@v1',
      modes: ['omit-preserves'], payloadPaths: [], customFieldOwnership: { mode: 'none' },
      mutationSurfaces: [], providedDataContractIds: [], allowNoopSubmit: false, requiredLeaves: [], extensionSinkSupport: 'none',
    },
    {
      hostId: 'form_policy_fixture.record', formVariant: 'showcase', formOperation: 'update',
      capabilityId: 'form_policy_fixture.accept-details', protocol: 'crud-form-sections/v1', roundTripId: 'form_policy_fixture.replace-details@v1',
      modes: ['domain-adapter'], payloadPaths: ['name'],
      customFieldOwnership: { mode: 'ids', ids: ['region'], definitionSetId: 'form_policy_fixture.region-v1' },
      mutationSurfaces: [update], providedDataContractIds: [], allowNoopSubmit: false, extensionSinkSupport: 'none',
      requiredLeaves: [
        { hostId: 'form_policy_fixture.record', formVariant: 'showcase', formOperation: 'update',
          schemaId: 'fixtureUpdate', payloadPath: 'name', coverage: ['section'] },
        { hostId: 'form_policy_fixture.record', formVariant: 'showcase', formOperation: 'update',
          schemaId: 'fixtureUpdate', payloadPath: 'privateCode', coverage: ['section', 'preserve-from-record'] },
      ],
    },
    {
      hostId: 'form_policy_fixture.record', formVariant: 'c3', formOperation: 'create',
      capabilityId: 'form_policy_fixture.uncovered-private', protocol: 'crud-form-sections/v1', roundTripId: 'form_policy_fixture.hide-uncovered@v1',
      modes: ['domain-adapter'], payloadPaths: [], customFieldOwnership: { mode: 'none' },
      mutationSurfaces: [create], providedDataContractIds: [], allowNoopSubmit: false, extensionSinkSupport: 'none',
      requiredLeaves: [
        { hostId: 'form_policy_fixture.record', formVariant: 'c3', formOperation: 'create',
          schemaId: 'fixtureCreate', payloadPath: 'name', coverage: ['section'] },
        { hostId: 'form_policy_fixture.record', formVariant: 'c3', formOperation: 'create',
          schemaId: 'fixtureCreate', payloadPath: 'privateCode', coverage: ['section', 'server-default'] },
      ],
    },
  ],
}]

