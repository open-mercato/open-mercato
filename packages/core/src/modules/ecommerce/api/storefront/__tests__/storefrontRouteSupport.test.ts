import { AsyncLocalStorage } from 'node:async_hooks'
import type { DatabaseExecutionContext } from '@open-mercato/shared/lib/db/runtime'

const mockDatabaseScopes = new AsyncLocalStorage<DatabaseExecutionContext>()
jest.mock('@open-mercato/shared/lib/db/runtime', () => ({
  runWithDatabaseExecutionContext: (context: DatabaseExecutionContext, callback: () => unknown) => mockDatabaseScopes.run(context, callback),
}))

import { getCurrentCacheTenant } from '@open-mercato/cache'
import { runInStoreCacheTenant } from '../storefrontRouteSupport'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'

describe('runInStoreCacheTenant', () => {
  it('runs the request work in the resolved store tenant cache namespace', async () => {
    expect(getCurrentCacheTenant()).toBeNull()

    const seen = await runInStoreCacheTenant({ tenantId: TENANT_ID }, async () => {
      await Promise.resolve()
      expect(mockDatabaseScopes.getStore()).toEqual({
        kind: 'tenant', tenantId: TENANT_ID, source: 'public-token', operation: 'storefront-request',
      })
      return getCurrentCacheTenant()
    })

    expect(seen).toBe(TENANT_ID)
    expect(mockDatabaseScopes.getStore()).toBeUndefined()
    expect(getCurrentCacheTenant()).toBeNull()
  })

  it('propagates the work result and rejections unchanged', async () => {
    await expect(runInStoreCacheTenant({ tenantId: TENANT_ID }, async () => 42)).resolves.toBe(42)
    await expect(
      runInStoreCacheTenant({ tenantId: TENANT_ID }, async () => {
        throw new Error('[internal] boom')
      }),
    ).rejects.toThrow('[internal] boom')
  })
})

it('keeps overlapping resolved storefronts isolated across awaited work', async () => {
  const otherTenantId = '22222222-2222-4222-8222-222222222222'
  const tenants = [TENANT_ID, otherTenantId]
  await Promise.all(tenants.map((tenantId) => runInStoreCacheTenant({ tenantId }, async () => {
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(mockDatabaseScopes.getStore()).toMatchObject({ kind: 'tenant', tenantId })
    expect(getCurrentCacheTenant()).toBe(tenantId)
  })))
  expect(mockDatabaseScopes.getStore()).toBeUndefined()
  expect(getCurrentCacheTenant()).toBeNull()
})
