import type {
  CrudFormCustomFieldOwnershipFact,
  CrudFormExtensionSinkFact,
  CrudFormSectionCapabilityProviderFact,
  CrudFormSectionContributionFact,
  CrudFormSectionMutationSurfaceFact,
} from '../../modules/form-section-facts'
import { getAllCommandInterceptors } from '../commands/command-interceptor-store'
import { getResponseEnrichers } from './enricher-registry'
import { getAllApiInterceptors } from './interceptor-registry'
import { getAllMutationGuards } from './mutation-guard-store'

type CapabilitySourceKind =
  | 'response-enricher'
  | 'api-interceptor'
  | 'command-interceptor'
  | 'mutation-guard'
  | 'section-policy'
  | 'derived-crud-route'
  | 'compiled-extension'

type CapabilitySource = {
  kind: CapabilitySourceKind
  moduleId: string
  id: string
  features: readonly string[]
}

export type CrudFormSectionCapabilityEntry = {
  source: CapabilitySource
  fact: CrudFormSectionCapabilityProviderFact
}

export type CrudFormSectionDisplayPolicy = {
  moduleId: string
  fact: CrudFormSectionCapabilityProviderFact
}

export type CrudFormSectionCapabilityRegistry = {
  capabilities: ReadonlyMap<string, CrudFormSectionCapabilityEntry>
  rejected: ReadonlyMap<string, 'duplicate-provider' | 'invalid-provider'>
}

export type CrudFormSectionCapabilityContext = {
  activeSectionIds: ReadonlySet<string>
  activeDataContractIds: ReadonlySet<string>
  mutationSurfaces: ReadonlyMap<string, CrudFormSectionMutationSurfaceFact>
  resourceBindingIds: ReadonlySet<string>
  providedDataContractIdsByCapability: ReadonlyMap<string, readonly string[]>
  sinkAtomicityByCapability?: ReadonlyMap<string, readonly CrudFormExtensionSinkFact['atomicity'][]>
  hasActiveWritableLeaves: boolean
  hasActiveIndependentActions: boolean
}

type MatchFailure =
  | 'missing-capability'
  | 'duplicate-capability'
  | 'invalid-capability'
  | 'capability-mismatch'
  | 'dependency-mismatch'

export type CrudFormSectionCapabilityMatch =
  | { ok: true; capabilities: readonly CrudFormSectionCapabilityEntry[] }
  | { ok: false; reason: MatchFailure; capabilityId?: string }

function compareIds(left: string, right: string): number {
  if (left === right) return 0
  return left < right ? -1 : 1
}

const modes = new Set([
  'display-only', 'read-enrichment', 'omit-preserves', 'merge-server-leaves',
  'domain-adapter', 'independent-action', 'extension-sink',
])

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isArray(value: unknown): boolean {
  return Array.isArray(value)
}

function canonicalSet<Value extends string>(values: readonly Value[] = []): Value[] | null {
  if (!isArray(values) || Array.from(values).some((value) => !isNonEmptyString(value))) {
    return null
  }
  return new Set(values).size === values.length ? [...values].sort(compareIds) : null
}

function canonicalOwnership(
  ownership: CrudFormCustomFieldOwnershipFact = { mode: 'none' },
): CrudFormCustomFieldOwnershipFact | null {
  if (!ownership) return null
  if (ownership.mode === 'none') return { mode: 'none' }
  if (ownership.mode === 'all') {
    return isNonEmptyString(ownership.definitionSetId)
      ? { mode: 'all', definitionSetId: ownership.definitionSetId }
      : null
  }
  if (ownership.mode !== 'ids') return null
  if (!isArray(ownership.ids)) return null
  const ids = canonicalSet(ownership.ids)
  if (!ids || (ownership.definitionSetId !== undefined && !isNonEmptyString(ownership.definitionSetId))) return null
  return ownership.definitionSetId === undefined
    ? { mode: 'ids', ids }
    : { mode: 'ids', ids, definitionSetId: ownership.definitionSetId }
}

