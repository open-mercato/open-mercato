export {}

import { isMtoAutoDraftEnabled, MTO_AUTO_DRAFT_CONFIG_KEY } from '../mtoAutoDraftConfig.js'

describe('isMtoAutoDraftEnabled', () => {
  it('returns false when tenantId is missing', async () => {
    const resolver = { resolve: jest.fn() }
    await expect(isMtoAutoDraftEnabled(resolver, null)).resolves.toBe(false)
    await expect(isMtoAutoDraftEnabled(resolver, undefined)).resolves.toBe(false)
    expect(resolver.resolve).not.toHaveBeenCalled()
  })

  it('returns false when moduleConfigService cannot be resolved (degrades, never throws)', async () => {
    const resolver = { resolve: jest.fn(() => { throw new Error('not registered') }) }
    await expect(isMtoAutoDraftEnabled(resolver, 'tenant-1')).resolves.toBe(false)
  })

  it('returns false when the config value is the (OFF) default', async () => {
    const getValue = jest.fn().mockResolvedValue(false)
    const resolver = { resolve: jest.fn(() => ({ getValue })) }
    await expect(isMtoAutoDraftEnabled(resolver, 'tenant-1')).resolves.toBe(false)
    expect(getValue).toHaveBeenCalledWith('production', MTO_AUTO_DRAFT_CONFIG_KEY, {
      defaultValue: false,
      scope: { tenantId: 'tenant-1' },
    })
  })

  it('returns true when the tenant has explicitly opted in', async () => {
    const getValue = jest.fn().mockResolvedValue(true)
    const resolver = { resolve: jest.fn(() => ({ getValue })) }
    await expect(isMtoAutoDraftEnabled(resolver, 'tenant-1')).resolves.toBe(true)
  })
})
