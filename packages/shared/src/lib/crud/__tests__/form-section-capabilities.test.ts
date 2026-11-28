import type {
  CrudFormSectionCapabilityProviderFact,
  CrudFormSectionContributionFact,
  CrudFormSectionMutationSurfaceFact,
} from '../../../modules/form-section-facts'
import {
  applyApiInterceptorOverrides,
  applyModuleOverridesFromEnabledModules,
  resetModuleContractOverridesForTests,
} from '../../../modules/overrides'
import { registerCommandInterceptors } from '../../commands/command-interceptor-store'
import type { ApiInterceptor } from '../api-interceptor'
import { registerResponseEnrichers } from '../enricher-registry'
import {
  collectCrudFormSectionCapabilities,
  matchCrudFormSectionCapabilities,
  type CrudFormSectionCapabilityContext,
} from '../form-section-capabilities'
import { registerApiInterceptors } from '../interceptor-registry'
import { registerMutationGuards } from '../mutation-guard-store'

const capabilityId = 'catalog.product.policy'
const submitted: CrudFormSectionMutationSurfaceFact = {
  id: 'catalog.product.update',
  kind: 'parent-submit',
  guardedFacade: { method: 'PATCH', routePattern: '/api/catalog/products/[id]' },
  delegatedTarget: { kind: 'command', id: 'catalog.products.update' },
  requestOperation: 'update',
  hostResourceKind: 'catalog.product',
  mutationResourceKind: 'catalog.product',
  resourceBindingIds: ['catalog.product.binding/v1'],
  optimisticLock: 'target-required',
}

const provider: CrudFormSectionCapabilityProviderFact = {
  capabilityId,
  protocol: 'crud-form-sections/v1',
  hostId: 'catalog.product',
  formVariant: 'default',
  formOperation: 'update',
  roundTripId: 'shared.product.commercial@v1',
  modes: ['read-enrichment', 'domain-adapter'],
  payloadPaths: ['pricing.cost', 'pricing.currency'],
  customFieldOwnership: { mode: 'ids', ids: ['color', 'unit'], definitionSetId: 'catalog.product.details@v1' },
  mutationSurfaces: [submitted],
  providedDataContractIds: ['catalog.details@v1', 'catalog.price@v1'],
  allowNoopSubmit: false,
  requiredLeaves: [],
  extensionSinkSupport: 'none',
}

const contribution: CrudFormSectionContributionFact = {
  id: 'shared.product.commercial',
  address: { hostId: 'catalog.product', formVariant: 'default', formOperation: 'update', sectionId: 'commercial' },
  operation: 'replace',
  roundTripId: 'shared.product.commercial@v1',
  requiredCapabilities: [{
    capabilityId,
    protocol: 'crud-form-sections/v1',
    modes: ['domain-adapter', 'read-enrichment'],
    payloadPaths: ['pricing.currency', 'pricing.cost'],
    customFieldOwnership: { mode: 'ids', ids: ['unit', 'color'], definitionSetId: 'catalog.product.details@v1' },
    mutationSurfaceIds: [submitted.id],
  }],
  requiredSectionIds: ['details'],
  requiredDataContractIds: ['catalog.details@v1'],
}

const activePolicy: CrudFormSectionCapabilityContext = {
  activeSectionIds: new Set(['details', 'commercial']),
  activeDataContractIds: new Set(['catalog.details@v1']),
  mutationSurfaces: new Map([[submitted.id, submitted]]),
  resourceBindingIds: new Set(['catalog.product.binding/v1']),
  providedDataContractIdsByCapability: new Map([[capabilityId, ['catalog.price@v1', 'catalog.details@v1']]]),
  hasActiveWritableLeaves: true,
  hasActiveIndependentActions: false,
}

function interceptor(fact = provider): ApiInterceptor {
  return {
    id: 'catalog.policy',
    targetRoute: '/api/catalog/products/*',
    methods: ['PATCH'],
    features: ['catalog.products.manage'],
    crudFormSectionCapabilities: [fact],
    before: async () => ({ ok: true }),
  }
}

function registryFor(fact: CrudFormSectionCapabilityProviderFact) {
  registerApiInterceptors([{ moduleId: 'catalog', interceptors: [interceptor(fact)] }])
  return collectCrudFormSectionCapabilities()
}

