import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import type { CrudFormRequiredLeafFact, CrudFormSectionMutationSurfaceFact } from '../../../../modules/form-section-facts'
import type { CrudFormLeafDefaultProvider, CrudFormSectionHostAlternative } from '../../../../modules/form-sections'
import type { CrudFormSectionCapabilityEntry } from '../../form-section-capabilities'
import { findCrudFormRequiredLeafDrift } from '../required-leaf-drift'
import { prepareCrudFormRequiredLeaves, selectCrudFormRequiredLeaves } from '../required-leaves'

const scope = { tenantId: 'tenant', organizationId: 'organization', allowedOrganizationIds: ['organization'] }
const fieldLabelKey = 'example.products.fields.code'
const capabilityId = 'example.product-save'
const providerId = 'example.default-code'

function fixture(formOperation: 'create' | 'update', leaf?: Partial<CrudFormRequiredLeafFact>) {
  const address = { hostId: 'example.product', formVariant: 'edit', formOperation }
  const submit: CrudFormSectionMutationSurfaceFact = {
    id: 'example.product-save',
    kind: 'parent-submit',
    guardedFacade: { method: 'POST', routePattern: '/example/products' },
    delegatedTarget: { kind: 'command', id: 'example.products.save' },
    requestOperation: formOperation,
    hostResourceKind: 'example.product',
    mutationResourceKind: 'example.product',
    resourceBindingIds: [],
    optimisticLock: 'none',
  }
  const alternative: CrudFormSectionHostAlternative = {
    surface: {
      ...address, id: 'product.edit', orderedSectionIds: ['identity'], callerIds: [], contributionIds: [],
      ownershipFacts: [{ sectionId: 'identity', payloadPaths: ['name', 'internalRemark'], customFieldOwnership: { mode: 'none' } }],
      mutationSurfaceIds: [submit.id], dependencies: [],
    },
    requiredLeafLabelKeys: { code: fieldLabelKey },
  }
  const capability: CrudFormSectionCapabilityEntry = {
    source: { moduleId: 'example', id: 'example.product-check', kind: 'mutation-guard', features: [] },
    fact: {
      ...address, capabilityId, protocol: 'crud-form-sections/v1', roundTripId: 'example.product-save@v1',
      modes: ['domain-adapter'], payloadPaths: ['name', 'internalRemark'], customFieldOwnership: { mode: 'none' },
      mutationSurfaces: [submit], providedDataContractIds: [], allowNoopSubmit: false,
      requiredLeaves: [{
        ...address, schemaId: 'exampleProductSchema', payloadPath: 'code',
        coverage: ['section', 'preserve-from-record', 'server-default'], ...leaf,
      }],
      extensionSinkSupport: 'none',
    },
  }
  const provider: CrudFormLeafDefaultProvider = {
    fact: { ...address, id: providerId, roundTripId: `${providerId}@v1`, payloadPath: 'code', readsPayloadPaths: ['name'] },
    resolve: ({ payload }) => `slug-${String(payload.name)}`,
  }
  return {
    submit, alternative, provider, capability,
    selection: {
      surfaces: [submit], alternative, capabilities: [capability], defaultProviders: [], canReadLockedRecord: formOperation === 'update',
    },
  }
}

