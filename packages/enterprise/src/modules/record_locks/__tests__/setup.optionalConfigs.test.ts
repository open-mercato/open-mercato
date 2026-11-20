import type { EntityManager } from '@mikro-orm/postgresql'
import { ModuleConfig } from '@open-mercato/core/modules/configs/data/entities'
import { setup } from '../setup'
import { DEFAULT_RECORD_LOCK_SETTINGS } from '../lib/config'

function buildEm(hasModuleConfig: boolean) {
  const em = {
    getMetadata: jest.fn(() => ({ find: (entity: unknown) => (entity === ModuleConfig ? hasModuleConfig : true) })),
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn((_entity: unknown, data: unknown) => data),
    persist: jest.fn(),
    flush: jest.fn().mockResolvedValue(undefined),
  }
  return em
}

describe('record_locks onTenantCreated (#9205)', () => {
  test('skips the settings seed without touching the ORM when configs is disabled', async () => {
    const em = buildEm(false)

    await expect(
      setup.onTenantCreated?.({ em: em as unknown as EntityManager, tenantId: 'tenant-1', organizationId: 'org-1' }),
    ).resolves.toBeUndefined()

    expect(em.findOne).not.toHaveBeenCalled()
    expect(em.create).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
  })

  test('seeds the default settings row when configs is enabled', async () => {
    const em = buildEm(true)

    await setup.onTenantCreated?.({ em: em as unknown as EntityManager, tenantId: 'tenant-1', organizationId: 'org-1' })

    expect(em.create).toHaveBeenCalledWith(
      ModuleConfig,
      expect.objectContaining({ valueJson: DEFAULT_RECORD_LOCK_SETTINGS }),
    )
    expect(em.flush).toHaveBeenCalled()
  })
})
