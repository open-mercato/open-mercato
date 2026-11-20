import { createHash } from 'node:crypto'
import { createLogger } from '../../logger'
import { composeFormSectionOverrides, type FormSectionOverridesMap } from '../../../modules/overrides'
import type {
  CrudFormSectionAddress,
  CrudFormSectionContributionFact,
  CrudFormSectionMutationSurfaceFact,
  CrudFormSectionSurfaceAlternativeFact,
} from '../../../modules/form-section-facts'
import type {
  CrudFormLeafDefaultProvider,
  CrudFormSectionClientHostFact,
  CrudFormSectionHostAlternative,
  CrudFormSectionHostFact,
  CrudFormSectionHostProvider,
  CrudFormSectionMutationProviderProof,
  CrudFormSectionServerModule,
  CrudFormSectionSink,
} from '../../../modules/form-sections'
import {
  canonicalCrudFormSectionMutationSurface,
  collectCrudFormSectionCapabilities,
  extendCrudFormSectionCapabilities,
  matchCrudFormSectionCapabilities,
  type CrudFormSectionCapabilityEntry,
} from '../form-section-capabilities'
import {
  applyCrudFormSectionPlacements,
  canonicalCrudFormSectionAlternative,
  canonicalSectionJson,
  compareSectionIds,
  crudFormSectionClientFingerprintInput,
  crudFormSectionConfiguredHosts,
  hasCrudFormSectionWritableLeaves,
  type CrudFormSectionConfiguredHostLedger,
} from './composition'
import { symbolicIdSchema } from './protocol'
import { bindCompiledCrudFormSink, type CompiledCrudFormFieldRule, type CompiledCrudFormContribution } from './compiled-extensions'
import { parseCrudFormSectionClientMutationFacts, projectCrudFormSectionClientMutationFact } from './client-mutation-facts'
import { getDerivedCrudRouteCapabilities } from './factory-route-source'
import {
  collectCrudFormSectionSinks, crudFormSectionSinkAtomicities, selectCrudFormSectionSinks,
  type AcceptedCrudFormSectionSink,
} from './extension-sinks'
import { selectCrudFormRequiredLeaves, type CrudFormRequiredLeafCoverage } from './required-leaves'

export type CrudFormSectionAcceptedPolicy = {
  hostDescriptorId: string
  hostResourceKind: string
  surface: CrudFormSectionSurfaceAlternativeFact
  capabilities: readonly CrudFormSectionCapabilityEntry[]
  mutationSurfaces: readonly CrudFormSectionMutationSurfaceFact[]
  mutationProviders: readonly CrudFormSectionMutationProviderProof[]
  requiredLeaves: readonly CrudFormRequiredLeafCoverage[]
  sinks?: readonly AcceptedCrudFormSectionSink[]
  bindings: NonNullable<CrudFormSectionHostAlternative['resourceBindings']>
  requireFeatures: readonly string[]
  roundTripIds: readonly string[]
  clientFingerprint: string
}

export type CrudFormSectionManifest = {
  ledger: CrudFormSectionConfiguredHostLedger
  policies: ReadonlyMap<string, CrudFormSectionAcceptedPolicy>
  providers: ReadonlyMap<string, CrudFormSectionHostProvider & { hostResourceKind: string }>
  compiledFieldRules?: ReadonlyMap<string, readonly { address: CrudFormSectionAddress; rule: CompiledCrudFormFieldRule }[]>
  leafDefaultProviders: ReadonlyMap<string, CrudFormLeafDefaultProvider>
  sinkRuntimes?: ReadonlyMap<string, CrudFormSectionSink>
}

type ExistingHost = {
  fact: CrudFormSectionHostFact
  provider: CrudFormSectionHostProvider | undefined
}

const logger = createLogger('shared:crud-form-sections')

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function uniqueIndex<Entry>(entries: readonly Entry[], key: (entry: Entry) => string): Map<string, Entry> {
  const index = new Map<string, Entry>()
  const collisions = new Set<string>()
  for (const entry of entries) {
    const id = key(entry)
    if (index.has(id)) {
      index.delete(id)
      collisions.add(id)
    } else if (!collisions.has(id)) {
      index.set(id, entry)
    }
  }
  return index
}

function hasSameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && [...left].sort(compareSectionIds).every((id, index) => id === right[index])
}

function uniqueIds(values: readonly string[]): boolean {
  return values.every((value) => symbolicIdSchema.safeParse(value).success) && new Set(values).size === values.length
}

