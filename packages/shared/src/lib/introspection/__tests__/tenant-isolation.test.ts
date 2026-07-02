import type { EntityManager } from '@mikro-orm/core'
import { collectPlatformMap } from '../registry'
import type { IntrospectionContext } from '../types'

describe('tier 3 tenant isolation', () => {
  it('scopes acl-role-grant reads to the provided tenantId', async () => {
    const find = jest.fn().mockResolvedValue([])
    const em = { find } as unknown as EntityManager

    const ctx: IntrospectionContext = {
      modules: [],
      em,
      tenantId: 'tenant-a',
      organizationId: 'org-a',
      snapshot: { notificationTypes: [], aiToolConfigEntries: [], messageTypes: [] },
    }

    await collectPlatformMap(ctx, { maxTier: 3, surfaceIds: ['acl-role-grant'] })

    expect(find).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tenantId: 'tenant-a', deletedAt: null }),
      expect.any(Object),
    )
  })

  it('scopes custom-field reads to tenant and optional organization', async () => {
    const find = jest.fn().mockResolvedValue([])
    const em = { find } as unknown as EntityManager

    const ctx: IntrospectionContext = {
      modules: [],
      em,
      tenantId: 'tenant-a',
      organizationId: 'org-a',
      snapshot: { notificationTypes: [], aiToolConfigEntries: [], messageTypes: [] },
    }

    await collectPlatformMap(ctx, { maxTier: 3, surfaceIds: ['custom-field'] })

    expect(find).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId: 'tenant-a',
        organizationId: 'org-a',
        deletedAt: null,
      }),
    )
  })
})
