import { asValue, createContainer } from 'awilix'
import { z } from 'zod'
import { CommandBus, registerCommand, unregisterCommand } from '../../../commands'
import { registerCommandInterceptors } from '../../../commands/command-interceptor-store'
import { registerTelemetryErrorReporter } from '../../../telemetry/runtime'
import type { CrudFormSectionMutationSurfaceFact } from '../../../../modules/form-section-facts'
import type { CrudFormSectionHostProvider, CrudFormSectionServerModule } from '../../../../modules/form-sections'
import { isUniqueViolation } from '../../errors'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '../../optimistic-lock-headers'
import { registerMutationGuards } from '../../mutation-guard-store'
import { crudFormSectionHostKey } from '../composition'
import { getCrudFormSectionManifest, registerCrudFormSectionManifest } from '../manifest'
import { runCrudFormSectionMutation, type CrudFormSectionMutationFacadeOptions, type CrudFormSectionMutationIdentity } from '../mutation-facade'
import { buildCrudFormSectionPolicyHeaders, crudFormSectionPolicyHeaderNames, parseCrudFormSectionPolicyHeaders } from '../policy-headers'
import { encodeCurrentCrudFormSectionPolicyToken } from '../policy-token'

const dataSchema = z.object({ sku: z.string(), cost: z.number().optional() }).strict()
type Payload = z.infer<typeof dataSchema>
type Result = { id: string }
type FacadeOptions = CrudFormSectionMutationFacadeOptions<Payload, Result>

const scope = { tenantId: 'tenant', organizationId: 'org', allowedOrganizationIds: ['org'] }
const auth = { sub: 'actor', tenantId: 'tenant', orgId: 'org' }
const expectedDate = '2026-11-20T00:00:00.000Z'
const address = { hostId: 'example.product', formVariant: 'showcase', formOperation: 'update' } as const
const host = { hostResourceKind: 'example.product', hostResourceId: 'product-1' }
const expectedMismatch = {
  status: 409,
  body: { error: 'extension_policy_mismatch', code: 'extension_policy_mismatch' },
}
const requiredFeature = 'example.manage'
const delegatedTarget = { kind: 'command', id: 'example.offers.update' } as const
const contributionId = 'example.display'
const authority = jest.fn(async () => host)
const surface: CrudFormSectionMutationSurfaceFact = {
  id: 'example.offer-update',
  kind: 'section-action',
  guardedFacade: { method: 'PATCH', routePattern: '/example/products/[productId]/offers/[offerId]' },
  delegatedTarget,
  requestOperation: 'update',
  hostResourceKind: host.hostResourceKind,
  mutationResourceKind: 'example.offer',
  resourceBindingIds: ['example.offer-product.v1'],
  optimisticLock: 'target-required',
}

