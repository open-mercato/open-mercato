import type { AwilixContainer } from 'awilix'
import type { AuthContext } from '../lib/auth/server'
import type {
  CrudFormExtensionSinkFact,
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
}

export type CrudFormSectionHostFact = CrudFormSectionDescriptorIdentity & {
  hostResourceKind?: string
  alternatives?: readonly CrudFormSectionHostAlternative[]
}

export type CrudFormSectionHostAssertion = {
  hostResourceKind: string
  hostResourceId?: string
}

export type CrudFormSectionHostProvider = {
  hostDescriptorId: string
  requireFeatures: readonly string[]
  authorizeHost(input: {
    auth: NonNullable<AuthContext>
    container: AwilixContainer
    scope: { tenantId: string; organizationId: string | null; allowedOrganizationIds: readonly string[] | null }
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
