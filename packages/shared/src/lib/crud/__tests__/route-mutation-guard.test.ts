import type { AwilixContainer } from 'awilix'
import { registerMutationGuards } from '../mutation-guard-store'
import type { MutationGuard } from '../mutation-guard-registry'
import { runRouteMutationGuards, toRegistryMutationOperation } from '../route-mutation-guard'

type Registrations = Record<string, unknown>

function makeContainer(registrations: Registrations = {}): AwilixContainer {
  return {
    resolve: (name: string) => {
      if (Object.prototype.hasOwnProperty.call(registrations, name)) return registrations[name]
      throw new Error(`[test] no registration for ${name}`)
    },
  } as unknown as AwilixContainer
}

function makeRequest(method = 'POST'): Request {
  return new Request('https://example.test/api/things', { method })
}

function makeGuard(overrides: Partial<MutationGuard> & { id: string }): MutationGuard {
  return {
    targetEntity: 'things.thing',
    operations: ['create', 'update', 'delete'],
    priority: 50,
    validate: jest.fn().mockResolvedValue({ ok: true }),
    ...overrides,
  }
}

function registerStoreGuards(guards: MutationGuard[]) {
  registerMutationGuards([{ moduleId: 'things', guards }])
}

const baseAuth = {
  userId: 'user-1',
  tenantId: 'tenant-1',
  organizationId: 'org-1',
  userFeatures: [] as string[],
}
const baseInput = {
  resourceKind: 'things.thing',
  resourceId: 'thing-1',
  operation: 'update' as const,
  mutationPayload: { title: 'Updated' },
}

afterEach(() => {
  registerMutationGuards([])
  jest.restoreAllMocks()
})

describe('toRegistryMutationOperation', () => {
  it('passes create and delete through and maps update/custom/undefined to update', () => {
    expect(toRegistryMutationOperation('create')).toBe('create')
    expect(toRegistryMutationOperation('delete')).toBe('delete')
    expect(toRegistryMutationOperation('update')).toBe('update')
    expect(toRegistryMutationOperation('custom')).toBe('update')
    expect(toRegistryMutationOperation(undefined)).toBe('update')
  })
})