function addManifest(
  proof = true,
  selected = surface,
  readLockedRecord?: CrudFormSectionHostProvider['readLockedRecord'],
): void {
  if (readLockedRecord) registerMutationGuards([{ moduleId: 'example', guards: [{
    id: 'example.parent-domain', targetEntity: 'example.product', operations: ['update'],
    validate: async () => ({ ok: true }),
    crudFormSectionCapabilities: [{
      ...address, capabilityId: 'example.parent-domain', protocol: 'crud-form-sections/v1',
      roundTripId: 'example.parent-domain@v1', modes: ['merge-server-leaves'],
      payloadPaths: ['sku'], customFieldOwnership: { mode: 'none' },
      mutationSurfaces: [selected], providedDataContractIds: [], allowNoopSubmit: false,
      requiredLeaves: [{
        ...address, schemaId: 'exampleProductUpdate', payloadPath: 'code', coverage: ['preserve-from-record'],
      }],
      extensionSinkSupport: 'none',
    }],
  }] }])
  const section = { ...address, sectionId: 'notes' }
  const base = {
    ...address,
    id: 'example.baseline',
    orderedSectionIds: ['details'],
    callerIds: ['example.editor'],
    contributionIds: [],
    ownershipFacts: [{ sectionId: 'details', payloadPaths: ['sku'], customFieldOwnership: { mode: 'none' as const } }],
    mutationSurfaceIds: [],
    dependencies: [],
  }
  const modules: CrudFormSectionServerModule[] = [{
    moduleId: 'example',
    sections: {
      hostFacts: [{
        id: 'example.host',
        roundTripId: 'example.host@v1',
        hostResourceKind: host.hostResourceKind,
        alternatives: [{ surface: base }, {
          surface: {
            ...base,
            id: 'example.with-notes',
            orderedSectionIds: ['details', 'notes'],
            contributionIds: [contributionId],
            mutationSurfaceIds: [selected.id],
          },
          mutationSurfaces: [selected],
          ...(readLockedRecord && {
            preservedLeafPaths: ['code'],
            requiredLeafLabelKeys: { code: 'example.products.fields.code' },
          }),
          resourceBindings: [{ id: 'example.offer-product.v1', definition: 'offer belongs to selected product' }],
        }],
      }],
      hostProviders: [{
        hostDescriptorId: 'example.host',
        requireFeatures: [requiredFeature],
        authorizeHost: authority,
        readLockedRecord,
        mutationProviders: proof ? [{
          mutationSurfaceId: selected.id,
          delegatedTarget: selected.delegatedTarget,
          finalInput: 'transactional-final-input/v1',
          ...(selected.optimisticLock === 'none' ? {} : {
            atomicity: 'compare-and-swap' as const,
            contenderCoverage: ['update/update', 'update/delete'] as const,
          }),
        }] : [],
      }],
      contributedOverrides: { 'example.product/showcase/update/notes': { operation: 'add', contributionId } },
      contributionFacts: [{
        id: contributionId,
        roundTripId: 'example.display@v1',
        address: section,
        operation: 'add',
        requiredCapabilities: [{ capabilityId: 'example.display-policy', protocol: 'crud-form-sections/v1', modes: ['display-only'] }],
      }],
      displayPolicies: [{
        ...address,
        capabilityId: 'example.display-policy',
        roundTripId: 'example.display@v1',
        protocol: 'crud-form-sections/v1',
        modes: ['display-only'],
        payloadPaths: [],
        customFieldOwnership: { mode: 'none' },
        mutationSurfaces: [],
        providedDataContractIds: [],
        allowNoopSubmit: false,
        requiredLeaves: [],
        extensionSinkSupport: 'none',
      }],
    },
  }]
  registerCrudFormSectionManifest(modules)
}

function identity(targetId?: string, selected = surface): CrudFormSectionMutationIdentity {
  return {
    address,
    host,
    target: { resourceKind: selected.mutationResourceKind, resourceId: targetId },
    resourceBindingIds: selected.resourceBindingIds ?? [],
  }
}

function finalProjection(targetId: string | undefined, payload: Payload, selected = surface) {
  return {
    ...identity(targetId, selected),
    targetOrganizationId: 'org',
    expectedUpdatedAt: targetId ? expectedDate : null,
    payload,
  }
}

function policyHeaders(targetId?: string, selected = surface): Headers {
  const manifest = getCrudFormSectionManifest()
  const policy = manifest.policies.get(crudFormSectionHostKey(address))
  if (!policy) throw new Error('[internal] Fixture must have an accepted policy')
  const fingerprint = manifest.ledger.fingerprint
  const policyToken = encodeCurrentCrudFormSectionPolicyToken({ address, host, policy, fingerprint })
  if (!policyToken) throw new Error('[internal] Fixture assertion must encode')
  return buildCrudFormSectionPolicyHeaders({
    policyToken,
    fingerprint,
    ...host,
    mutationResourceKind: selected.mutationResourceKind,
    mutationResourceId: targetId,
    requestOperation: selected.requestOperation,
    mutationSurfaceId: selected.id,
  }, targetId ? { 'content-type': 'application/json', [OPTIMISTIC_LOCK_HEADER_NAME]: expectedDate }
    : { 'content-type': 'application/json' })
}