afterEach(() => {
  resetModuleContractOverridesForTests()
  registerResponseEnrichers([])
  registerApiInterceptors([])
  registerCommandInterceptors([])
  registerMutationGuards([])
})

describe('CrudForm server capability collection', () => {
  it('uses the final module and programmatic overrides, retaining registry provenance', () => {
    applyModuleOverridesFromEnabledModules([{ id: 'catalog', overrides: { interceptors: { 'catalog.policy': null } } }])
    expect(registryFor(provider).capabilities.size).toBe(0)

    const replacement = { ...provider, roundTripId: 'shared.product.commercial@v2' }
    applyApiInterceptorOverrides({ 'catalog.policy': interceptor(replacement) })
    const registry = registryFor(provider)
    expect(registry.capabilities.get(capabilityId)).toMatchObject({
      source: { kind: 'api-interceptor', moduleId: 'catalog', id: 'catalog.policy', features: ['catalog.products.manage'] },
      fact: { roundTripId: replacement.roundTripId },
    })
    expect(matchCrudFormSectionCapabilities(registry, contribution, activePolicy)).toEqual({
      ok: false, reason: 'capability-mismatch', capabilityId,
    })
  })

  it('invalidates declarations from an overridden interceptor whose executable hook was removed', () => {
    const { before, ...inactive } = interceptor()
    applyApiInterceptorOverrides({ 'catalog.policy': inactive })
    const registry = registryFor(provider)
    expect(before).toBeDefined()
    expect(matchCrudFormSectionCapabilities(registry, contribution, activePolicy)).toEqual({
      ok: false, reason: 'invalid-capability', capabilityId,
    })
  })

  it('collects optional declarations from each registry and leaves legacy hooks untouched', () => {
    const enrichOne = async (record: Record<string, unknown>) => record
    const legacy = { id: 'catalog.legacy', targetEntity: 'catalog.product', enrichOne }
    const declared = {
      ...legacy, id: 'catalog.read-policy',
      crudFormSectionCapabilities: [{ ...provider, capabilityId: 'catalog.read' }],
    }
    registerResponseEnrichers([{ moduleId: 'catalog', enrichers: [legacy, declared] }])
    registerCommandInterceptors([{ moduleId: 'catalog', interceptors: [{
      id: 'catalog.commands-policy', targetCommand: 'catalog.products.update',
      beforeExecute: async () => undefined,
      crudFormSectionCapabilities: [{ ...provider, capabilityId: 'catalog.command' }],
    }] }])
    registerMutationGuards([{ moduleId: 'catalog', guards: [{
      id: 'catalog.guarded-policy', targetEntity: 'catalog.product', operations: ['update'],
      validate: async () => ({ ok: true }),
      crudFormSectionCapabilities: [{ ...provider, capabilityId: 'catalog.guard' }],
    }] }])
    const registry = registryFor(provider)
    expect(legacy).toEqual({ id: 'catalog.legacy', targetEntity: 'catalog.product', enrichOne })
    expect([...registry.capabilities.values()].map(({ source }) => source.kind)).toEqual([
      'response-enricher', 'api-interceptor', 'command-interceptor', 'mutation-guard',
    ])
  })

  it.each([
    { modes: undefined },
    { payloadPaths: undefined },
    { customFieldOwnership: null },
    { customFieldOwnership: { mode: 'ids' } },
    { mutationSurfaces: undefined },
    { mutationSurfaces: [null] },
    { providedDataContractIds: undefined },
    { requiredLeaves: [null] },
  ])('quarantines malformed JavaScript declarations (%j)', (malformed) => {
    const invalid = { ...provider, ...malformed } as CrudFormSectionCapabilityProviderFact
    registerApiInterceptors([{ moduleId: 'catalog', interceptors: [
      interceptor(invalid),
      { ...interceptor({ ...provider, capabilityId: 'catalog.healthy' }), id: 'catalog.healthy-policy' },
    ] }])
    const registry = collectCrudFormSectionCapabilities()
    expect([...registry.capabilities.keys()]).toEqual(['catalog.healthy'])
    expect(matchCrudFormSectionCapabilities(registry, contribution, activePolicy)).toEqual({
      ok: false, reason: 'invalid-capability', capabilityId,
    })
  })

  it('fails closed on duplicate declarations across runtime sources', () => {
    registerCommandInterceptors([{ moduleId: 'catalog', interceptors: [{
      id: 'catalog.commands-policy', targetCommand: 'catalog.products.update',
      beforeExecute: async () => undefined,
      crudFormSectionCapabilities: [provider, { ...provider, capabilityId: 'catalog.healthy' }],
    }] }])
    const registry = registryFor(provider)
    expect([...registry.capabilities.keys()]).toEqual(['catalog.healthy'])
    expect(matchCrudFormSectionCapabilities(registry, contribution, activePolicy)).toEqual({
      ok: false, reason: 'duplicate-capability', capabilityId,
    })
  })
})

