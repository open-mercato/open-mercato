import { add, defineCrudFormExtension, hide, replace } from '@open-mercato/ui/backend/crud-form-extensions'

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
    ],
  }],
  hostProviders: [hostProvider],
  runtimes: [
    { id: 'form_policy_fixture.record-host', roundTripId: 'form_policy_fixture.record-host@v1', load: lazyCrudFormSectionRuntime(() => import('./runtime/host.client')) },
  ],
})

export const crudFormExtensions = [defineCrudFormExtension({
  id: 'form_policy_fixture.showcase',
  host: 'crud-form:form_policy_fixture.record',
  targets: [{ formVariant: 'showcase', formOperation: 'update' }],
  sections: {
    display: add({ before: 'details', titleKey: 'form_policy_fixture.display', fields: {} }),
    private: hide(),
    details: replace(() => import('./runtime/parity-details.client')),
  },
})]
