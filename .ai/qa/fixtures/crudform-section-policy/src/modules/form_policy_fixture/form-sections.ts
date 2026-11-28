import { defineCrudFormSections, lazyCrudFormSectionRuntime } from '@open-mercato/shared/modules/form-sections'
import type { InjectionPosition } from '@open-mercato/shared/modules/widgets/injection-position'

export const crudFormSections = defineCrudFormSections({
  hostFacts: [{
    id: 'form_policy_fixture.record-host',
    roundTripId: 'form_policy_fixture.record-host@v1',
    hostResourceKind: 'form_policy_fixture.record',
    alternatives: [
      {
        surface: {
          id: 'form_policy_fixture.update-base', hostId: 'form_policy_fixture.record', formVariant: 'showcase', formOperation: 'update',
          orderedSectionIds: ['details', 'private'],
          callerIds: ['form_policy_fixture.showcase'],
          contributionIds: [],
          ownershipFacts: [
            { sectionId: 'details', payloadPaths: ['name'], customFieldOwnership: { mode: 'ids', ids: ['region'], definitionSetId: 'form_policy_fixture.region-v1' } },
            { sectionId: 'private', payloadPaths: ['privateCode'], customFieldOwnership: { mode: 'none' } },
          ],
          mutationSurfaceIds: [], dependencies: [],
        },
      },
      {
        surface: {
          id: 'form_policy_fixture.update-customized', hostId: 'form_policy_fixture.record', formVariant: 'showcase', formOperation: 'update',
          orderedSectionIds: ['display', 'details'],
          callerIds: ['form_policy_fixture.showcase'],
          contributionIds: ['form_policy_fixture.display', 'form_policy_fixture.hide-private', 'form_policy_fixture.replace-details'],
          ownershipFacts: [
            { sectionId: 'details', payloadPaths: ['name'], customFieldOwnership: { mode: 'ids', ids: ['region'], definitionSetId: 'form_policy_fixture.region-v1' } },
          ],
          mutationSurfaceIds: ['form_policy_fixture.update'], dependencies: [],
        },
        mutationSurfaces: [{
          id: 'form_policy_fixture.update', kind: 'parent-submit',
          guardedFacade: { method: 'PUT', routePattern: '/form-policy-fixture/records/section-policy' },
          delegatedTarget: { kind: 'service', id: 'form_policy_fixture.update' },
          requestOperation: 'update', hostResourceKind: 'form_policy_fixture.record', mutationResourceKind: 'form_policy_fixture.record',
          optimisticLock: 'none',
        }],
        requiredSectionLeaves: [{ sectionId: 'details', payloadPath: 'name' }],
        preservedLeafPaths: ['privateCode'],
        requiredLeafLabelKeys: { privateCode: 'form_policy_fixture.fields.private' },
      },
      {
        surface: {
          id: 'form_policy_fixture.create-base', hostId: 'form_policy_fixture.record', formVariant: 'c3', formOperation: 'create',
          orderedSectionIds: ['details', 'private'],
          callerIds: ['form_policy_fixture.c3'],
          contributionIds: [],
          ownershipFacts: [
            { sectionId: 'details', payloadPaths: ['name'], customFieldOwnership: { mode: 'none' } },
            { sectionId: 'private', payloadPaths: ['privateCode'], customFieldOwnership: { mode: 'none' } },
          ],
          mutationSurfaceIds: [], dependencies: [],
        },
      },
      {
        surface: {
          id: 'form_policy_fixture.create-uncovered', hostId: 'form_policy_fixture.record', formVariant: 'c3', formOperation: 'create',
          orderedSectionIds: ['details'],
          callerIds: ['form_policy_fixture.c3'],
          contributionIds: ['form_policy_fixture.hide-uncovered'],
          ownershipFacts: [
            { sectionId: 'details', payloadPaths: ['name'], customFieldOwnership: { mode: 'none' } },
          ],
          mutationSurfaceIds: ['form_policy_fixture.create'], dependencies: [],
        },
        mutationSurfaces: [{
          id: 'form_policy_fixture.create', kind: 'parent-submit',
          guardedFacade: { method: 'POST', routePattern: '/form-policy-fixture/records/section-policy' },
          delegatedTarget: { kind: 'service', id: 'form_policy_fixture.create' },
          requestOperation: 'create', hostResourceKind: 'form_policy_fixture.record', mutationResourceKind: 'form_policy_fixture.record',
          optimisticLock: 'none',
        }],
        requiredSectionLeaves: [{ sectionId: 'details', payloadPath: 'name' }],
        requiredLeafLabelKeys: { privateCode: 'form_policy_fixture.fields.private' },
      },
    ],
  }],
  hostProviders: [{
    hostDescriptorId: 'form_policy_fixture.record-host',
    requireFeatures: [],
    authorizeHost: async ({ requestedHost }) => requestedHost.hostResourceKind === 'form_policy_fixture.record'
      && (requestedHost.hostResourceId === undefined || requestedHost.hostResourceId === 'fixture-record') ? requestedHost : null,
    readLockedRecord: async () => ({ privateCode: 'preserved-fixture-value' }),
    mutationProviders: [
      {
        mutationSurfaceId: 'form_policy_fixture.update',
        delegatedTarget: { kind: 'service', id: 'form_policy_fixture.update' },
        finalInput: 'transactional-final-input/v1',
      },
      {
        mutationSurfaceId: 'form_policy_fixture.create',
        delegatedTarget: { kind: 'service', id: 'form_policy_fixture.create' },
        finalInput: 'transactional-final-input/v1',
      },
    ],
  }],
  contributionFacts: [
    {
      id: 'form_policy_fixture.display', roundTripId: 'form_policy_fixture.display@v1', operation: 'add',
      address: { hostId: 'form_policy_fixture.record', formVariant: 'showcase', formOperation: 'update', sectionId: 'display' },
      requiredCapabilities: [{ capabilityId: 'form_policy_fixture.display-policy', protocol: 'crud-form-sections/v1', modes: ['display-only'] }],
    },
    {
      id: 'form_policy_fixture.hide-private', roundTripId: 'form_policy_fixture.hide-private@v1', operation: 'hide',
      address: { hostId: 'form_policy_fixture.record', formVariant: 'showcase', formOperation: 'update', sectionId: 'private' },
      requiredCapabilities: [{ capabilityId: 'form_policy_fixture.preserve-private', protocol: 'crud-form-sections/v1', modes: ['omit-preserves'] }],
    },
    {
      id: 'form_policy_fixture.replace-details', roundTripId: 'form_policy_fixture.replace-details@v1', operation: 'replace',
      address: { hostId: 'form_policy_fixture.record', formVariant: 'showcase', formOperation: 'update', sectionId: 'details' },
      requiredCapabilities: [{
        capabilityId: 'form_policy_fixture.accept-details', protocol: 'crud-form-sections/v1', modes: ['domain-adapter'],
        payloadPaths: ['name'], customFieldOwnership: { mode: 'ids', ids: ['region'], definitionSetId: 'form_policy_fixture.region-v1' },
        mutationSurfaceIds: ['form_policy_fixture.update'],
      }],
    },
    {
      id: 'form_policy_fixture.hide-uncovered', roundTripId: 'form_policy_fixture.hide-uncovered@v1', operation: 'hide',
      address: { hostId: 'form_policy_fixture.record', formVariant: 'c3', formOperation: 'create', sectionId: 'private' },
      requiredCapabilities: [{
        capabilityId: 'form_policy_fixture.uncovered-private', protocol: 'crud-form-sections/v1', modes: ['domain-adapter'],
        mutationSurfaceIds: ['form_policy_fixture.create'],
      }],
    },
  ],
  contributedOverrides: {
    'form_policy_fixture.record/showcase/update/display': {
      operation: 'add', contributionId: 'form_policy_fixture.display', placement: { position: 'first' as InjectionPosition },
    },
    'form_policy_fixture.record/showcase/update/private': { operation: 'hide', contributionId: 'form_policy_fixture.hide-private' },
    'form_policy_fixture.record/showcase/update/details': { operation: 'replace', contributionId: 'form_policy_fixture.replace-details' },
    'form_policy_fixture.record/c3/create/private': { operation: 'hide', contributionId: 'form_policy_fixture.hide-uncovered' },
  },
  displayPolicies: [{
    hostId: 'form_policy_fixture.record', formVariant: 'showcase', formOperation: 'update',
    capabilityId: 'form_policy_fixture.display-policy', protocol: 'crud-form-sections/v1', roundTripId: 'form_policy_fixture.display@v1',
    modes: ['display-only'], payloadPaths: [], customFieldOwnership: { mode: 'none' },
    mutationSurfaces: [], providedDataContractIds: [], allowNoopSubmit: false, requiredLeaves: [], extensionSinkSupport: 'none',
  }],
  runtimes: [
    { id: 'form_policy_fixture.record-host', roundTripId: 'form_policy_fixture.record-host@v1', load: lazyCrudFormSectionRuntime(() => import('./runtime/host.client')) },
    { id: 'form_policy_fixture.display', roundTripId: 'form_policy_fixture.display@v1', load: lazyCrudFormSectionRuntime(() => import('./runtime/display.client')) },
    { id: 'form_policy_fixture.hide-private', roundTripId: 'form_policy_fixture.hide-private@v1', load: lazyCrudFormSectionRuntime(() => import('./runtime/hide-private.client')) },
    { id: 'form_policy_fixture.replace-details', roundTripId: 'form_policy_fixture.replace-details@v1', load: lazyCrudFormSectionRuntime(() => import('./runtime/replace-details.client')) },
    { id: 'form_policy_fixture.hide-uncovered', roundTripId: 'form_policy_fixture.hide-uncovered@v1', load: lazyCrudFormSectionRuntime(() => import('./runtime/hide-uncovered.client')) },
  ],
})