function fixture(
  selected = surface,
  targetResourceId: string | null = 'offer-1',
  headers = policyHeaders(targetResourceId ?? undefined, selected),
  body: unknown = { sku: 'VALID' },
) {
  const targetId = targetResourceId ?? undefined
  const events: string[] = []
  let active = false
  const em = {
    isInTransaction: () => active,
    async begin() { active = true; events.push('begin') },
    async commit() { active = false; events.push('commit') },
    async rollback() { active = false; events.push('rollback') },
    async flush() { events.push('flush') },
  }
  const container = createContainer()
  const rbac = {
    userHasAllFeatures: jest.fn(async () => true),
    getGrantedFeatures: jest.fn(async () => ['example.*']),
  }
  container.register({ em: asValue({ fork: () => em }), rbacService: asValue(rbac) })
  const path = selected.kind === 'parent-submit' ? '/api/example/products/product-1'
    : targetId ? `/api/example/products/product-1/offers/${targetId}` : '/api/example/products/product-1/offers'
  const request = new Request('https://example.invalid' + path, {
    method: selected.guardedFacade.method,
    headers,
    body: JSON.stringify(body),
  })
  const route = jest.fn(async () => ({ ...identity(targetId, selected), targetOrganizationId: 'org' }))
  const existingHook = jest.fn(async () => { events.push('existing-hook') })
  const execute: FacadeOptions['execute'] = jest.fn(async ({ commandContext, payload, expectedUpdatedAt }) => {
    expect(expectedUpdatedAt).toBe(targetId ? expectedDate : null)
    await commandContext.beforeTransactionalWrite(commandContext.transactionalEm, payload)
    events.push('write')
    return { id: targetId ?? 'created-offer' }
  })
  const common = {
    request, auth, scope, container,
    routePattern: selected.guardedFacade.routePattern,
    method: selected.guardedFacade.method,
    requiredFeatures: [requiredFeature],
    mutationSurfaceId: selected.id,
    requestOperation: selected.requestOperation,
    delegatedTarget: selected.delegatedTarget,
    bodySchema: dataSchema,
    maxBodyBytes: 4096,
    authorizeRoute: route,
    validateDomain: jest.fn(),
    projectFinalInput: (payload: unknown) => finalProjection(targetId, payload as Payload, selected),
    beforeTransactionalWrite: existingHook,
    execute,
  }
  const options: FacadeOptions = selected.requestOperation === 'create'
    ? { ...common, operation: 'create', resolveCommittedResourceId: ({ id }) => id }
    : { ...common, operation: 'update' }
  return { options, request, container, route, events, rbac, execute }
}

beforeEach(() => {
  authority.mockReset().mockResolvedValue(host)
  registerMutationGuards([])
  addManifest()
})

afterEach(() => {
  unregisterCommand(delegatedTarget.id)
  unregisterCommand('example.offers.create')
  registerCommandInterceptors([])
  registerMutationGuards([])
  registerCrudFormSectionManifest([])
})

describe('CrudForm section policy headers', () => {
  it('keeps ordinary headers and rejects custom-header collisions and duplicate wire values', () => {
    const headers = policyHeaders('offer-1')
    const parsed = parseCrudFormSectionPolicyHeaders(headers)
    expect(parsed).toMatchObject({ hostResourceId: 'product-1', mutationResourceId: 'offer-1' })
    if (!parsed) throw new Error('[internal] Expected fixture headers')
    expect(buildCrudFormSectionPolicyHeaders(parsed, { 'x-sudo-token': 'test' }).get('x-sudo-token')).toBe('test')
    expect(() => buildCrudFormSectionPolicyHeaders(parsed, { [crudFormSectionPolicyHeaderNames.policyToken.toUpperCase()]: 'test' }))
      .toThrow('collides')
    headers.append(crudFormSectionPolicyHeaderNames.mutationResourceId, 'offer-1')
    expect(parseCrudFormSectionPolicyHeaders(headers)).toBeNull()
    expect(() => buildCrudFormSectionPolicyHeaders({ ...parsed, mutationResourceId: 'offer,1' })).toThrow()
  })
})

