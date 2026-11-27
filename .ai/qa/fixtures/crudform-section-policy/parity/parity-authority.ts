import type { CrudFormSectionCapabilityProviderFact, CrudFormSectionMutationSurfaceFact } from '@open-mercato/shared/modules/form-section-facts'
import type { CrudFormSectionHostProvider } from '@open-mercato/shared/modules/form-sections'
import type { MutationGuard } from '@open-mercato/shared/lib/crud/mutation-guard-registry'

const host = { hostId: 'form_policy_fixture.record', formVariant: 'showcase', formOperation: 'update' } as const
const update: CrudFormSectionMutationSurfaceFact = {
  id: 'form_policy_fixture.update', kind: 'parent-submit',
  guardedFacade: { method: 'PUT', routePattern: '/form-policy-fixture/records/section-policy' },
  delegatedTarget: { kind: 'service', id: 'form_policy_fixture.update' },
  requestOperation: 'update', hostResourceKind: 'form_policy_fixture.record', mutationResourceKind: 'form_policy_fixture.record',
  optimisticLock: 'none',
}

export const hostProvider: CrudFormSectionHostProvider = {
  hostDescriptorId: 'form_policy_fixture.record-host',
  requireFeatures: ['form_policy_fixture.edit'],
  authorizeHost: async ({ requestedHost }) => requestedHost.hostResourceKind === 'form_policy_fixture.record'
    && requestedHost.hostResourceId === 'fixture-record' ? requestedHost : null,
  readLockedRecord: async () => ({ privateCode: 'preserved-fixture-value' }),
  mutationProviders: [{
    mutationSurfaceId: 'form_policy_fixture.update',
    delegatedTarget: { kind: 'service', id: 'form_policy_fixture.update' },
    finalInput: 'transactional-final-input/v1',
  }],
}

const authority = {
  ...host, protocol: 'crud-form-sections/v1', modes: ['domain-adapter'], payloadPaths: [],
  customFieldOwnership: { mode: 'none' }, mutationSurfaces: [update],
  providedDataContractIds: [], allowNoopSubmit: false, requiredLeaves: [], extensionSinkSupport: 'none',
} as const satisfies Omit<CrudFormSectionCapabilityProviderFact, 'capabilityId' | 'roundTripId'>

const baseAuthority: CrudFormSectionCapabilityProviderFact = {
  ...authority, capabilityId: 'form_policy_fixture.authority', roundTripId: 'form_policy_fixture.record-host@v1',
  requiredLeaves: [
    { ...host, schemaId: 'fixtureUpdate', payloadPath: 'name', coverage: ['section'] },
    { ...host, schemaId: 'fixtureUpdate', payloadPath: 'privateCode', coverage: ['section', 'preserve-from-record'] },
  ],
}

const handwrittenCapabilities: readonly CrudFormSectionCapabilityProviderFact[] = [
  {
    ...authority, capabilityId: 'form_policy_fixture.showcase.private.compiled', roundTripId: 'form_policy_fixture.showcase.private@v1',
  },
  {
    ...authority, capabilityId: 'form_policy_fixture.showcase.details.compiled', roundTripId: 'form_policy_fixture.showcase.details@v1',
    payloadPaths: ['name'],
    customFieldOwnership: { mode: 'ids', ids: ['region'], definitionSetId: 'form_policy_fixture.region-v1' },
  },
]

export function fixtureGuards(handwritten: boolean): MutationGuard[] {
  return [{
    id: 'form_policy_fixture.capabilities',
    targetEntity: 'form_policy_fixture.record',
    operations: ['update'],
    validate: async () => ({ ok: true }),
    crudFormSectionCapabilities: handwritten ? [baseAuthority, ...handwrittenCapabilities] : [baseAuthority],
  }]
}
