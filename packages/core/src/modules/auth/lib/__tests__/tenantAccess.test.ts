import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { enforceTenantSelection } from '@open-mercato/core/modules/auth/lib/tenantAccess'

describe('enforceTenantSelection', () => {
  it('allows superadmin to target a tenant different from the current header tenant', async () => {
    const resolve = jest.fn(() => ({
      loadAcl: jest.fn(),
    }))

    await expect(
      enforceTenantSelection(
        {
          auth: {
            sub: 'user-1',
            tenantId: 'tenant-header',
            orgId: 'org-header',
            isSuperAdmin: true,
          },
          container: { resolve },
        },
        'tenant-form',
      ),
    ).resolves.toBe('tenant-form')

    expect(resolve).not.toHaveBeenCalled()
  })

  it('rejects non-superadmin targeting a tenant different from the current header tenant', async () => {
    const resolve = jest.fn(() => ({
      loadAcl: jest.fn(),
    }))

    await expect(
      enforceTenantSelection(
        {
          auth: {
            sub: 'user-1',
            tenantId: 'tenant-header',
            orgId: 'org-header',
            isSuperAdmin: false,
          },
          container: { resolve },
        },
        'tenant-form',
      ),
    ).rejects.toMatchObject<Partial<CrudHttpError>>({
      status: 403,
      body: { error: 'Not authorized to target this tenant.' },
    })
  })

  it('falls back to the current tenant when non-superadmin omits tenant selection', async () => {
    const resolve = jest.fn(() => ({
      loadAcl: jest.fn(),
    }))

    await expect(
      enforceTenantSelection(
        {
          auth: {
            sub: 'user-1',
            tenantId: 'tenant-header',
            orgId: 'org-header',
            isSuperAdmin: false,
          },
          container: { resolve },
        },
        undefined,
      ),
    ).resolves.toBe('tenant-header')
  })
})