describe('required leaf coverage', () => {
  it('blocks a create policy whose only declaration would use an update record', () => {
    const { selection, alternative } = fixture('create')
    expect(selectCrudFormRequiredLeaves({
      ...selection, canReadLockedRecord: true, alternative: { ...alternative, preservedLeafPaths: ['code'] },
    })).toEqual({ ok: false, reason: 'required_leaf_uncovered' })
  })

  it('accepts the required leaf emitted by its replacement descriptor', () => {
    const { selection, alternative } = fixture('create')
    expect(selectCrudFormRequiredLeaves({
      ...selection,
      alternative: {
        ...alternative,
        surface: {
          ...alternative.surface,
          ownershipFacts: [{ sectionId: 'identity', payloadPaths: ['code'], customFieldOwnership: { mode: 'none' } }],
        },
        requiredSectionLeaves: [{ sectionId: 'identity', payloadPath: 'code' }],
      },
    })).toMatchObject({ ok: true, leaves: [{ mode: 'section', sectionId: 'identity', payloadPath: 'code' }] })
  })

  it('rejects duplicate defaults and a default that competes with a preserve declaration', () => {
    const { selection, alternative, provider } = fixture('update')
    const other = { ...provider, fact: { ...provider.fact, id: 'example.other-default', roundTripId: 'example.other-default@v1' } }
    expect(selectCrudFormRequiredLeaves({
      ...selection, defaultProviders: [provider, other],
    })).toEqual({ ok: false, reason: 'required_leaf_ambiguous' })
    expect(selectCrudFormRequiredLeaves({
      ...selection, defaultProviders: [provider], alternative: { ...alternative, preservedLeafPaths: ['code'] },
    })).toEqual({ ok: false, reason: 'required_leaf_ambiguous' })
  })

  it('prepares a default with only the declared projected payload and a read-only transaction fork', async () => {
    const { selection, provider } = fixture('create')
    const selected = selectCrudFormRequiredLeaves({ ...selection, defaultProviders: [provider] })
    if (!selected.ok) throw new Error('[internal] Expected one selected default')
    const resolve = jest.fn(provider.resolve)
    const readFork = { find: jest.fn(), findOne: jest.fn(), count: jest.fn(), flush: jest.fn() }
    const em = { fork: jest.fn(() => readFork) }
    const input = { name: 'retail', internalRemark: 'not a declared input' }
    const result = await prepareCrudFormRequiredLeaves({
      payload: input, leaves: selected.leaves, lockedRecord: null, scope,
      transactionalEm: em as unknown as EntityManager,
      providers: new Map([[providerId, { ...provider, resolve }]]),
    })
    expect(result).toEqual({
      ok: true, payload: { ...input, code: 'slug-retail' }, serverValues: new Map([['code', 'slug-retail']]),
    })
    expect(resolve).toHaveBeenCalledTimes(1)
    const [invocation] = resolve.mock.calls[0]
    expect(invocation.payload).toEqual({ name: 'retail' })
    expect(Object.keys(invocation.readEm).sort()).toEqual(['count', 'find', 'findOne'])
    expect(em.fork).toHaveBeenCalledWith(expect.objectContaining({ keepTransactionContext: true }))
    expect(readFork.flush).not.toHaveBeenCalled()
  })

  it('derives an omitted update leaf only from the scoped locked-read proof or exact active default', async () => {
    const { selection, alternative, provider } = fixture('update')
    const compiled = { ...alternative, compiledDefaultProviderIds: [] }
    expect(selectCrudFormRequiredLeaves({ ...selection, alternative: compiled }))
      .toMatchObject({ ok: true, leaves: [{ mode: 'preserve-from-record', payloadPath: 'code' }] })
    expect(selectCrudFormRequiredLeaves({ ...selection, alternative: compiled, canReadLockedRecord: false }))
      .toEqual({ ok: false, reason: 'required_leaf_uncovered' })

    const selected = selectCrudFormRequiredLeaves({
      ...selection, alternative: { ...compiled, compiledDefaultProviderIds: [provider.fact.id] },
      defaultProviders: [provider],
    })
    if (!selected.ok) throw new Error('[internal] Expected exactly one compiled default')
    expect(selected.leaves).toMatchObject([{ mode: 'server-default', payloadPath: 'code' }])
    const readFork = { find: jest.fn(), findOne: jest.fn(), count: jest.fn() }
    await expect(prepareCrudFormRequiredLeaves({
      payload: { name: 'visible-title' }, leaves: selected.leaves, lockedRecord: { name: 'hidden-name' },
      scope, transactionalEm: { fork: () => readFork } as unknown as EntityManager,
      providers: new Map([[provider.fact.id, provider]]),
    })).resolves.toMatchObject({ ok: true, payload: { name: 'visible-title', code: 'slug-visible-title' } })
  })

  it('prepares an update-required value from the locked scoped projection', async () => {
    const { selection, alternative } = fixture('update')
    const selected = selectCrudFormRequiredLeaves({
      ...selection, alternative: { ...alternative, preservedLeafPaths: ['code'] },
    })
    if (!selected.ok) throw new Error('[internal] Expected one selected preserve path')
    await expect(prepareCrudFormRequiredLeaves({
      payload: { name: 'retail' }, leaves: selected.leaves, lockedRecord: { code: 'locked-value' }, scope,
      transactionalEm: {} as EntityManager, providers: new Map(),
    })).resolves.toEqual({
      ok: true, payload: { name: 'retail', code: 'locked-value' }, serverValues: new Map([['code', 'locked-value']]),
    })
  })
})

describe('authoritative required schema drift', () => {
  it('identifies newly required and no-longer-required paths on the named schema', async () => {
    const schema = z.object({ name: z.string().min(1), pricing: z.object({ currency: z.string(), oldCode: z.string().optional() }) })
    await expect(findCrudFormRequiredLeafDrift(
      schema, 'exampleProductSchema', [{ name: 'Example', pricing: { currency: 'EUR', oldCode: 'OLD' } }],
      [{ schemaId: 'exampleProductSchema', payloadPath: 'name' }, { schemaId: 'exampleProductSchema', payloadPath: 'pricing.oldCode' }],
    )).resolves.toEqual({ missingDeclarations: ['pricing.currency'], noLongerRequired: ['pricing.oldCode'] })
  })
})
