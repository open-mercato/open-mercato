import type { EntityManager } from '@mikro-orm/postgresql'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { SsoConfig, SsoUserDeactivation } from '../../data/entities'
import { isSsoUserDeactivated } from '../deactivation'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findOneWithDecryption: jest.fn() }))

const scope = { userId: 'user-1', tenantId: 'tenant-1', organizationId: 'org-1' }
const marker = { id: 'marker-1', ssoConfigId: 'config-1', tenantId: null } as SsoUserDeactivation
const em = {} as EntityManager

describe('legacy nullable SSO deactivation scope', () => {
  beforeEach(() => jest.mocked(findOneWithDecryption).mockReset())

  it('denies a null-tenant configuration marker only after organization and configuration ownership are proven', async () => {
    jest.mocked(findOneWithDecryption)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(marker)
      .mockResolvedValueOnce({ id: 'org-1' } as Organization)
      .mockResolvedValueOnce({ id: 'config-1' } as SsoConfig)

    await expect(isSsoUserDeactivated(em, scope)).resolves.toBe(true)

    expect(findOneWithDecryption).toHaveBeenNthCalledWith(3, em, Organization,
      { id: 'org-1', tenant: 'tenant-1' }, { fields: ['id'] },
      { tenantId: 'tenant-1', organizationId: 'org-1' })
    expect(findOneWithDecryption).toHaveBeenNthCalledWith(4, em, SsoConfig,
      { id: 'config-1', organizationId: 'org-1', tenantId: null }, { fields: ['id'] },
      { tenantId: null, organizationId: 'org-1' })
  })

  it('does not apply a nullable marker to an organization owned by another tenant', async () => {
    jest.mocked(findOneWithDecryption)
      .mockResolvedValueOnce(null).mockResolvedValueOnce(marker).mockResolvedValueOnce(null)

    await expect(isSsoUserDeactivated(em, scope)).resolves.toBe(false)
    expect(findOneWithDecryption).toHaveBeenCalledTimes(3)
  })

  it('does not trust a marker whose configuration does not match its nullable organization scope', async () => {
    jest.mocked(findOneWithDecryption)
      .mockResolvedValueOnce(null).mockResolvedValueOnce(marker)
      .mockResolvedValueOnce({ id: 'org-1' } as Organization).mockResolvedValueOnce(null)

    await expect(isSsoUserDeactivated(em, scope)).resolves.toBe(false)
  })

  it('keeps the exact configuration filter when checking a nullable legacy marker', async () => {
    jest.mocked(findOneWithDecryption).mockResolvedValue(null)

    await expect(isSsoUserDeactivated(em, { ...scope, ssoConfigId: 'config-2' })).resolves.toBe(false)
    expect(findOneWithDecryption).toHaveBeenNthCalledWith(2, em, SsoUserDeactivation,
      { userId: 'user-1', tenantId: null, organizationId: 'org-1', ssoConfigId: 'config-2', reactivatedAt: null },
      {}, { tenantId: 'tenant-1', organizationId: 'org-1' })
  })
})
