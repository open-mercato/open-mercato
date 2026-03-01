import { matchesEntity, runMutationGuards } from '../mutation-guard-registry'
import type { MutationGuard, MutationGuardInput } from '../mutation-guard-registry'

describe('matchesEntity', () => {
  it('matches wildcard "*" against any entity', () => {
    expect(matchesEntity('*', 'customers.person')).toBe(true)
    expect(matchesEntity('*', 'example.todo')).toBe(true)
  })

  it('matches exact entity', () => {
    expect(matchesEntity('example.todo', 'example.todo')).toBe(true)
    expect(matchesEntity('example.todo', 'example.item')).toBe(false)
  })

  it('matches prefix wildcard (module.*)', () => {
    expect(matchesEntity('example.*', 'example.todo')).toBe(true)
    expect(matchesEntity('example.*', 'example.item')).toBe(true)
    expect(matchesEntity('example.*', 'customers.person')).toBe(false)
  })

  it('does not match partial prefix without wildcard', () => {
    expect(matchesEntity('example', 'example.todo')).toBe(false)
  })
})

describe('runMutationGuards', () => {
  const baseInput: MutationGuardInput = {
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    userId: 'user-1',
    resourceKind: 'example.todo',
    resourceId: 'todo-1',
    operation: 'update',
    requestMethod: 'PUT',
    requestHeaders: new Headers(),
    mutationPayload: { title: 'Updated' },
  }

  function makeGuard(overrides: Partial<MutationGuard> & { id: string }): MutationGuard {
    return {
      targetEntity: 'example.todo',
      operations: ['create', 'update', 'delete'],
      priority: 50,
      validate: jest.fn().mockResolvedValue({ ok: true }),
      ...overrides,
    }
  }

  it('returns ok when no guards match', async () => {
    const guard = makeGuard({ id: 'g1', targetEntity: 'other.entity' })
    const result = await runMutationGuards([guard], baseInput, { userFeatures: [] })
    expect(result.ok).toBe(true)
    expect(guard.validate).not.toHaveBeenCalled()
  })

  it('runs matching guards in priority order', async () => {
    const callOrder: string[] = []
    const g1 = makeGuard({
      id: 'g1',
      priority: 20,
      validate: jest.fn(async () => { callOrder.push('g1'); return { ok: true } }),
    })
    const g2 = makeGuard({
      id: 'g2',
      priority: 10,
      validate: jest.fn(async () => { callOrder.push('g2'); return { ok: true } }),
    })
    const result = await runMutationGuards([g1, g2], baseInput, { userFeatures: [] })
    expect(result.ok).toBe(true)
    expect(callOrder).toEqual(['g2', 'g1'])
  })

  it('stops on first rejection', async () => {
    const g1 = makeGuard({
      id: 'g1',
      priority: 10,
      validate: jest.fn().mockResolvedValue({ ok: false, message: 'Blocked', status: 403 }),
    })
    const g2 = makeGuard({
      id: 'g2',
      priority: 20,
      validate: jest.fn().mockResolvedValue({ ok: true }),
    })
    const result = await runMutationGuards([g1, g2], baseInput, { userFeatures: [] })
    expect(result.ok).toBe(false)
    expect(result.errorStatus).toBe(403)
    expect(result.errorBody).toEqual({ error: 'Blocked', guardId: 'g1' })
    expect(g2.validate).not.toHaveBeenCalled()
  })

  it('accumulates modified payload across guards', async () => {
    const g1 = makeGuard({
      id: 'g1',
      priority: 10,
      validate: jest.fn().mockResolvedValue({ ok: true, modifiedPayload: { extra: true } }),
    })
    const g2 = makeGuard({
      id: 'g2',
      priority: 20,
      validate: jest.fn(async (input) => {
        expect(input.mutationPayload).toEqual({ title: 'Updated', extra: true })
        return { ok: true }
      }),
    })
    const result = await runMutationGuards([g1, g2], baseInput, { userFeatures: [] })
    expect(result.ok).toBe(true)
    expect(result.modifiedPayload).toEqual({ title: 'Updated', extra: true })
  })

  it('collects afterSuccess callbacks', async () => {
    const afterFn = jest.fn()
    const guard = makeGuard({
      id: 'g1',
      validate: jest.fn().mockResolvedValue({ ok: true, shouldRunAfterSuccess: true, metadata: { x: 1 } }),
      afterSuccess: afterFn,
    })
    const result = await runMutationGuards([guard], baseInput, { userFeatures: [] })
    expect(result.ok).toBe(true)
    expect(result.afterSuccessCallbacks).toHaveLength(1)
    expect(result.afterSuccessCallbacks[0].guard).toBe(guard)
    expect(result.afterSuccessCallbacks[0].metadata).toEqual({ x: 1 })
  })

  it('filters guards by operation type', async () => {
    const guard = makeGuard({
      id: 'g1',
      operations: ['delete'],
      validate: jest.fn().mockResolvedValue({ ok: true }),
    })
    const result = await runMutationGuards([guard], baseInput, { userFeatures: [] })
    expect(result.ok).toBe(true)
    expect(guard.validate).not.toHaveBeenCalled()
  })

  it('filters guards by ACL features', async () => {
    const guard = makeGuard({
      id: 'g1',
      features: ['premium.locks'],
      validate: jest.fn().mockResolvedValue({ ok: false, message: 'Should not run' }),
    })

    const resultWithout = await runMutationGuards([guard], baseInput, { userFeatures: [] })
    expect(resultWithout.ok).toBe(true)

    const resultWith = await runMutationGuards([guard], baseInput, { userFeatures: ['premium.locks'] })
    expect(resultWith.ok).toBe(false)
  })

  it('uses custom error body when provided', async () => {
    const guard = makeGuard({
      id: 'g1',
      validate: jest.fn().mockResolvedValue({ ok: false, body: { custom: 'error' } }),
    })
    const result = await runMutationGuards([guard], baseInput, { userFeatures: [] })
    expect(result.ok).toBe(false)
    expect(result.errorBody).toEqual({ custom: 'error' })
  })
})
