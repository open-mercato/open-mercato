import { getCurrentCacheTenant } from '@open-mercato/cache'
import { runInStoreCacheTenant } from '../storefrontRouteSupport'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'

describe('runInStoreCacheTenant', () => {
  it('runs the request work in the resolved store tenant cache namespace', async () => {
    expect(getCurrentCacheTenant()).toBeNull()

    const seen = await runInStoreCacheTenant({ tenantId: TENANT_ID }, async () => getCurrentCacheTenant())

    expect(seen).toBe(TENANT_ID)
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