export function canonicalCrudFormSectionMutationSurface(surface: CrudFormSectionMutationSurfaceFact): CrudFormSectionMutationSurfaceFact | null {
  if (!surface) return null
  const { guardedFacade, delegatedTarget } = surface
  const resourceBindingIds = canonicalSet(surface.resourceBindingIds)
  if (!isNonEmptyString(surface.id) || !isNonEmptyString(guardedFacade?.routePattern)
      || !isNonEmptyString(delegatedTarget?.id) || !isNonEmptyString(surface.requestOperation)
      || !isNonEmptyString(surface.hostResourceKind) || !isNonEmptyString(surface.mutationResourceKind) || !resourceBindingIds
      || !['parent-submit', 'parent-delete', 'section-action'].includes(surface.kind)
      || !['POST', 'PUT', 'PATCH', 'DELETE'].includes(guardedFacade.method)
      || !['command', 'service'].includes(delegatedTarget.kind)
      || !['none', 'target-required', 'target-optional'].includes(surface.optimisticLock)) return null

  return {
    id: surface.id,
    kind: surface.kind,
    guardedFacade: { method: guardedFacade.method, routePattern: guardedFacade.routePattern },
    delegatedTarget: { kind: delegatedTarget.kind, id: delegatedTarget.id },
    requestOperation: surface.requestOperation,
    hostResourceKind: surface.hostResourceKind,
    mutationResourceKind: surface.mutationResourceKind,
    resourceBindingIds,
    optimisticLock: surface.optimisticLock,
  }
}

function canonicalProvider(fact: CrudFormSectionCapabilityProviderFact): CrudFormSectionCapabilityProviderFact | null {
  if (!isArray(fact.modes) || !isArray(fact.payloadPaths) || !fact.customFieldOwnership
      || !isArray(fact.providedDataContractIds) || !isArray(fact.mutationSurfaces)
      || !isArray(fact.requiredLeaves)) return null

  const providerModes = canonicalSet(fact.modes)
  const payloadPaths = canonicalSet(fact.payloadPaths)
  const customFieldOwnership = canonicalOwnership(fact.customFieldOwnership)
  const providedDataContractIds = canonicalSet(fact.providedDataContractIds)
  if (fact.protocol !== 'crud-form-sections/v1' || !isNonEmptyString(fact.hostId) || !isNonEmptyString(fact.formVariant)
      || !['create', 'update'].includes(fact.formOperation)
      || !isNonEmptyString(fact.roundTripId) || !/^[A-Za-z0-9][A-Za-z0-9._:/-]*@v[1-9][0-9]*$/.test(fact.roundTripId)
      || !providerModes?.length || !providerModes.every((mode) => modes.has(mode)) || !payloadPaths
      || !customFieldOwnership || !providedDataContractIds || typeof fact.allowNoopSubmit !== 'boolean'
      || !['none', 'after-commit', 'host-transaction'].includes(fact.extensionSinkSupport)) return null

  const surfaces = new Map<string, CrudFormSectionMutationSurfaceFact>()
  for (const declaredSurface of fact.mutationSurfaces) {
    const surface = canonicalCrudFormSectionMutationSurface(declaredSurface)
    if (!surface || surfaces.has(surface.id)) return null
    surfaces.set(surface.id, surface)
  }
  if (fact.allowNoopSubmit && (payloadPaths.length !== 0 || customFieldOwnership.mode !== 'none'
      || ![...surfaces.values()].some((surface) => surface.kind === 'parent-submit'))) return null

  const requiredLeaves = new Map<string, CrudFormSectionCapabilityProviderFact['requiredLeaves'][number]>()
  for (const leaf of fact.requiredLeaves) {
    if (!leaf) return null
    const coverage = canonicalSet(leaf.coverage)
    if (leaf.hostId !== fact.hostId || leaf.formVariant !== fact.formVariant || leaf.formOperation !== fact.formOperation
        || !isNonEmptyString(leaf.schemaId) || !isNonEmptyString(leaf.payloadPath)
        || !coverage?.length || requiredLeaves.has(leaf.payloadPath)
        || !coverage.every((mode) => ['section', 'preserve-from-record', 'server-default'].includes(mode))) return null
    requiredLeaves.set(leaf.payloadPath, {
      hostId: leaf.hostId, formVariant: leaf.formVariant, formOperation: leaf.formOperation,
      payloadPath: leaf.payloadPath, schemaId: leaf.schemaId, coverage,
    })
  }

  return {
    capabilityId: fact.capabilityId,
    protocol: fact.protocol,
    hostId: fact.hostId,
    formVariant: fact.formVariant,
    formOperation: fact.formOperation,
    roundTripId: fact.roundTripId,
    modes: providerModes,
    payloadPaths,
    customFieldOwnership,
    mutationSurfaces: [...surfaces.values()].sort((left, right) => compareIds(left.id, right.id)),
    providedDataContractIds,
    allowNoopSubmit: fact.allowNoopSubmit,
    requiredLeaves: [...requiredLeaves.values()].sort((left, right) => compareIds(left.payloadPath, right.payloadPath)),
    extensionSinkSupport: fact.extensionSinkSupport,
  }
}

