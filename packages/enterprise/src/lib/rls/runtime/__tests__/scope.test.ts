import { registerDatabaseExecutionContextResolver } from '@open-mercato/shared/lib/db/runtime'
import { currentTenantBoundaryScope, resolveTenantBoundaryScope, runWithTenantBoundary } from '../scope'

const tenantA = '11111111-1111-4111-8111-111111111111'
const tenantB = '22222222-2222-4222-8222-222222222222'
const contextA = { kind: 'tenant', source: 'worker', tenantId: tenantA } as const

afterEach(() => {
  delete (globalThis as Record<symbol, unknown>)[Symbol.for('@open-mercato/shared.databaseRuntime.v1')]
})

it('normalizes and freezes tenant identity and rejects malformed tenant IDs before callback execution', () => {
  const callback = jest.fn()
  expect(() => runWithTenantBoundary({ ...contextA, tenantId: 'invalid' }, callback)).toThrow('UUID')
  expect(callback).not.toHaveBeenCalled()
  runWithTenantBoundary(contextA, () => {
    const scope = currentTenantBoundaryScope()
    expect(scope?.context.tenantId).toBe(tenantA)
    expect(Object.isFrozen(scope?.context)).toBe(true)
  })
  runWithTenantBoundary({ ...contextA, tenantId: 'AABBCCDD-1234-4234-8234-AABBCCDDEEFF' }, () => {
    expect(currentTenantBoundaryScope()?.context.tenantId).toBe('aabbccdd-1234-4234-8234-aabbccddeeff')
  })
})

it('keeps independent concurrent invocations separate and nested identical contexts on the same token', async () => {
  const tokens = await Promise.all([tenantA, tenantB].map((tenantId) => runWithTenantBoundary({ ...contextA, tenantId }, async () => {
    const token = currentTenantBoundaryScope()?.invocation.token
    await Promise.resolve()
    expect(currentTenantBoundaryScope()?.context.tenantId).toBe(tenantId)
    runWithTenantBoundary({ ...contextA, tenantId }, () => {
      expect(currentTenantBoundaryScope()?.invocation.token).toBe(token)
    })
    return token
  })))
  expect(tokens[0]).not.toBe(tokens[1])
  expect(currentTenantBoundaryScope()).toBeUndefined()
})

it('revokes successful, rejected and synchronous invocations at their actual completion', async () => {
  const successful = await runWithTenantBoundary(contextA, async () => currentTenantBoundaryScope())
  expect(successful?.invocation.isActive()).toBe(false)
  let rejected = successful
  await expect(runWithTenantBoundary(contextA, async () => {
    rejected = currentTenantBoundaryScope()
    throw new Error('[internal] deliberate failure')
  })).rejects.toThrow('deliberate failure')
  expect(rejected?.invocation.isActive()).toBe(false)
  const synchronous = runWithTenantBoundary(contextA, () => currentTenantBoundaryScope())
  expect(synchronous?.invocation.isActive()).toBe(false)
})

it('rejects tenant switching and maintenance escalation without invoking the nested callback', () => {
  const callback = jest.fn()
  runWithTenantBoundary(contextA, () => {
    expect(() => runWithTenantBoundary({ ...contextA, tenantId: tenantB }, callback)).toThrow('Cannot change')
    expect(() => runWithTenantBoundary({ kind: 'maintenance', source: 'maintenance', tenantId: null, operation: 'global' }, callback)).toThrow('Cannot change')
  })
  expect(callback).not.toHaveBeenCalled()
})

it('separates a scoped tenant child from explicit global maintenance instead of inheriting privileged ownership', async () => {
  await runWithTenantBoundary({ kind: 'maintenance', source: 'cli', tenantId: null, operation: 'reindex' }, async () => {
    const parent = currentTenantBoundaryScope()
    await runWithTenantBoundary(contextA, async () => {
      expect(currentTenantBoundaryScope()?.invocation.token).not.toBe(parent?.invocation.token)
      expect(currentTenantBoundaryScope()?.context.kind).toBe('tenant')
    })
    expect(currentTenantBoundaryScope()).toBe(parent)
  })
})

it('uses the same request-cached token for deferred resolution and rejects a completed request', async () => {
  let active = true
  const invocation = Object.freeze({ token: Symbol('request'), isActive: () => active })
  registerDatabaseExecutionContextResolver('request', async () => ({ status: 'resolved', context: contextA, invocation }))
  expect((await resolveTenantBoundaryScope())?.invocation).toBe(invocation)
  expect((await resolveTenantBoundaryScope())?.invocation).toBe(invocation)
  active = false
  await expect(resolveTenantBoundaryScope()).rejects.toThrow('completed')
})