describe('CrudForm section guarded mutation', () => {
  it('checks authentication, features and scoped targets before examining policy facts', async () => {
    const setup = fixture(surface, 'offer-1', new Headers())
    await expect(runCrudFormSectionMutation({ ...setup.options, auth: null })).rejects.toMatchObject({ status: 401 })
    setup.rbac.userHasAllFeatures.mockResolvedValueOnce(false)
    await expect(runCrudFormSectionMutation(setup.options)).rejects.toMatchObject({ status: 403 })
    expect(setup.route).not.toHaveBeenCalled()
    await expect(runCrudFormSectionMutation({ ...setup.options, authorizeRoute: async () => null }))
      .rejects.toMatchObject({ status: 404 })
    expect(authority).not.toHaveBeenCalled()
    await expect(runCrudFormSectionMutation(setup.options)).rejects.toMatchObject(expectedMismatch)
    expect(authority).toHaveBeenCalledTimes(1)
    expect(setup.execute).not.toHaveBeenCalled()
  })

  it('binds feature checks and guard callbacks to the resolved target organization', async () => {
    const setup = fixture()
    const guard = jest.fn(async () => ({ ok: true, shouldRunAfterSuccess: true }))
    const afterSuccess = jest.fn(async () => {})
    registerMutationGuards([{ moduleId: 'example', guards: [{
      id: 'example.scope-guard', targetEntity: 'example.offer', operations: ['update'], validate: guard, afterSuccess,
    }] }])
    await expect(runCrudFormSectionMutation({
      ...setup.options,
      scope: { ...scope, organizationId: 'selected', allowedOrganizationIds: ['selected', 'org'] },
    })).resolves.toEqual({ id: 'offer-1' })
    expect(setup.rbac.userHasAllFeatures).toHaveBeenLastCalledWith('actor', [requiredFeature],
      expect.objectContaining({ organizationId: 'org' }))
    expect(guard).toHaveBeenCalledWith(expect.objectContaining({ organizationId: 'org' }))
    expect(afterSuccess).toHaveBeenCalledWith(expect.objectContaining({ organizationId: 'org' }))
  })

  it('rejects a target organization outside the authorized set before checking headers', async () => {
    const setup = fixture(surface, 'offer-1', new Headers())
    await expect(runCrudFormSectionMutation({
      ...setup.options,
      authorizeRoute: async () => ({ ...identity('offer-1'), targetOrganizationId: 'outside' }),
    })).rejects.toMatchObject({ status: 404 })
    expect(authority).not.toHaveBeenCalled()
  })

  it('requires an atomic provider proof for a versioned mutation during manifest publication', async () => {
    addManifest(false)
    const manifest = getCrudFormSectionManifest()
    expect(manifest.ledger.hosts).toEqual([address])
    expect(manifest.policies.size).toBe(0)
    expect(manifest.providers.has(crudFormSectionHostKey(address))).toBe(true)
  })

  it('accepts a currently valid reconstructed token and completes callbacks after commit', async () => {
    const setup = fixture()
    const afterSuccess = jest.fn(async () => { setup.events.push('after-success') })
    registerMutationGuards([{ moduleId: 'example', guards: [{
      id: 'example.offer-guard', targetEntity: 'example.offer', operations: ['update'], features: [requiredFeature],
      validate: async ({ requestHeaders }) => {
        requestHeaders.set(OPTIMISTIC_LOCK_HEADER_NAME, '2020-01-01T00:00:00.000Z')
        return { ok: true, modifiedPayload: { sku: 'CHANGED' }, shouldRunAfterSuccess: true }
      },
      afterSuccess,
    }] }])
    const legacyValidate = jest.fn(async () => ({ ok: true }))
    setup.container.register('crudMutationGuardService', asValue({
      validateMutation: legacyValidate, afterMutationSuccess: jest.fn(),
    }))
    await expect(runCrudFormSectionMutation(setup.options)).resolves.toEqual({ id: 'offer-1' })
    expect(legacyValidate).toHaveBeenCalledTimes(1)
    expect(setup.execute).toHaveBeenCalledWith(expect.objectContaining({ payload: { sku: 'CHANGED' } }))
    expect(setup.events).toEqual(['begin', 'existing-hook', 'write', 'flush', 'commit', 'after-success'])
    expect(afterSuccess).toHaveBeenCalledWith(expect.objectContaining({ resourceId: 'offer-1' }))
    expect(afterSuccess.mock.calls[0]).toEqual([expect.objectContaining({
      requestHeaders: expect.any(Headers),
    })])
    expect(setup.request.headers.get(OPTIMISTIC_LOCK_HEADER_NAME)).toBe(expectedDate)
  })

  it.each([
    ['fingerprint', 'c'.repeat(64)],
    ['requestOperation', 'delete'],
    ['hostResourceId', 'other-product'],
    ['mutationResourceId', 'other-offer'],
    ['mutationSurfaceId', 'different-surface'],
  ] as const)('rejects the wrong %s without domain mutation', async (name, value) => {
    const headers = policyHeaders('offer-1')
    headers.set(crudFormSectionPolicyHeaderNames[name], value)
    const setup = fixture(surface, 'offer-1', headers)
    await expect(runCrudFormSectionMutation(setup.options)).rejects.toMatchObject(expectedMismatch)
    expect(setup.events).toEqual([])
    expect(setup.execute).not.toHaveBeenCalled()
  })

  it.each([
    ['route pattern', { routePattern: '/example/products/[otherId]/offers/[offerId]' }],
    ['delegated target', { delegatedTarget: { kind: 'command' as const, id: 'example.other.update' } }],
    ['binding IDs', { authorizeRoute: async () => ({ ...identity('offer-1'), resourceBindingIds: [], targetOrganizationId: 'org' }) }],
  ] as const)('rejects a mismatched %s from the route configuration', async (_name, override) => {
    const setup = fixture()
    await expect(runCrudFormSectionMutation({ ...setup.options, ...override })).rejects.toMatchObject(expectedMismatch)
    expect(setup.execute).not.toHaveBeenCalled()
  })

  it('requires the bound target version for a versioned provider', async () => {
    const headers = policyHeaders('offer-1')
    headers.delete(OPTIMISTIC_LOCK_HEADER_NAME)
    const setup = fixture(surface, 'offer-1', headers)
    await expect(runCrudFormSectionMutation(setup.options)).rejects.toMatchObject(expectedMismatch)
    expect(setup.execute).not.toHaveBeenCalled()
  })

  it('rolls back before the provider can write a different final resource', async () => {
    const setup = fixture()
    await expect(runCrudFormSectionMutation({
      ...setup.options,
      projectFinalInput: () => finalProjection('other-offer', { sku: 'VALID' }),
    })).rejects.toMatchObject(expectedMismatch)
    expect(setup.events).toEqual(['begin', 'existing-hook', 'rollback'])
  })

  it('normalizes a blocked guard to the declared 422 response', async () => {
    registerMutationGuards([{ moduleId: 'example', guards: [{
      id: 'example.rejection', targetEntity: 'example.offer', operations: ['update'],
      validate: async () => ({ ok: false, status: 412, body: { fieldErrors: { sku: 'example.errors.sku' } } }),
    }] }])
    const setup = fixture()
    await expect(runCrudFormSectionMutation(setup.options)).rejects.toMatchObject({
      status: 422,
      body: {
        error: 'mutation_guard_rejected', code: 'mutation_guard_rejected',
        details: { fieldErrors: { sku: 'example.errors.sku' } },
      },
    })
    expect(setup.execute).not.toHaveBeenCalled()
  })

  it('preserves the known legacy optimistic-lock conflict response', async () => {
    const setup = fixture()
    const lockConflict = {
      error: 'record_modified', code: 'optimistic_lock_conflict',
      currentUpdatedAt: '2026-11-21T00:00:00.000Z', expectedUpdatedAt: expectedDate,
    }
    setup.container.register('crudMutationGuardService', asValue({
      validateMutation: async () => ({ ok: false, status: 409, body: lockConflict }),
      afterMutationSuccess: jest.fn(),
    }))
    await expect(runCrudFormSectionMutation(setup.options)).rejects.toMatchObject({ status: 409, body: lockConflict })
    expect(setup.execute).not.toHaveBeenCalled()
  })

  it('rejects guard-modified inactive leaves before starting a write', async () => {
    registerMutationGuards([{ moduleId: 'example', guards: [{
      id: 'example.inactive-cost', targetEntity: 'example.offer', operations: ['update'],
      validate: async () => ({ ok: true, modifiedPayload: { cost: 120 } }),
    }] }])
    const setup = fixture()
    await expect(runCrudFormSectionMutation(setup.options)).rejects.toMatchObject(expectedMismatch)
    expect(setup.execute).not.toHaveBeenCalled()
  })

  it('rolls back when the authoritative final input fails the policy field check', async () => {
    const setup = fixture()
    await expect(runCrudFormSectionMutation({
      ...setup.options,
      validateFields: async (payload) => payload.sku === 'BAD' ? { sku: 'example.errors.sku' } : {},
      projectFinalInput: () => finalProjection('offer-1', { sku: 'BAD' }),
    })).rejects.toMatchObject({
      status: 422,
      body: { code: 'mutation_guard_rejected', details: { fieldErrors: { sku: 'example.errors.sku' } } },
    })
    expect(setup.events).toEqual(['begin', 'existing-hook', 'rollback'])
  })

  it('rolls back if the provider never supplies its final transaction-bound input', async () => {
    const setup = fixture()
    await expect(runCrudFormSectionMutation({
      ...setup.options,
      execute: async () => ({ id: 'offer-1' }),
    })).rejects.toMatchObject(expectedMismatch)
    expect(setup.events).toEqual(['begin', 'rollback'])
  })

  it('supplies the persisted create target to guard callbacks and keeps committed success after callback failure', async () => {
    const create: CrudFormSectionMutationSurfaceFact = {
      ...surface,
      id: 'example.offer-create',
      guardedFacade: { method: 'POST', routePattern: '/example/products/[productId]/offers' },
      delegatedTarget: { kind: 'command', id: 'example.offers.create' },
      requestOperation: 'create',
      optimisticLock: 'none',
    }
    addManifest(true, create)
    const setup = fixture(create, null, policyHeaders(undefined, create))
    const failedAfterSuccess = jest.fn(async () => { throw new Error('[internal] test error') })
    const afterSuccess = jest.fn(async () => { setup.events.push('after-success') })
    registerMutationGuards([{ moduleId: 'example', guards: [failedAfterSuccess, afterSuccess].map((callback, index) => ({
      id: `example.create-${index}`, targetEntity: 'example.offer', operations: ['create'],
      validate: async () => ({ ok: true, shouldRunAfterSuccess: true }),
      afterSuccess: callback,
    })) }])
    const unregister = registerTelemetryErrorReporter(() => { throw new Error('[internal] Test reporter failed') })
    try {
      await expect(runCrudFormSectionMutation(setup.options)).resolves.toEqual({ id: 'created-offer' })
    } finally {
      unregister()
    }
    expect(setup.events).toEqual(['begin', 'existing-hook', 'write', 'flush', 'commit', 'after-success'])
    expect(afterSuccess).toHaveBeenCalledWith(expect.objectContaining({ resourceId: 'created-offer' }))
  })
})