function validOwnership(surface: CrudFormSectionSurfaceAlternativeFact): boolean {
  const active = new Set(surface.orderedSectionIds)
  if (!uniqueIds(surface.ownershipFacts.map((entry) => entry.sectionId))) return false
  const paths = new Set<string>()
  const fields = new Set<string>()
  let ownsAllFields = false
  for (const { sectionId, payloadPaths, customFieldOwnership } of surface.ownershipFacts) {
    if (!active.has(sectionId)) return false
    for (const path of payloadPaths) {
      if (!path || paths.has(path)) return false
      paths.add(path)
    }
    if (customFieldOwnership.mode === 'none') continue
    if (ownsAllFields) return false
    if (customFieldOwnership.mode === 'all') {
      if (fields.size || !customFieldOwnership.definitionSetId) return false
      ownsAllFields = true
      continue
    }
    for (const id of customFieldOwnership.ids) {
      if (!id || fields.has(id)) return false
      fields.add(id)
    }
  }
  for (const path of paths) {
    const parts = path.split('.')
    if (parts.some((part) => !part)) return false
    if (parts.some((_part, index) => index > 0 && paths.has(parts.slice(0, index).join('.')))) return false
  }
  return true
}

function hasMutationProviderProof(
  surface: CrudFormSectionMutationSurfaceFact,
  proofs: ReadonlyMap<string, CrudFormSectionMutationProviderProof>,
): boolean {
  const proof = proofs.get(surface.id)
  if (!proof || proof.finalInput !== 'transactional-final-input/v1'
      || proof.delegatedTarget?.kind !== surface.delegatedTarget.kind
      || proof.delegatedTarget.id !== surface.delegatedTarget.id) return false
  if (surface.optimisticLock === 'none') return true
  return (proof.atomicity === 'pessimistic-write' || proof.atomicity === 'compare-and-swap')
    && Array.isArray(proof.contenderCoverage) && proof.contenderCoverage.length === 2
    && proof.contenderCoverage.includes('update/update') && proof.contenderCoverage.includes('update/delete')
}

function hasTuple(
  surface: Omit<CrudFormSectionAddress, 'hostId' | 'sectionId'> & { hostId: string | null },
  address: Omit<CrudFormSectionAddress, 'sectionId'>,
): boolean {
  return surface.hostId === address.hostId && surface.formVariant === address.formVariant
    && surface.formOperation === address.formOperation
}

function deriveCompiledCapabilities(
  { moduleId, contribution }: CompiledCrudFormContribution & { moduleId: string },
  surfaces: readonly CrudFormSectionMutationSurfaceFact[],
  authorities: Iterable<CrudFormSectionCapabilityEntry>,
  mutationProofs: ReadonlyMap<string, CrudFormSectionMutationProviderProof>,
): CrudFormSectionCapabilityEntry[] {
  const { hostId, formVariant, formOperation } = contribution.address
  return contribution.requiredCapabilities.flatMap((requirement) => {
    const ids = requirement.mutationSurfaceIds ?? []
    const matched = surfaces.filter(({ id }) => ids.includes(id))
    const supports = [...authorities].filter(({ fact }) => fact.hostId === hostId && fact.formVariant === formVariant
      && fact.formOperation === formOperation && fact.modes.some((mode) =>
        mode === 'domain-adapter' || mode === 'merge-server-leaves' || mode === 'omit-preserves')
      && matched.some((surface) => fact.mutationSurfaces.some((candidate) =>
        canonicalSectionJson(candidate) === canonicalSectionJson(surface))))
    const displayOnly = contribution.operation === 'add' && requirement.modes.length === 1 && requirement.modes[0] === 'display-only'
    if (!displayOnly && (!matched.length || matched.length !== ids.length || matched.some((surface) =>
      !supports.some(({ fact }) => fact.mutationSurfaces.some((candidate) =>
        canonicalSectionJson(candidate) === canonicalSectionJson(surface)))))) return []
    const proofSupports = matched.map(({ id }) => mutationProofs.get(id)?.extensionSinkSupport)
    const extensionSinkSupport = proofSupports.length && proofSupports.every((support) => support === 'host-transaction')
      ? 'host-transaction' : proofSupports.length && proofSupports.every((support) => support === 'host-transaction' || support === 'after-commit')
        ? 'after-commit' : 'none'
    return [{
      source: { kind: 'compiled-extension', id: requirement.capabilityId, moduleId,
        features: [...new Set(supports.flatMap(({ source }) => source.features))].sort(compareSectionIds) },
      fact: {
        hostId, formVariant, formOperation, protocol: requirement.protocol,
        capabilityId: requirement.capabilityId, roundTripId: contribution.roundTripId, modes: requirement.modes,
        payloadPaths: requirement.payloadPaths ?? [], customFieldOwnership: requirement.customFieldOwnership ?? { mode: 'none' },
        mutationSurfaces: matched, providedDataContractIds: [], allowNoopSubmit: false,
        requiredLeaves: [], extensionSinkSupport: requirement.modes.includes('extension-sink') ? extensionSinkSupport : 'none',
      },
    }]
  })
}