function isDisplayOnly(fact: CrudFormSectionCapabilityProviderFact): boolean {
  return fact.modes.length === 1 && fact.modes[0] === 'display-only'
    && fact.payloadPaths.length === 0 && fact.customFieldOwnership.mode === 'none'
    && fact.mutationSurfaces.length === 0 && fact.providedDataContractIds.length === 0
    && !fact.allowNoopSubmit && fact.requiredLeaves.length === 0 && fact.extensionSinkSupport === 'none'
}

type CapabilityHost = {
  id: string
  features?: readonly string[]
  crudFormSectionCapabilities?: readonly CrudFormSectionCapabilityProviderFact[]
}

export function collectCrudFormSectionCapabilities(
  displayPolicies: readonly CrudFormSectionDisplayPolicy[] = [],
  derivedRoutes: readonly (CrudFormSectionDisplayPolicy & { features: readonly string[] })[] = [],
): CrudFormSectionCapabilityRegistry {
  const capabilities = new Map<string, CrudFormSectionCapabilityEntry>()
  const rejected = new Map<string, 'duplicate-provider' | 'invalid-provider'>()

  function register(
    source: Omit<CapabilitySource, 'features'>,
    features: CapabilitySource['features'] | null,
    declaration: CrudFormSectionCapabilityProviderFact,
    hasActiveHook: boolean,
  ): void {
    const id = declaration?.capabilityId
    if (!isNonEmptyString(id)) return
    if (capabilities.has(id) || rejected.has(id)) {
      capabilities.delete(id)
      rejected.set(id, 'duplicate-provider')
      return
    }
    const fact = canonicalProvider(declaration)
    if (!hasActiveHook || !features || !fact || (fact.modes.includes('display-only') && !isDisplayOnly(fact))
        || (source.kind === 'section-policy' && !isDisplayOnly(fact))) {
      rejected.set(id, 'invalid-provider')
      return
    }
    capabilities.set(id, { source: { ...source, features }, fact })
  }

  function registerHost(kind: CapabilitySourceKind, moduleId: string, host: CapabilityHost, hasActiveHook: boolean): void {
    const declarations = host.crudFormSectionCapabilities
    if (!declarations || !isArray(declarations)) return
    const features = canonicalSet(host.features)
    const source = { kind, moduleId, id: host.id }
    for (const declaration of declarations) register(source, features, declaration, hasActiveHook)
  }

  for (const { moduleId, enricher } of getResponseEnrichers()) {
    registerHost('response-enricher', moduleId, enricher, typeof enricher.enrichOne === 'function')
  }
  for (const { moduleId, interceptor } of getAllApiInterceptors()) {
    registerHost('api-interceptor', moduleId, interceptor,
      typeof interceptor.before === 'function' || typeof interceptor.after === 'function')
  }
  for (const { moduleId, interceptor } of getAllCommandInterceptors()) {
    registerHost('command-interceptor', moduleId, interceptor,
      typeof interceptor.beforeExecute === 'function' || typeof interceptor.afterExecute === 'function')
  }
  for (const { moduleId, guard } of getAllMutationGuards()) {
    registerHost('mutation-guard', moduleId, guard, typeof guard.validate === 'function')
  }
  for (const { moduleId, fact } of displayPolicies) {
    if (fact) register({ kind: 'section-policy', moduleId, id: fact.capabilityId }, [], fact, true)
  }

  for (const { moduleId, fact, features } of derivedRoutes) {
    if (fact) register({ kind: 'derived-crud-route', moduleId, id: fact.capabilityId }, canonicalSet(features), fact, true)
  }
  return { capabilities, rejected }
}