describe('server-required hidden leaves', () => {
  const parent: CrudFormSectionMutationSurfaceFact = {
    ...surface,
    id: 'example.product-update',
    kind: 'parent-submit',
    guardedFacade: { method: 'PATCH', routePattern: '/example/products/[productId]' },
    delegatedTarget: { kind: 'command', id: 'example.products.update' },
    mutationResourceKind: 'example.product',
    resourceBindingIds: [],
  }
  const hiddenFailure = {
    status: 422,
    body: {
      error: 'crud_form_section_hidden_field_invalid',
      code: 'crud_form_section_hidden_field_invalid',
      fieldLabelKey: 'example.products.fields.code',
    },
  }

  it('validates a wire-required value from the scoped locked record before guards execute', async () => {
    const readLockedRecord = jest.fn<ReturnType<NonNullable<CrudFormSectionHostProvider['readLockedRecord']>>,
      Parameters<NonNullable<CrudFormSectionHostProvider['readLockedRecord']>>>(async ({ scope, host, transactionalEm }) => {
        expect(scope.tenantId).toBe('tenant')
        expect(host.hostResourceId).toBe('product-1')
        expect(transactionalEm.isInTransaction()).toBe(true)
        return { code: 'LOCKED' }
      })
    addManifest(true, parent, readLockedRecord)
    const setup = fixture(parent, 'product-1')
    const validateDomain = jest.fn()
    await expect(runCrudFormSectionMutation({
      ...setup.options,
      bodySchema: dataSchema.extend({ code: z.string().min(1) }),
      validateDomain,
    })).resolves.toEqual({ id: 'product-1' })
    expect(readLockedRecord).toHaveBeenCalledTimes(1)
    expect(validateDomain).toHaveBeenCalledWith({ sku: 'VALID', code: 'LOCKED' }, expect.anything())
    expect(setup.execute).toHaveBeenCalledWith(expect.objectContaining({ payload: { sku: 'VALID', code: 'LOCKED' } }))
  })

  it('returns a label-only error for an invalid hidden stored value', async () => {
    addManifest(true, parent, async () => ({ code: 'PRIVATE' }))
    const setup = fixture(parent, 'product-1')
    await expect(runCrudFormSectionMutation({
      ...setup.options,
      bodySchema: dataSchema.extend({ code: z.string().startsWith('PUBLIC-') }),
    })).rejects.toMatchObject(hiddenFailure)
    expect(setup.events).toEqual(['begin', 'rollback'])
    expect(setup.execute).not.toHaveBeenCalled()
  })

  it('returns the same label-only error for an identified uniqueness conflict', async () => {
    addManifest(true, parent, async () => ({ code: 'SECRET' }))
    const setup = fixture(parent, 'product-1')
    await expect(runCrudFormSectionMutation({
      ...setup.options,
      bodySchema: dataSchema.extend({ code: z.string().min(1) }),
      hiddenLeafErrorPath: (error) => isUniqueViolation(error, 'example_products_code_unique') ? 'code' : undefined,
      execute: async ({ commandContext, payload }) => {
        await commandContext.beforeTransactionalWrite(commandContext.transactionalEm, payload)
        throw Object.assign(new Error('[internal] Example duplicate'), { code: '23505', constraint: 'example_products_code_unique' })
      },
    })).rejects.toMatchObject(hiddenFailure)
    expect(setup.events).toEqual(['begin', 'existing-hook', 'rollback'])
  })
})