describe('CrudForm semantic capability matching', () => {
  it('accepts matches independently of ordinal differences for set-valued facts', () => {
    expect(matchCrudFormSectionCapabilities(registryFor(provider), contribution, activePolicy)).toMatchObject({
      ok: true,
      capabilities: [{
        fact: { modes: ['domain-adapter', 'read-enrichment'], providedDataContractIds: ['catalog.details@v1', 'catalog.price@v1'] },
      }],
    })
    expect(provider.modes).toEqual(['read-enrichment', 'domain-adapter'])
  })

  it.each<Partial<CrudFormSectionCapabilityProviderFact>>([
    { hostId: 'catalog.variant' },
    { formVariant: 'alternate' },
    { formOperation: 'create' },
    { modes: ['domain-adapter'] },
    { payloadPaths: ['pricing.cost'] },
    { customFieldOwnership: { mode: 'all', definitionSetId: 'catalog.product.details@v1' } },
    { customFieldOwnership: { mode: 'ids', ids: ['color', 'unit'], definitionSetId: 'catalog.product.details@v2' } },
    { providedDataContractIds: ['catalog.details@v1'] },
    { mutationSurfaces: [{ ...submitted, kind: 'section-action' }] },
    { mutationSurfaces: [{ ...submitted, guardedFacade: { ...submitted.guardedFacade, method: 'PUT' } }] },
    { mutationSurfaces: [{ ...submitted, guardedFacade: { ...submitted.guardedFacade, routePattern: '/api/catalog/variants/[id]' } }] },
    { mutationSurfaces: [{ ...submitted, delegatedTarget: { ...submitted.delegatedTarget, kind: 'service' } }] },
    { mutationSurfaces: [{ ...submitted, delegatedTarget: { ...submitted.delegatedTarget, id: 'catalog.variants.update' } }] },
    { mutationSurfaces: [{ ...submitted, requestOperation: 'delete' }] },
    { mutationSurfaces: [{ ...submitted, hostResourceKind: 'catalog.offer' }] },
    { mutationSurfaces: [{ ...submitted, mutationResourceKind: 'catalog.offer' }] },
    { mutationSurfaces: [{ ...submitted, resourceBindingIds: ['catalog.product.binding/v2'] }] },
    { mutationSurfaces: [{ ...submitted, optimisticLock: 'target-optional' }] },
  ])('rejects semantic drift with the same capability id (%j)', (drift) => {
    expect(matchCrudFormSectionCapabilities(registryFor({ ...provider, ...drift }), contribution, activePolicy)).toEqual({
      ok: false, reason: 'capability-mismatch', capabilityId,
    })
  })

  it('rejects unknown dependencies and resource bindings', () => {
    const registry = registryFor(provider)
    expect(matchCrudFormSectionCapabilities(registry, contribution, { ...activePolicy, activeSectionIds: new Set() })).toEqual({
      ok: false, reason: 'dependency-mismatch',
    })
    expect(matchCrudFormSectionCapabilities(registry, contribution, { ...activePolicy, activeDataContractIds: new Set() })).toEqual({
      ok: false, reason: 'dependency-mismatch',
    })
    expect(matchCrudFormSectionCapabilities(registry, contribution, { ...activePolicy, resourceBindingIds: new Set() })).toEqual({
      ok: false, reason: 'capability-mismatch', capabilityId,
    })
  })

  it('canonicalizes omitted surface bindings without treating malformed set values as valid', () => {
    const { resourceBindingIds, ...unboundSurface } = submitted
    const context = { ...activePolicy, mutationSurfaces: new Map([[submitted.id, { ...unboundSurface, resourceBindingIds: [] }]]) }
    expect(matchCrudFormSectionCapabilities(registryFor({ ...provider, mutationSurfaces: [unboundSurface] }), contribution, context).ok).toBe(true)
    const registry = registryFor({ ...provider, payloadPaths: ['pricing.cost', 'pricing.cost'] })
    expect(matchCrudFormSectionCapabilities(registry, contribution, context)).toEqual({
      ok: false, reason: 'invalid-capability', capabilityId,
    })
    expect(resourceBindingIds).toEqual(['catalog.product.binding/v1'])
  })

  it('requires an explicit parent submit, no writable leaves and no independent action for a no-op', () => {
    const optIn = { ...contribution, requiredCapabilities: [{
      capabilityId, protocol: provider.protocol, modes: provider.modes, mutationSurfaceIds: [submitted.id], allowNoopSubmit: true,
    }] }
    const noWriteProvider = {
      ...provider, payloadPaths: [], customFieldOwnership: { mode: 'none' } as const, allowNoopSubmit: true,
    }
    const context = { ...activePolicy, hasActiveWritableLeaves: false }
    const registry = registryFor(noWriteProvider)
    expect(matchCrudFormSectionCapabilities(registry, optIn, context).ok).toBe(true)
    expect(matchCrudFormSectionCapabilities(registry, optIn, { ...context, hasActiveWritableLeaves: true }).ok).toBe(false)
    expect(matchCrudFormSectionCapabilities(registry, optIn, { ...context, hasActiveIndependentActions: true }).ok).toBe(false)
    expect(registryFor({ ...noWriteProvider, mutationSurfaces: [] }).rejected.get(capabilityId)).toBe('invalid-provider')
  })

  it('requires an actual compatible sink and separate opt-in for after-commit writes', () => {
    const fact: CrudFormSectionCapabilityProviderFact = {
      ...provider, modes: ['extension-sink'], extensionSinkSupport: 'after-commit',
    }
    const requirement = { ...contribution.requiredCapabilities[0], modes: fact.modes }
    const request = { ...contribution, requiredCapabilities: [requirement] }
    const registry = registryFor(fact)
    const afterCommitContext = { ...activePolicy, sinkAtomicityByCapability: new Map([[capabilityId, ['after-commit'] as const]]) }
    const transactionalContext = {
      ...activePolicy, sinkAtomicityByCapability: new Map([[capabilityId, ['host-transaction'] as const]]),
    }
    const permitted = { ...request, requiredCapabilities: [{ ...requirement, allowAfterCommitSink: true }] }
    expect(matchCrudFormSectionCapabilities(registry, permitted, activePolicy).ok).toBe(false)
    expect(matchCrudFormSectionCapabilities(registry, request, afterCommitContext).ok).toBe(false)
    expect(matchCrudFormSectionCapabilities(registry, permitted, afterCommitContext).ok).toBe(true)
    expect(matchCrudFormSectionCapabilities(registry, permitted, transactionalContext).ok).toBe(false)
  })

  it('limits declarative providers to genuinely display-only additions', () => {
    const displayFact: CrudFormSectionCapabilityProviderFact = {
      ...provider, modes: ['display-only'], payloadPaths: [], customFieldOwnership: { mode: 'none' },
      mutationSurfaces: [], providedDataContractIds: [],
    }
    const registry = collectCrudFormSectionCapabilities([{ moduleId: 'example', fact: displayFact }])
    const displayContribution: CrudFormSectionContributionFact = {
      ...contribution, operation: 'add',
      requiredCapabilities: [{ capabilityId, protocol: provider.protocol, modes: ['display-only'] }],
    }
    const context = { ...activePolicy, providedDataContractIdsByCapability: new Map() }
    expect(matchCrudFormSectionCapabilities(registry, displayContribution, context).ok).toBe(true)
    expect(matchCrudFormSectionCapabilities(registry, { ...displayContribution, operation: 'hide' }, context).ok).toBe(false)
    expect(matchCrudFormSectionCapabilities(registry, contribution, context).ok).toBe(false)
    expect(collectCrudFormSectionCapabilities([{ moduleId: 'example', fact: provider }]).rejected.get(capabilityId)).toBe('invalid-provider')
  })
})
