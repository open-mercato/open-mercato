import type { FormSectionOverride } from './overrides'

export type CrudFormSectionAddress = {
  hostId: string
  formVariant: string
  formOperation: 'create' | 'update'
  sectionId: string
}

export type CrudFormSectionCapabilityRequirement = {
  capabilityId: string
  protocol: 'crud-form-sections/v1'
  modes: readonly (
    | 'display-only'
    | 'read-enrichment'
    | 'omit-preserves'
    | 'merge-server-leaves'
    | 'domain-adapter'
    | 'independent-action'
    | 'extension-sink'
  )[]
  payloadPaths?: readonly string[]
  customFieldOwnership?: CrudFormCustomFieldOwnershipFact
  mutationSurfaceIds?: readonly string[]
  allowNoopSubmit?: boolean
  allowAfterCommitSink?: boolean
}

export type CrudFormRequiredLeafFact = {
  hostId: string
  formVariant: string
  formOperation: 'create' | 'update'
  payloadPath: string
  schemaId: string
  coverage: readonly ('section' | 'preserve-from-record' | 'server-default')[]
}

export type CrudFormLeafDefaultProviderFact = {
  id: string
  roundTripId: string
  hostId: string
  formVariant: string
  formOperation: 'create' | 'update'
  payloadPath: string
  readsPayloadPaths: readonly string[]
}

export type CrudFormExtensionSinkFact = {
  id: string
  roundTripId: string
  ownerModuleId: string
  hostId: string
  formVariant: string
  formOperation: 'create' | 'update'
  payloadPaths: readonly string[]
  targetEntityId: string
  atomicity: 'host-transaction' | 'after-commit' | 'outbox'
  externalDelivery?: {
    integrationId: string
    contractId: string
    maxAttempts: number
    preCommitValidation: 'none' | 'read-only'
    coalesce: 'latest-state'
    fencing: 'remote-monotonic-revision/v1'
  }
  optimisticLock: 'none' | 'sink-version'
  undo: 'snapshot' | 'unsupported'
}

export type CrudFormCustomFieldOwnershipFact =
  | { mode: 'none' }
  | { mode: 'ids'; ids: readonly string[]; definitionSetId?: string }
  | { mode: 'all'; definitionSetId: string }

export type CrudFormSectionContributionFact = {
  id: string
  address: CrudFormSectionAddress
  operation: FormSectionOverride['operation']
  roundTripId: string
  requiredCapabilities: readonly CrudFormSectionCapabilityRequirement[]
  requiredSectionIds?: readonly string[]
  requiredDataContractIds?: readonly string[]
}

export type CrudFormSectionDependencyFact = {
  consumerContributionId: string
  requiredSectionIds: readonly string[]
  requiredDataContractIds: readonly string[]
}

export type CrudFormSectionMutationSurfaceFact = {
  id: string
  kind: 'parent-submit' | 'parent-delete' | 'section-action'
  guardedFacade: { method: 'POST' | 'PUT' | 'PATCH' | 'DELETE'; routePattern: string }
  delegatedTarget: { kind: 'command' | 'service'; id: string }
  requestOperation: string
  hostResourceKind: string
  mutationResourceKind: string
  resourceBindingIds?: readonly string[]
  optimisticLock: 'none' | 'target-required' | 'target-optional'
}

export type CrudFormSectionClientMutationFact = Omit<CrudFormSectionMutationSurfaceFact,
  'delegatedTarget' | 'resourceBindingIds'>

export type CrudFormSectionCapabilityProviderFact = {
  capabilityId: string
  protocol: 'crud-form-sections/v1'
  hostId: string
  formVariant: string
  formOperation: 'create' | 'update'
  roundTripId: string
  modes: CrudFormSectionCapabilityRequirement['modes']
  payloadPaths: readonly string[]
  customFieldOwnership: CrudFormCustomFieldOwnershipFact
  mutationSurfaces: readonly CrudFormSectionMutationSurfaceFact[]
  providedDataContractIds: readonly string[]
  allowNoopSubmit: boolean
  requiredLeaves: readonly CrudFormRequiredLeafFact[]
  extensionSinkSupport: 'none' | 'after-commit' | 'host-transaction'
}

export type CrudFormSectionSurfaceAlternativeFact = {
  id: string
  hostId: string | null
  formVariant: string
  formOperation: 'create' | 'update'
  orderedSectionIds: readonly string[]
  callerIds: readonly string[]
  contributionIds: readonly string[]
  ownershipFacts: readonly {
    sectionId: string
    payloadPaths: readonly string[]
    customFieldOwnership: CrudFormCustomFieldOwnershipFact
  }[]
  mutationSurfaceIds: readonly string[]
  clientMutationSurfaces?: readonly CrudFormSectionClientMutationFact[]
  dependencies: readonly CrudFormSectionDependencyFact[]
}