it('keeps authorized bindings and ownership immutable when a callback tries to change its context', async () => {
  const setup = fixture()
  await expect(runCrudFormSectionMutation({
    ...setup.options,
    projectFinalInput: (_value, context) => {
      expect(Reflect.set(context.route.target, 'resourceId', 'other-offer')).toBe(false)
      expect(Reflect.set(context.policy.surface.ownershipFacts[0].payloadPaths, 1, 'cost')).toBe(false)
      return finalProjection('offer-1', { sku: 'VALID', cost: 120 })
    },
  })).rejects.toMatchObject(expectedMismatch)
  expect(setup.events).toEqual(['begin', 'existing-hook', 'rollback'])
})

type OfferCommandInput = {
  payload: Payload
  targetId?: string
  targetOrganizationId: string | null
  expectedUpdatedAt: string | null
}

function runThroughCommandBus(
  setup: ReturnType<typeof fixture>,
  selected: CrudFormSectionMutationSurfaceFact,
  targetId?: string,
): Pick<FacadeOptions, 'execute' | 'projectFinalInput'> {
  return {
    projectFinalInput(value) {
      const input = value as OfferCommandInput
      return {
        ...identity(input.targetId, selected),
        payload: input.payload,
        targetOrganizationId: input.targetOrganizationId,
        expectedUpdatedAt: input.expectedUpdatedAt,
      }
    },
    async execute({ payload, context, commandContext, expectedUpdatedAt }) {
      const execution = await new CommandBus().execute<OfferCommandInput, Result>(selected.delegatedTarget.id, {
        input: {
          payload, targetId, targetOrganizationId: context.scope.organizationId, expectedUpdatedAt,
        },
        ctx: {
          ...commandContext,
          auth: context.auth,
          container: setup.container,
          selectedOrganizationId: context.scope.organizationId,
          organizationIds: [...(context.scope.allowedOrganizationIds ?? [])],
          organizationScope: null,
        },
      })
      if (!execution.ambient) throw new Error('[internal] Expected an ambient command result handle')
      return execution.ambient
    },
  }
}