export function buildCrudFormSectionManifest(
  modules: readonly CrudFormSectionServerModule[],
  overrides: Readonly<FormSectionOverridesMap> = composeFormSectionOverrides(Object.assign(
    {},
    ...modules.map(({ sections }) => sections.contributedOverrides),
    ...modules.map(({ sections }) => sections.compiledSectionOverrides),
  )),
): CrudFormSectionManifest {
  const policies = new Map<string, CrudFormSectionAcceptedPolicy>()
  const compiledRulesByPolicy = new Map<string, readonly { address: CrudFormSectionAddress; rule: CompiledCrudFormFieldRule }[]>()
  const providers = new Map<string, CrudFormSectionHostProvider & { hostResourceKind: string }>()
  const hosts = modules.flatMap(({ sections }): ExistingHost[] => {
    const moduleProviders = uniqueIndex(sections.hostProviders ?? [], (provider) => provider.hostDescriptorId)
    return (sections.hostFacts ?? []).map((fact) => ({ fact, provider: moduleProviders.get(fact.id) }))
  })
  const hostFacts: CrudFormSectionClientHostFact[] = hosts.map(({ fact }) => ({
    id: fact.id, roundTripId: fact.roundTripId, hostResourceKind: fact.hostResourceKind,
    alternatives: (fact.alternatives ?? []).map(({ surface }) => surface),
  }))
  const configured = crudFormSectionConfiguredHosts(hostFacts, overrides)
  const configuredEntries = [...configured.entries()].sort(([left], [right]) => compareSectionIds(left, right))
  const defaults = modules.flatMap(({ sections }) => sections.leafDefaultProviders ?? []).filter((provider) => Boolean(provider?.fact?.id))
  const compiled = uniqueIndex(modules.flatMap(({ moduleId, sections }) =>
    (sections.compiledContributions ?? []).map((entry) => ({ ...entry, moduleId }))), ({ contribution }) => contribution.id)
  const compiledDefaults = [...compiled.values()].flatMap((entry) => entry.defaults ?? [])
  const compiledDefaultIds = new Set(compiledDefaults.map(({ fact }) => fact.id))
  const leafDefaultProviders = uniqueIndex([...defaults, ...compiledDefaults], ({ fact }) => fact.id)
  const sinkRuntimes = collectCrudFormSectionSinks([...modules, ...[...compiled.values()].flatMap(({ contribution, sinkAssociations }) =>
    (sinkAssociations ?? []).flatMap((association) => {
      const sink = bindCompiledCrudFormSink(association, contribution.address)
      return sink ? [{ moduleId: association.ownerModuleId, sections: { sinks: [sink] } }] : []
    }))])
  if (!configuredEntries.length) return { ledger: { hosts: [], fingerprint: hash('[]') }, policies, providers, leafDefaultProviders, sinkRuntimes }

  const capabilityRegistry = collectCrudFormSectionCapabilities(
    modules.flatMap(({ moduleId, sections }) => (sections.displayPolicies ?? []).map((fact) => ({ moduleId, fact }))),
    modules.flatMap(({ moduleId, sections }) => getDerivedCrudRouteCapabilities(sections).map((entry) => ({ moduleId, ...entry }))),
  )
  const contributions = uniqueIndex(
    modules.flatMap(({ sections }) => sections.contributionFacts ?? []),
    (contribution) => contribution.id,
  )
  const hostsById = uniqueIndex(hosts, ({ fact }) => fact.id)

  for (const [key, configuration] of configuredEntries) {
    const { address } = configuration
    const candidates = hosts.flatMap(({ fact, provider }) => (fact.alternatives ?? [])
      .filter(({ surface }) => hasTuple(surface, address))
      .map((alternative) => ({ fact, provider, alternative })))
    const ownerIds = new Set(candidates.map(({ fact }) => fact.id))
    const [hostId] = ownerIds
    const host = hostId ? hostsById.get(hostId) : undefined
    const provider = ownerIds.size === 1 ? host?.provider : undefined
    const resourceKind = symbolicIdSchema.safeParse(host?.fact.hostResourceKind)
    if (provider && typeof provider.authorizeHost === 'function' && resourceKind.success
        && Array.isArray(provider.requireFeatures) && uniqueIds(provider.requireFeatures)) {
      providers.set(key, { ...provider, hostResourceKind: resourceKind.data })
    }

    const fail = (reason: string, contributionId?: string) => {
      logger.warn('Rejected configured CrudForm section policy', { ...address, reason, contributionId })
    }
    const effective = [...configuration.overrides.entries()]
    const ids = effective.map(([, override]) => override?.contributionId).sort(compareSectionIds)
    const matches = candidates.filter(({ alternative }) => hasSameIds(alternative.surface.contributionIds, ids))
    const baselines = candidates.filter(({ alternative }) => alternative.surface.contributionIds.length === 0)
    if (configuration.invalid || !host || !resourceKind.success || !providers.has(key) || matches.length !== 1
        || baselines.length !== 1 || !uniqueIds(ids)) {
      fail('invalid_alternative')
      continue
    }
    const { alternative } = matches[0]
    const { surface, mutationSurfaces = [], resourceBindings = [], activeDataContractIds = [],
      providedDataContractIdsByCapability = {}, sinkAtomicityByCapability = {} } = alternative
    const mutationProviders = uniqueIndex(provider?.mutationProviders ?? [], (proof) => proof.mutationSurfaceId)
    const canonicalSurfaces = mutationSurfaces.flatMap((candidate) => {
      const normalized = canonicalCrudFormSectionMutationSurface(candidate)
      return normalized ? [normalized] : []
    }).sort((left, right) => compareSectionIds(left.id, right.id))
    if (canonicalSurfaces.length !== mutationSurfaces.length
        || canonicalSurfaces.some((candidate) => !hasMutationProviderProof(candidate, mutationProviders))) {
      fail('invalid_mutation_provider')
      continue
    }
    const baseSections = new Set(baselines[0].alternative.surface.orderedSectionIds)
    const activeSections = new Set(surface.orderedSectionIds)
    const selectedContributions: CrudFormSectionContributionFact[] = []
    for (const [sectionId, override] of effective) {
      const contribution = contributions.get(override.contributionId)
      if (!contribution || !hasTuple(contribution.address, address)
          || contribution.address.sectionId !== sectionId || contribution.operation !== override.operation
          || baseSections.has(sectionId) !== (override.operation !== 'add')
          || activeSections.has(sectionId) !== (override.operation !== 'hide')) break
      selectedContributions.push(contribution)
    }
    const ordered = applyCrudFormSectionPlacements(baselines[0].alternative.surface.orderedSectionIds, configuration.overrides)
    if (selectedContributions.length !== effective.length || !ordered || ordered.length !== surface.orderedSectionIds.length
        || ordered.some((id, index) => id !== surface.orderedSectionIds[index])
        || !uniqueIds(surface.orderedSectionIds) || !uniqueIds(surface.callerIds) || !validOwnership(surface)
        || !uniqueIds(surface.dependencies.map((dependency) => dependency.consumerContributionId))
        || !uniqueIds(activeDataContractIds) || !uniqueIds(resourceBindings.map((binding) => binding.id))
        || !uniqueIds(surface.mutationSurfaceIds) || !uniqueIds(mutationSurfaces.map((candidate) => candidate.id))
        || !hasSameIds(surface.mutationSurfaceIds, mutationSurfaces.map((candidate) => candidate.id).sort(compareSectionIds))) {
      fail('invalid_surface_facts')
      continue
    }
    const dataContracts = new Set(activeDataContractIds)
    if (surface.dependencies.some(({ requiredSectionIds, requiredDataContractIds }) =>
      !uniqueIds(requiredSectionIds) || !requiredSectionIds.every((id) => activeSections.has(id))
        || !uniqueIds(requiredDataContractIds) || !requiredDataContractIds.every((id) => dataContracts.has(id)),
    )) {
      fail('invalid_surface_dependencies')
      continue
    }

    const effectiveSinkAtomicities = crudFormSectionSinkAtomicities(sinkRuntimes.values(), address)
    if (Object.entries(sinkAtomicityByCapability).some(([id, modes]) =>
      !hasSameIds(modes, [...(effectiveSinkAtomicities.get(id) ?? [])].sort(compareSectionIds)))) {
      fail('invalid_sink_atomicity')
      continue
    }
    const compiledEntries = selectedContributions.flatMap((contribution) => {
      const entry = compiled.get(contribution.id)
      return entry && entry.contribution === contribution ? [entry] : []
    })
    const scopedCapabilityRegistry = extendCrudFormSectionCapabilities(capabilityRegistry, compiledEntries.flatMap((entry) =>
      deriveCompiledCapabilities(entry, canonicalSurfaces, capabilityRegistry.capabilities.values(), mutationProviders)))
    const compiledFieldRules = compiledEntries.flatMap(({ contribution, fieldRules }) =>
      (fieldRules ?? []).map((rule) => ({ address: contribution.address, rule })))
    const activeDefaultIds = new Set(compiledEntries.flatMap((entry) => (entry.defaults ?? []).map(({ fact }) => fact.id)))
    const selectedDefaultIds = alternative.compiledDefaultProviderIds ?? []
    if (selectedDefaultIds.some((id) => !compiledDefaultIds.has(id) || !activeDefaultIds.has(id) || !leafDefaultProviders.has(id))
        || compiledFieldRules.some(({ address: fieldAddress, rule }) => !surface.ownershipFacts.some(({ sectionId, payloadPaths, customFieldOwnership }) =>
          sectionId === fieldAddress.sectionId && (payloadPaths.includes(rule.payloadPath)
            || (rule.payloadPath.startsWith('customFields.') && customFieldOwnership.mode === 'ids'
              && customFieldOwnership.ids.includes(rule.payloadPath.slice('customFields.'.length))))))) {
      fail('invalid_compiled_extension_binding')
      continue
    }
    const matchedCapabilities = new Map<string, CrudFormSectionCapabilityEntry>()
    let policyValid = true
    for (const contribution of selectedContributions) {
      const match = matchCrudFormSectionCapabilities(scopedCapabilityRegistry, contribution, {
        activeSectionIds: activeSections,
        activeDataContractIds: dataContracts,
        mutationSurfaces: new Map(mutationSurfaces.map((candidate) => [candidate.id, candidate])),
        resourceBindingIds: new Set(resourceBindings.map((binding) => binding.id)),
        providedDataContractIdsByCapability: new Map(Object.entries(providedDataContractIdsByCapability)),
        sinkAtomicityByCapability: effectiveSinkAtomicities,
        hasActiveWritableLeaves: hasCrudFormSectionWritableLeaves(surface),
        hasActiveIndependentActions: mutationSurfaces.some((candidate) => candidate.kind === 'section-action'),
      })
      if (!match.ok) {
        fail(match.reason, contribution.id)
        policyValid = false
        break
      }
      for (const entry of match.capabilities) matchedCapabilities.set(entry.fact.capabilityId, entry)
    }
    if (!policyValid) continue

    const required = selectCrudFormRequiredLeaves({
      alternative, surfaces: canonicalSurfaces, capabilities: scopedCapabilityRegistry.capabilities.values(),
      defaultProviders: [...defaults, ...selectedDefaultIds.map((id) => leafDefaultProviders.get(id)!)], canReadLockedRecord: typeof provider?.readLockedRecord === 'function',
    })
    if (!required.ok) {
      fail(required.reason)
      continue
    }
    for (const entry of required.capabilities) matchedCapabilities.set(entry.fact.capabilityId, entry)

    const descriptors = [host.fact, ...selectedContributions]
    const clientMutationSurfaces = parseCrudFormSectionClientMutationFacts(
      surface.mutationSurfaceIds, canonicalSurfaces.map(projectCrudFormSectionClientMutationFact),
    )
    if (!clientMutationSurfaces || clientMutationSurfaces.some(({ hostResourceKind }) => hostResourceKind !== resourceKind.data)) {
      fail('invalid_client_mutation_surface')
      continue
    }
    const capabilities = [...matchedCapabilities.values()]
      .sort((left, right) => compareSectionIds(left.fact.capabilityId, right.fact.capabilityId))
    const parentSubmits = canonicalSurfaces.filter(({ kind, requestOperation }) =>
      kind === 'parent-submit' && requestOperation === address.formOperation)
    const allowNoopSubmit = parentSubmits.length === 1 && !hasCrudFormSectionWritableLeaves(surface)
      && !canonicalSurfaces.some(({ kind }) => kind === 'section-action')
      && capabilities.some(({ fact }) => fact.allowNoopSubmit
        && fact.mutationSurfaces.some(({ id }) => id === parentSubmits[0].id)
        && selectedContributions.some(({ requiredCapabilities }) => requiredCapabilities.some((requirement) =>
          requirement.capabilityId === fact.capabilityId && requirement.allowNoopSubmit === true)))
    if ((surface.allowNoopSubmit ?? false) !== allowNoopSubmit) {
      fail('invalid_noop_submit')
      continue
    }
    const canonicalSurface = canonicalCrudFormSectionAlternative({ ...surface, clientMutationSurfaces, allowNoopSubmit })
    const sinks = selectCrudFormSectionSinks({
      candidates: sinkRuntimes.values(), address, capabilities, hostResourceKind: resourceKind.data,
      ownedPaths: new Set(surface.ownershipFacts.flatMap(({ payloadPaths }) => payloadPaths)),
    })
    if (!sinks) {
      fail('invalid_extension_sink')
      continue
    }
    const supportsAtomicSinks = sinks.some(({ fact }) => fact.atomicity !== 'after-commit')
    const parentSurfaces = canonicalSurfaces.filter(({ kind }) => kind === 'parent-submit' || kind === 'parent-delete')
    if (sinks.length && (!parentSurfaces.some(({ kind }) => kind === 'parent-submit') || parentSurfaces.some((candidate) => {
      const support = mutationProviders.get(candidate.id)?.extensionSinkSupport
      return supportsAtomicSinks
        ? support !== 'host-transaction' || candidate.delegatedTarget.kind !== 'command'
        : support !== 'host-transaction' && support !== 'after-commit'
    }))) {
      fail('unsupported_extension_sink_lifecycle')
      continue
    }
    if (compiledFieldRules.length) compiledRulesByPolicy.set(key, compiledFieldRules)
    policies.set(key, {
      hostDescriptorId: host.fact.id,
      hostResourceKind: resourceKind.data,
      surface: canonicalSurface,
      capabilities,
      mutationSurfaces: canonicalSurfaces,
      requiredLeaves: required.leaves,
      ...(sinks.length ? { sinks } : {}),
      mutationProviders: canonicalSurfaces.map((candidate) => {
        const proof = mutationProviders.get(candidate.id)!
        return {
          mutationSurfaceId: proof.mutationSurfaceId,
          delegatedTarget: { kind: proof.delegatedTarget.kind, id: proof.delegatedTarget.id },
          finalInput: proof.finalInput,
          atomicity: proof.atomicity,
          contenderCoverage: proof.contenderCoverage?.slice().sort(compareSectionIds),
          extensionSinkSupport: proof.extensionSinkSupport,
        }
      }),
      bindings: [...resourceBindings].sort((left, right) => compareSectionIds(left.id, right.id)),
      requireFeatures: [...new Set([...(provider?.requireFeatures ?? []), ...capabilities.flatMap((entry) => entry.source.features)])].sort(compareSectionIds),
      roundTripIds: descriptors.map(({ roundTripId }) => roundTripId).sort(compareSectionIds),
      clientFingerprint: hash(crudFormSectionClientFingerprintInput(canonicalSurface, descriptors, configuration.overrides)),
    })
  }
  return {
    ledger: {
      hosts: configuredEntries.map(([, configuration]) => configuration.address),
      fingerprint: hash(canonicalSectionJson({
        configured: configuredEntries.map(([key, { overrides: effective }]) =>
          [key, [...effective.entries()].sort(([left], [right]) => compareSectionIds(left, right))]),
        accepted: [...policies.entries()],
      })),
    },
    policies,
    providers,
    ...(compiledRulesByPolicy.size ? { compiledFieldRules: compiledRulesByPolicy } : {}),
    leafDefaultProviders,
    sinkRuntimes,
  }
}

const manifestKey = Symbol.for('openMercato.crud-form-section-manifest')
const defaultManifest: CrudFormSectionManifest = {
  ledger: { hosts: [], fingerprint: hash('[]') },
  policies: new Map(),
  providers: new Map(),
  leafDefaultProviders: new Map(),
}
const registry = globalThis as typeof globalThis & { [manifestKey]?: CrudFormSectionManifest }

export function registerCrudFormSectionManifest(modules: readonly CrudFormSectionServerModule[]): void {
  registry[manifestKey] = buildCrudFormSectionManifest(modules)
}

export function getCrudFormSectionManifest(): CrudFormSectionManifest {
  return registry[manifestKey] ?? defaultManifest
}