export function extendCrudFormSectionCapabilities(
  registry: CrudFormSectionCapabilityRegistry,
  compiled: readonly CrudFormSectionCapabilityEntry[],
): CrudFormSectionCapabilityRegistry {
  if (!compiled.length) return registry
  const capabilities = new Map(registry.capabilities)
  const rejected = new Map(registry.rejected)
  for (const { source, fact: declaration } of compiled) {
    const id = declaration.capabilityId
    const fact = canonicalProvider(declaration)
    if (capabilities.has(id) || rejected.has(id)) {
      capabilities.delete(id)
      rejected.set(id, 'duplicate-provider')
    } else if (!fact || (fact.modes.includes('display-only') && !isDisplayOnly(fact))) {
      rejected.set(id, 'invalid-provider')
    } else capabilities.set(id, { source, fact })
  }
  return { capabilities, rejected }
}

function sameCanonical(actual: unknown, expected: unknown): boolean {
  return expected !== null && JSON.stringify(actual) === JSON.stringify(expected)
}

export function matchCrudFormSectionCapabilities(
  registry: CrudFormSectionCapabilityRegistry,
  contribution: CrudFormSectionContributionFact,
  context: CrudFormSectionCapabilityContext,
): CrudFormSectionCapabilityMatch {
  const sections = canonicalSet(contribution.requiredSectionIds)
  const dataContracts = canonicalSet(contribution.requiredDataContractIds)
  if (!sections?.every((id) => context.activeSectionIds.has(id))
      || !dataContracts?.every((id) => context.activeDataContractIds.has(id))) {
    return { ok: false, reason: 'dependency-mismatch' }
  }
  if (!isArray(contribution.requiredCapabilities) || !contribution.requiredCapabilities.length) return { ok: false, reason: 'missing-capability' }

  const matched = new Map<string, CrudFormSectionCapabilityEntry>()
  const { hostId, formVariant, formOperation } = contribution.address
  for (const requirement of contribution.requiredCapabilities) {
    const capabilityId = requirement?.capabilityId
    if (!isNonEmptyString(capabilityId)) return { ok: false, reason: 'invalid-capability' }
    if (matched.has(capabilityId)) return { ok: false, reason: 'duplicate-capability', capabilityId }
    const rejected = registry.rejected.get(capabilityId)
    if (rejected) {
      return { ok: false, reason: rejected === 'duplicate-provider' ? 'duplicate-capability' : 'invalid-capability', capabilityId }
    }
    const entry = registry.capabilities.get(capabilityId)
    if (!entry) return { ok: false, reason: 'missing-capability', capabilityId }
    const { fact } = entry

    const declaredSurfaceIds = canonicalSet(requirement.mutationSurfaceIds)
    const declaredSurfaces = declaredSurfaceIds?.map((id) => {
      const surface = context.mutationSurfaces.get(id)
      if (surface?.id !== id) return null
      const canonical = canonicalCrudFormSectionMutationSurface(surface)
      return canonical?.resourceBindingIds?.every((bindingId) => context.resourceBindingIds.has(bindingId)) ? canonical : null
    })
    const sinkAtomicities = context.sinkAtomicityByCapability?.get(capabilityId) ?? []
    if (fact.protocol !== requirement.protocol || fact.hostId !== hostId || fact.formVariant !== formVariant
        || fact.formOperation !== formOperation || fact.roundTripId !== contribution.roundTripId
        || !sameCanonical(fact.modes, canonicalSet(requirement.modes))
        || !sameCanonical(fact.payloadPaths, canonicalSet(requirement.payloadPaths))
        || !sameCanonical(fact.customFieldOwnership, canonicalOwnership(requirement.customFieldOwnership))
        || !declaredSurfaces || declaredSurfaces.includes(null) || !sameCanonical(fact.mutationSurfaces, declaredSurfaces)
        || !sameCanonical(fact.providedDataContractIds, canonicalSet(context.providedDataContractIdsByCapability.get(capabilityId)))
        || (isDisplayOnly(fact) && contribution.operation !== 'add')
        || fact.allowNoopSubmit !== (requirement.allowNoopSubmit ?? false)
        || (fact.allowNoopSubmit && (context.hasActiveWritableLeaves || context.hasActiveIndependentActions))
        || (fact.modes.includes('extension-sink') && !sinkAtomicities.length)
        || sinkAtomicities.some((mode) => mode === 'after-commit'
          ? !requirement.allowAfterCommitSink || fact.extensionSinkSupport === 'none'
          : fact.extensionSinkSupport !== 'host-transaction')) {
      return { ok: false, reason: 'capability-mismatch', capabilityId }
    }
    matched.set(capabilityId, entry)
  }

  return { ok: true, capabilities: [...matched.values()].sort((left, right) => compareIds(left.fact.capabilityId, right.fact.capabilityId)) }
}