describe('real command interception at the write boundary', () => {
  it.each([
    { rewrite: { payload: { sku: 'BLOCKED' } }, expected: { status: 422, body: { code: 'mutation_guard_rejected' } } },
    { rewrite: { payload: { sku: 'VALID', cost: 100 } }, expected: expectedMismatch },
    { rewrite: { targetId: 'different-offer' }, expected: expectedMismatch },
    { rewrite: { targetOrganizationId: 'different-org' }, expected: expectedMismatch },
    { rewrite: { expectedUpdatedAt: '2026-11-21T00:00:00.000Z' }, expected: expectedMismatch },
  ])('rejects a rewritten transactional input before snapshots, writes and effects (%j)', async ({ rewrite, expected }) => {
    const setup = fixture()
    const after = jest.fn()
    const audit = jest.fn()
    setup.container.register('actionLogService', asValue({ log: audit }))
    registerCommandInterceptors([{ moduleId: 'example', interceptors: [{
      id: 'example.offer-command-interceptor', targetCommand: delegatedTarget.id,
      beforeExecute: async () => ({ ok: true, modifiedInput: rewrite }),
      afterExecute: after,
    }] }])
    registerCommand<OfferCommandInput, Result>({
      id: delegatedTarget.id,
      prepare() {
        setup.events.push('snapshot')
        return { before: {} }
      },
      captureAfter() {
        setup.events.push('after-snapshot')
        return {}
      },
      buildLog: () => ({ resourceKind: 'example.offer', resourceId: 'offer-1' }),
      async execute(input, context) {
        if (!context.transactionalEm) throw new Error('[internal] Expected a transactional EntityManager')
        setup.events.push('lock')
        await context.beforeTransactionalWrite?.(context.transactionalEm, input)
        setup.events.push('write')
        return { id: input.targetId ?? 'offer-1' }
      },
    })
    await expect(runCrudFormSectionMutation({
      ...setup.options,
      ...runThroughCommandBus(setup, surface, 'offer-1'),
      validateFields: async (payload) => payload.sku === 'BLOCKED' ? { sku: 'example.errors.sku' } : {},
    })).rejects.toMatchObject(expected)
    expect(setup.events).toEqual(['begin', 'lock', 'existing-hook', 'rollback'])
    expect(audit).not.toHaveBeenCalled()
    expect(after).not.toHaveBeenCalled()
  })

  it('uses the finalized response and gives post-commit guards the authoritative tentative create ID', async () => {
    const create: CrudFormSectionMutationSurfaceFact = {
      ...surface,
      id: 'example.offer-create',
      guardedFacade: { method: 'POST', routePattern: '/example/products/[productId]/offers' },
      delegatedTarget: { kind: 'command', id: 'example.offers.create' },
      requestOperation: 'create',
      optimisticLock: 'none',
    }
    addManifest(true, create)
    const setup = fixture(create, null)
    const afterSuccess = jest.fn(async () => { setup.events.push('after-success') })
    registerMutationGuards([{ moduleId: 'example', guards: [{
      id: 'example.track-created-offer', targetEntity: 'example.offer', operations: ['create'],
      validate: async () => ({ ok: true, shouldRunAfterSuccess: true }),
      afterSuccess,
    }] }])
    registerCommandInterceptors([{ moduleId: 'example', interceptors: [{
      id: 'example.offer-output', targetCommand: create.delegatedTarget.id,
      afterExecute: async () => {
        setup.events.push('after-execute')
        return { modifiedResult: { id: 'response-id' } }
      },
    }] }])
    registerCommand<OfferCommandInput, Result>({
      id: create.delegatedTarget.id,
      async execute(input, context) {
        if (!context.transactionalEm) throw new Error('[internal] Expected a transactional EntityManager')
        await context.beforeTransactionalWrite?.(context.transactionalEm, input)
        setup.events.push('write')
        return { id: 'created-offer' }
      },
    })
    await expect(runCrudFormSectionMutation({
      ...setup.options,
      ...runThroughCommandBus(setup, create),
    })).resolves.toEqual({ id: 'response-id' })
    expect(afterSuccess).toHaveBeenCalledWith(expect.objectContaining({ resourceId: 'created-offer' }))
    expect(setup.events).toEqual(['begin', 'existing-hook', 'write', 'flush', 'commit', 'after-execute', 'after-success'])
  })
})
