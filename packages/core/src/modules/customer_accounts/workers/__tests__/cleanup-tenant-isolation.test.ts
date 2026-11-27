import { AsyncLocalStorage } from 'node:async_hooks'
import type { QueuedJob, JobContext } from '@open-mercato/queue'
import { registerDatabaseRuntimeAdapter, type DatabaseExecutionContext } from '@open-mercato/shared/lib/db/runtime'
import { registerDatabaseModuleDeclarations } from '@open-mercato/shared/lib/db/declarations'
import sessions from '../cleanupExpiredSessions'
import tokens from '../cleanupExpiredTokens'

type Scope = { context: DatabaseExecutionContext; active: boolean }
const storage = new AsyncLocalStorage<Scope>()
const tenantA = '11111111-1111-4111-8111-111111111111'
const tenantB = '22222222-2222-4222-8222-222222222222'
const validateBinding = jest.fn()
const reportError = jest.fn()
const nativeDelete = jest.fn()
const nativeUpdate = jest.fn()
const containers: Array<{ scope: Scope; dispose: jest.Mock }> = []
type TenantFilter = { tenantId?: string; user?: { tenantId: string } }

function filterTenant(filter: TenantFilter): string | undefined {
  return filter.user?.tenantId ?? filter.tenantId
}
jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({ getTelemetryRuntime: () => ({ reportError }) }))
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => {
    const scope = storage.getStore()!
    expect(scope.context.kind).toBe('tenant')
    expect(scope.active).toBe(true)
    const container = {
      scope,
      resolve: () => ({ nativeDelete, nativeUpdate }),
      dispose: jest.fn(async () => {
        await new Promise<void>((resolve) => setImmediate(resolve))
        expect(storage.getStore()).toBe(scope)
        expect(scope.active).toBe(true)
      }),
    }
    containers.push(container)
    return container
  },
}))
beforeAll(() => {
  const run = <Result,>(context: DatabaseExecutionContext, callback: () => Result): Result => {
    const scope = { context, active: true }
    return storage.run(scope, () => {
      const result = callback()
      void Promise.resolve(result).then(() => { scope.active = false }, () => { scope.active = false })
      return result
    })
  }
  registerDatabaseRuntimeAdapter({
    id: 'customer-cleanup-isolation', version: '1', configurationKey: 'test',
    configurePool: () => ({ ready: async () => {}, dispose: () => {} }),
    run, runFresh: run,
  })
  registerDatabaseModuleDeclarations([{ moduleId: 'customer_accounts', declarations: { bindingValidators: [async (identity) => {
    expect(storage.getStore()?.context.kind).toBe('identity')
    expect(storage.getStore()?.active).toBe(true)
    return validateBinding(identity.context.tenantId)
  }] } }])
})

beforeEach(() => {
  jest.clearAllMocks()
  containers.length = 0
  const verifyTenant = async (_entity: unknown, filter: TenantFilter) => {
    expect(storage.getStore()?.context).toMatchObject({ kind: 'tenant', tenantId: filterTenant(filter) })
    expect(storage.getStore()?.active).toBe(true)
    return 1
  }
  nativeDelete.mockImplementation(verifyTenant)
  nativeUpdate.mockImplementation(verifyTenant)
})

describe.each([['sessions', sessions, 1], ['tokens', tokens, 3]] as const)('%s cleanup', (name, handle, count) => {
  it.each(['inactive', 'binding-failure', 'execution-failure'])('continues active B after A %s without granting invalid authority', async (outcome) => {
    validateBinding.mockImplementation(async (tenantId: string) => {
      if (tenantId === tenantB) return true
      if (outcome === 'binding-failure') throw new Error('private binding details')
      return outcome === 'execution-failure'
    })
    if (outcome === 'execution-failure') nativeDelete.mockRejectedValueOnce(new Error('private database details'))
    const maintenanceDelete = jest.fn()
    const execute = jest.fn(async () => [{ tenant_id: tenantA }, { tenant_id: tenantB }])
    const ctx = { resolve: () => ({ nativeDelete: maintenanceDelete, getConnection: () => ({ execute }) }) } as unknown as JobContext & { resolve: <T = unknown>(name: string) => T }
    await handle({ payload: {} } as QueuedJob, ctx)
    expect(validateBinding.mock.calls.map(([tenantId]) => tenantId)).toEqual([tenantA, tenantB])
    expect(maintenanceDelete).not.toHaveBeenCalled()
    const activeTenantDeletes = nativeDelete.mock.calls.filter(([, filter]) => filterTenant(filter) === tenantB)
    expect(activeTenantDeletes).toHaveLength(count)
    const joins = activeTenantDeletes.filter(([, filter]) => filter.user?.tenantId === tenantB)
    expect(joins).toHaveLength(name === 'sessions' ? 1 : 2)
    if (name === 'tokens') {
      expect(nativeUpdate).toHaveBeenCalledWith(
        expect.anything(), expect.objectContaining({ tenantId: tenantB, emailVerifiedAt: null }),
        expect.objectContaining({ isActive: false, sessionsRevokedAt: expect.any(Date) }),
      )
    }
    expect(containers.map(({ scope }) => scope.context.tenantId)).toEqual(outcome === 'execution-failure' ? [tenantA, tenantB] : [tenantB])
    for (const container of containers) {
      expect(container.dispose).toHaveBeenCalledTimes(1)
      expect(container.scope.active).toBe(false)
    }
    expect(reportError).toHaveBeenCalledTimes(1)
    expect(reportError.mock.calls[0][0].message).not.toMatch(/private/)
    expect(reportError.mock.calls[0][1]).toEqual({
      module: 'customer_accounts', code: `customer_accounts.${name}_cleanup_tenant_failed`,
    })
  })
})
