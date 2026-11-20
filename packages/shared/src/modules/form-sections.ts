import type { AwilixContainer } from 'awilix'
import type { EntityName, FilterQuery } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { z } from 'zod'
import type { AuthContext } from '../lib/auth/server'
import type {
  CrudFormExtensionSinkFact,
  CrudFormLeafDefaultProviderFact,
  CrudFormSectionCapabilityProviderFact,
  CrudFormSectionContributionFact,
  CrudFormSectionMutationSurfaceFact,
  CrudFormSectionSurfaceAlternativeFact,
} from './form-section-facts'
import type { FormSectionOverridesMap } from './overrides'

export type CrudFormSectionDescriptorIdentity = {
  id: string
  roundTripId: string
}

export type CrudFormSectionRuntimeModule = {
  crudFormSectionRuntime: CrudFormSectionDescriptorIdentity
}

export type CrudFormSectionRuntimeLoader<Runtime extends CrudFormSectionRuntimeModule = CrudFormSectionRuntimeModule> = () => Promise<Runtime>

export type CrudFormSectionRuntimeDeclaration = CrudFormSectionDescriptorIdentity & {
  load: CrudFormSectionRuntimeLoader
}

export type CrudFormSectionRuntimeEntry = CrudFormSectionRuntimeDeclaration & {
  kind: 'host' | 'contribution'
  moduleId: string
}

type SectionBindingValue = null | boolean | number | string | readonly SectionBindingValue[] | {
  readonly [key: string]: SectionBindingValue
}

export type CrudFormSectionHostAlternative = {
  surface: CrudFormSectionSurfaceAlternativeFact
  mutationSurfaces?: readonly CrudFormSectionMutationSurfaceFact[]
  resourceBindings?: readonly { id: string; definition: SectionBindingValue }[]
  activeDataContractIds?: readonly string[]
  providedDataContractIdsByCapability?: Readonly<Record<string, readonly string[]>>
  sinkAtomicityByCapability?: Readonly<Record<string, readonly CrudFormExtensionSinkFact['atomicity'][]>>
  requiredSectionLeaves?: readonly { sectionId: string; payloadPath: string }[]
  preservedLeafPaths?: readonly string[]
  requiredLeafLabelKeys?: Readonly<Record<string, string>>
}

export type CrudFormSectionHostFact = CrudFormSectionDescriptorIdentity & {
  hostResourceKind?: string
  alternatives?: readonly CrudFormSectionHostAlternative[]
}

export type CrudFormSectionHostAssertion = {
  hostResourceKind: string
  hostResourceId?: string
}

export type CrudFormSectionMutationProviderProof = {
  mutationSurfaceId: string
  delegatedTarget: CrudFormSectionMutationSurfaceFact['delegatedTarget']
  finalInput: 'transactional-final-input/v1'
  atomicity?: 'pessimistic-write' | 'compare-and-swap'
  contenderCoverage?: readonly ('update/update' | 'update/delete')[]
  extensionSinkSupport?: 'after-commit' | 'host-transaction'
}

type CrudFormSectionProviderScope = {
  tenantId: string
  organizationId: string | null
  allowedOrganizationIds: readonly string[] | null
}

export type CrudFormLeafDefaultReadEntityManager = {
  find<Entity extends object>(entity: EntityName<Entity>, where: FilterQuery<NoInfer<Entity>>): Promise<Entity[]>
  findOne<Entity extends object>(entity: EntityName<Entity>, where: FilterQuery<NoInfer<Entity>>): Promise<Entity | null>
  count<Entity extends object>(entity: EntityName<Entity>, where: FilterQuery<NoInfer<Entity>>): Promise<number>
}

export type CrudFormLeafDefaultProvider = {
  fact: CrudFormLeafDefaultProviderFact
  resolve(input: {
    payload: Readonly<Record<string, unknown>>
    lockedRecord: Readonly<Record<string, unknown>> | null
    scope: CrudFormSectionProviderScope
    readEm: CrudFormLeafDefaultReadEntityManager
  }): unknown | Promise<unknown>
}

export type CrudFormSectionSinkScope = {
  tenantId: string
  organizationId: string | null
}