describe('runRouteMutationGuards', () => {
  it('runs a registry-store guard the legacy bridge path would have skipped', async () => {
    const guard = makeGuard({ id: 'store-guard' })
    registerStoreGuards([guard])

    const result = await runRouteMutationGuards({
      container: makeContainer(),
      req: makeRequest(),
      auth: baseAuth,
      input: baseInput,
    })

    expect(result.ok).toBe(true)
    expect(guard.validate).toHaveBeenCalledTimes(1)
  })

  it('blocks and returns a ready response when a store guard rejects', async () => {
    const guard = makeGuard({
      id: 'blocking-guard',
      validate: jest.fn().mockResolvedValue({ ok: false, status: 422, body: { error: 'nope' } }),
    })
    registerStoreGuards([guard])

    const result = await runRouteMutationGuards({
      container: makeContainer(),
      req: makeRequest(),
      auth: baseAuth,
      input: baseInput,
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected blocked result')
    expect(result.errorStatus).toBe(422)
    expect(result.errorBody).toEqual({ error: 'nope' })
    expect(result.response.status).toBe(422)
    await expect(result.response.json()).resolves.toEqual({ error: 'nope' })
  })

  it('threads modifiedPayload from a store guard', async () => {
    const guard = makeGuard({
      id: 'transform-guard',
      validate: jest.fn().mockResolvedValue({ ok: true, modifiedPayload: { extra: true } }),
    })
    registerStoreGuards([guard])

    const result = await runRouteMutationGuards({
      container: makeContainer(),
      req: makeRequest(),
      auth: baseAuth,
      input: baseInput,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected passed result')
    expect(result.modifiedPayload).toEqual({ title: 'Updated', extra: true })
  })

  it('runs afterSuccess callbacks via runAfterSuccess()', async () => {
    const afterSuccess = jest.fn().mockResolvedValue(undefined)
    const guard = makeGuard({
      id: 'after-guard',
      validate: jest.fn().mockResolvedValue({ ok: true, shouldRunAfterSuccess: true, metadata: { ping: 1 } }),
      afterSuccess,
    })
    registerStoreGuards([guard])

    const result = await runRouteMutationGuards({
      container: makeContainer(),
      req: makeRequest(),
      auth: baseAuth,
      input: baseInput,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected passed result')
    expect(afterSuccess).not.toHaveBeenCalled()

    await result.runAfterSuccess()

    expect(afterSuccess).toHaveBeenCalledTimes(1)
    expect(afterSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ resourceKind: 'things.thing', resourceId: 'thing-1', metadata: { ping: 1 } }),
    )
  })

  it('swallows afterSuccess callback errors so a committed write still succeeds', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
    const guard = makeGuard({
      id: 'throwing-after-guard',
      validate: jest.fn().mockResolvedValue({ ok: true, shouldRunAfterSuccess: true }),
      afterSuccess: jest.fn().mockRejectedValue(new Error('after boom')),
    })
    registerStoreGuards([guard])

    const result = await runRouteMutationGuards({
      container: makeContainer(),
      req: makeRequest(),
      auth: baseAuth,
      input: baseInput,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected passed result')
    await expect(result.runAfterSuccess()).resolves.toBeUndefined()
    expect(consoleError).toHaveBeenCalled()
  })

  it('skips feature-gated guards when the caller lacks the feature', async () => {
    const guard = makeGuard({
      id: 'gated-guard',
      features: ['premium.locks'],
      validate: jest.fn().mockResolvedValue({ ok: false, message: 'should not run' }),
    })
    registerStoreGuards([guard])

    const passes = await runRouteMutationGuards({
      container: makeContainer(),
      req: makeRequest(),
      auth: { ...baseAuth, userFeatures: [] },
      input: baseInput,
    })
    expect(passes.ok).toBe(true)
    expect(guard.validate).not.toHaveBeenCalled()

    const blocks = await runRouteMutationGuards({
      container: makeContainer(),
      req: makeRequest(),
      auth: { ...baseAuth, userFeatures: ['premium.locks'] },
      input: baseInput,
    })
    expect(blocks.ok).toBe(false)
  })

  it('resolves userFeatures from rbacService when not pre-supplied', async () => {
    const getGrantedFeatures = jest.fn().mockResolvedValue(['premium.locks'])
    const guard = makeGuard({
      id: 'gated-guard',
      features: ['premium.locks'],
      validate: jest.fn().mockResolvedValue({ ok: false, message: 'blocked via rbac-resolved features' }),
    })
    registerStoreGuards([guard])

    const result = await runRouteMutationGuards({
      container: makeContainer({ rbacService: { getGrantedFeatures } }),
      req: makeRequest(),
      auth: { userId: 'user-1', tenantId: 'tenant-1', organizationId: 'org-1' },
      input: baseInput,
    })

    expect(getGrantedFeatures).toHaveBeenCalledWith('user-1', { tenantId: 'tenant-1', organizationId: 'org-1' })
    expect(result.ok).toBe(false)
  })

  it('maps a custom operation to update so update-scoped guards run', async () => {
    const updateGuard = makeGuard({
      id: 'update-only-guard',
      operations: ['update'],
      validate: jest.fn().mockResolvedValue({ ok: true }),
    })
    const createGuard = makeGuard({
      id: 'create-only-guard',
      operations: ['create'],
      validate: jest.fn().mockResolvedValue({ ok: true }),
    })
    registerStoreGuards([updateGuard, createGuard])

    const result = await runRouteMutationGuards({
      container: makeContainer(),
      req: makeRequest(),
      auth: baseAuth,
      input: { ...baseInput, operation: 'custom' },
    })

    expect(result.ok).toBe(true)
    expect(updateGuard.validate).toHaveBeenCalledTimes(1)
    expect(createGuard.validate).not.toHaveBeenCalled()
  })

  it('includes the bridged legacy DI guard', async () => {
    const legacyService = {
      validateMutation: jest.fn().mockResolvedValue({ ok: false, status: 409, body: { error: 'locked' } }),
      afterMutationSuccess: jest.fn().mockResolvedValue(undefined),
    }

    const result = await runRouteMutationGuards({
      container: makeContainer({ crudMutationGuardService: legacyService }),
      req: makeRequest('PUT'),
      auth: baseAuth,
      input: baseInput,
    })

    expect(legacyService.validateMutation).toHaveBeenCalledTimes(1)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected blocked result')
    expect(result.errorStatus).toBe(409)
    expect(result.errorBody).toEqual({ error: 'locked' })
  })
})
