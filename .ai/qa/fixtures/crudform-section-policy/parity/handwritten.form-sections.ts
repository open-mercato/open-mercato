import { InjectionPosition } from '@open-mercato/shared/modules/widgets/injection-position'

import { defineCrudFormSections, lazyCrudFormSectionRuntime } from '@open-mercato/shared/modules/form-sections'
import { hostProvider } from './parity-authority'

export const crudFormSections = defineCrudFormSections({
  hostFacts: [{
    id: 'form_policy_fixture.record-host',
    roundTripId: 'form_policy_fixture.record-host@v1',
    hostResourceKind: 'form_policy_fixture.record',
    alternatives: [
      {
        surface: {
          id: 'form_policy_fixture.update-base', hostId: 'form_policy_fixture.record', formVariant: 'showcase', formOperation: 'update',
          orderedSectionIds: ['details', 'private'], callerIds: ['form_policy_fixture.showcase'], contributionIds: [],
          ownershipFacts: [
            { sectionId: 'details', payloadPaths: ['name'], customFieldOwnership: { mode: 'ids', ids: ['region'], definitionSetId: 'form_policy_fixture.region-v1' } },
            { sectionId: 'private', payloadPaths: ['privateCode'], customFieldOwnership: { mode: 'none' } },
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
        requiredSectionLeaves: [
          { sectionId: 'details', payloadPath: 'name' },
          { sectionId: 'private', payloadPath: 'privateCode' },
        ],
        requiredLeafLabelKeys: { privateCode: 'form_policy_fixture.fields.private' },
      },
      {
        surface: {
          id: 'form_policy_fixture.update-base.compiled-42efd799f8c9',
          hostId: 'form_policy_fixture.record', formVariant: 'showcase', formOperation: 'update',
          orderedSectionIds: ['display', 'details'], callerIds: ['form_policy_fixture.showcase'],
          contributionIds: ['form_policy_fixture.showcase.details', 'form_policy_fixture.showcase.display', 'form_policy_fixture.showcase.private'],
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
    ],
  }],
  hostProviders: [hostProvider],
  contributionFacts: [
    {
      id: 'form_policy_fixture.showcase.display', roundTripId: 'form_policy_fixture.showcase.display@v1', operation: 'add',
      address: { hostId: 'form_policy_fixture.record', formVariant: 'showcase', formOperation: 'update', sectionId: 'display' },
      requiredCapabilities: [{ capabilityId: 'form_policy_fixture.showcase.display.compiled', protocol: 'crud-form-sections/v1', modes: ['display-only'] }],
    },
    {
      id: 'form_policy_fixture.showcase.private', roundTripId: 'form_policy_fixture.showcase.private@v1', operation: 'hide',
      address: { hostId: 'form_policy_fixture.record', formVariant: 'showcase', formOperation: 'update', sectionId: 'private' },
      requiredCapabilities: [{ capabilityId: 'form_policy_fixture.showcase.private.compiled', protocol: 'crud-form-sections/v1', modes: ['domain-adapter'], mutationSurfaceIds: ['form_policy_fixture.update'] }],
    },
    {
      id: 'form_policy_fixture.showcase.details', roundTripId: 'form_policy_fixture.showcase.details@v1', operation: 'replace',
      address: { hostId: 'form_policy_fixture.record', formVariant: 'showcase', formOperation: 'update', sectionId: 'details' },
      requiredCapabilities: [{
        capabilityId: 'form_policy_fixture.showcase.details.compiled', protocol: 'crud-form-sections/v1', modes: ['domain-adapter'],
        payloadPaths: ['name'], customFieldOwnership: { mode: 'ids', ids: ['region'], definitionSetId: 'form_policy_fixture.region-v1' },
        mutationSurfaceIds: ['form_policy_fixture.update'],
      }],
    },
  ],
  contributedOverrides: {
    'form_policy_fixture.record/showcase/update/display': {
      operation: 'add', contributionId: 'form_policy_fixture.showcase.display', placement: { position: 'before' as InjectionPosition, relativeTo: 'details' },
    },
    'form_policy_fixture.record/showcase/update/private': { operation: 'hide', contributionId: 'form_policy_fixture.showcase.private' },
    'form_policy_fixture.record/showcase/update/details': { operation: 'replace', contributionId: 'form_policy_fixture.showcase.details' },
  },
  displayPolicies: [{
    hostId: 'form_policy_fixture.record', formVariant: 'showcase', formOperation: 'update',
    capabilityId: 'form_policy_fixture.showcase.display.compiled', protocol: 'crud-form-sections/v1', roundTripId: 'form_policy_fixture.showcase.display@v1',
    modes: ['display-only'], payloadPaths: [], customFieldOwnership: { mode: 'none' },
    mutationSurfaces: [], providedDataContractIds: [], allowNoopSubmit: false, requiredLeaves: [], extensionSinkSupport: 'none',
  }],
  runtimes: [
    { id: 'form_policy_fixture.record-host', roundTripId: 'form_policy_fixture.record-host@v1', load: lazyCrudFormSectionRuntime(() => import('./runtime/host.client')) },
    { id: 'form_policy_fixture.showcase.display', roundTripId: 'form_policy_fixture.showcase.display@v1', load: lazyCrudFormSectionRuntime(() => import('./runtime/parity-display.client')) },
    { id: 'form_policy_fixture.showcase.private', roundTripId: 'form_policy_fixture.showcase.private@v1', load: lazyCrudFormSectionRuntime(() => import('./runtime/parity-hide.client')) },
    { id: 'form_policy_fixture.showcase.details', roundTripId: 'form_policy_fixture.showcase.details@v1', load: lazyCrudFormSectionRuntime(() => import('./runtime/parity-details.client')) },
  ],
})