type SinkRecord = Record<string, unknown>
type SinkMutationContext = {
  hostResourceId: string
  em: EntityManager
  scope: CrudFormSectionSinkScope
  auth: NonNullable<AuthContext>
  container: AwilixContainer
}

export type CrudFormSectionSinkSnapshot = { before: SinkRecord | null; after: SinkRecord | null }
export type CrudFormSectionSinkRow = { values: SinkRecord; updatedAt?: string | Date }

export type CrudFormSectionSink = {
  fact: CrudFormExtensionSinkFact
  capabilityId: string
  hostDetailEntityId: string
  appendOnly?: true
  schema: z.ZodType<SinkRecord>
  persist(input: SinkMutationContext & {
    values: SinkRecord
    hostOperation: 'create' | 'update'
    lockedRow: CrudFormSectionSinkRow | null
  }): Promise<CrudFormSectionSinkSnapshot>
  load(input: Omit<SinkMutationContext, 'auth'> & { userId: string }): Promise<CrudFormSectionSinkRow | null>
  lockRow?(input: SinkMutationContext): Promise<CrudFormSectionSinkRow | null>
  undo?(input: SinkMutationContext & { snapshot: CrudFormSectionSinkSnapshot }): Promise<void>
  onHostDeleted?(input: SinkMutationContext): Promise<CrudFormSectionSinkSnapshot>
}

export function defineCrudFormSectionSink<Values extends SinkRecord>(
  declaration: Omit<CrudFormSectionSink, 'schema' | 'persist'> & {
    schema: z.ZodType<Values>
    persist(input: Omit<Parameters<CrudFormSectionSink['persist']>[0], 'values'> & { values: Values }): Promise<CrudFormSectionSinkSnapshot>
  },
): CrudFormSectionSink {
  return { ...declaration, persist: (input) => declaration.persist({ ...input, values: input.values as Values }) }
}

export type CrudFormSectionHostProvider = {
  hostDescriptorId: string
  requireFeatures: readonly string[]
  mutationProviders?: readonly CrudFormSectionMutationProviderProof[]
  readLockedRecord?(input: {
    auth: NonNullable<AuthContext>
    container: AwilixContainer
    scope: CrudFormSectionProviderScope
    host: CrudFormSectionHostAssertion
    surface: CrudFormSectionMutationSurfaceFact
    transactionalEm: EntityManager
  }): Promise<Readonly<Record<string, unknown>> | null>
  authorizeHost(input: {
    auth: NonNullable<AuthContext>
    container: AwilixContainer
    scope: CrudFormSectionProviderScope
    address: { hostId: string; formVariant: string; formOperation: 'create' | 'update' }
    requestedHost: CrudFormSectionHostAssertion
  }): Promise<CrudFormSectionHostAssertion | null>
}

export type CrudFormSectionClientHostFact = CrudFormSectionDescriptorIdentity & {
  hostResourceKind?: string
  alternatives: readonly CrudFormSectionSurfaceAlternativeFact[]
}

export type CrudFormSectionServerModule = {
  moduleId: string
  sections: CrudFormSectionsDeclaration
}

export type CrudFormSectionFactEntry =
  | { kind: 'host'; moduleId: string; fact: CrudFormSectionHostFact }
  | { kind: 'contribution'; moduleId: string; fact: CrudFormSectionContributionFact }

export type CrudFormSectionsDeclaration = {
  hostFacts?: readonly CrudFormSectionHostFact[]
  contributionFacts?: readonly CrudFormSectionContributionFact[]
  hostProviders?: readonly CrudFormSectionHostProvider[]
  leafDefaultProviders?: readonly CrudFormLeafDefaultProvider[]
  sinks?: readonly CrudFormSectionSink[]
  displayPolicies?: readonly CrudFormSectionCapabilityProviderFact[]
  contributedOverrides?: Readonly<FormSectionOverridesMap>
  runtimes?: readonly CrudFormSectionRuntimeDeclaration[]
}

export function defineCrudFormSections<const Declaration extends CrudFormSectionsDeclaration>(
  declaration: Declaration,
): Declaration {
  return declaration
}

export function lazyCrudFormSectionRuntime<Runtime extends CrudFormSectionRuntimeModule>(
  load: CrudFormSectionRuntimeLoader<Runtime>,
): CrudFormSectionRuntimeLoader<Runtime> {
  return load
}
