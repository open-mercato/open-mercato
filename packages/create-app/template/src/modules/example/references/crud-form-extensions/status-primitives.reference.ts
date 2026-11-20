import type {
  CrudFormSectionAddress, CrudFormSectionCapabilityProviderFact,
  CrudFormSectionContributionFact, CrudFormSectionMutationSurfaceFact,
} from '@open-mercato/shared/modules/form-section-facts'
import { defineCrudFormSections, lazyCrudFormSectionRuntime } from '@open-mercato/shared/modules/form-sections'

const replacementId = 'example.todo-showcase-status'
const replacementRevision = 'example.todo-showcase-status@v3'
const capabilityId = 'example.todo-showcase-status.manual'
const address = {
  hostId: 'example.todo',
  formVariant: 'showcase',
  formOperation: 'update',
  sectionId: 'status',
} as const satisfies CrudFormSectionAddress

const submit = {
  id: 'example.todo-showcase-update.update',
  kind: 'parent-submit',
  guardedFacade: { method: 'PUT', routePattern: '/example/todos/section-policy' },
  delegatedTarget: { kind: 'command', id: 'example.todos.update' },
  requestOperation: 'update',
  hostResourceKind: 'example.todo',
  mutationResourceKind: 'example.todo',
  optimisticLock: 'target-required',
} as const satisfies CrudFormSectionMutationSurfaceFact

export const statusAlternative = {
  contributionId: replacementId,
  ownership: { sectionId: 'status', payloadPaths: ['is_done'], customFieldOwnership: { mode: 'none' } },
  requiredLeaf: { sectionId: 'status', payloadPath: 'is_done' },
} as const

export const statusCapability = {
  capabilityId,
  protocol: 'crud-form-sections/v1',
  hostId: address.hostId,
  formVariant: address.formVariant,
  formOperation: address.formOperation,
  roundTripId: replacementRevision,
  modes: ['domain-adapter'],
  payloadPaths: statusAlternative.ownership.payloadPaths,
  customFieldOwnership: statusAlternative.ownership.customFieldOwnership,
  mutationSurfaces: [submit],
  providedDataContractIds: [],
  allowNoopSubmit: false,
  requiredLeaves: [],
  extensionSinkSupport: 'none',
} as const satisfies CrudFormSectionCapabilityProviderFact

const contribution = {
  id: replacementId,
  address,
  operation: 'replace',
  roundTripId: replacementRevision,
  requiredCapabilities: [{
    capabilityId,
    protocol: 'crud-form-sections/v1',
    modes: ['domain-adapter'],
    payloadPaths: statusAlternative.ownership.payloadPaths,
    customFieldOwnership: statusAlternative.ownership.customFieldOwnership,
    mutationSurfaceIds: [submit.id],
  }],
} as const satisfies CrudFormSectionContributionFact

export const statusSectionPrimitives = defineCrudFormSections({
  contributionFacts: [contribution],
  contributedOverrides: {
    'example.todo/showcase/update/status': { operation: 'replace', contributionId: replacementId },
  },
  runtimes: [{
    id: replacementId,
    roundTripId: replacementRevision,
    load: lazyCrudFormSectionRuntime(() => import('../../todo-showcase-status.client')),
  }],
})
