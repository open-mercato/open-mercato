/** @jest-environment node */

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
}))

import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { FeatureToggle } from '@open-mercato/core/modules/feature_toggles/data/entities'
import {
  resolveWmsIntegrationToggleEnabled,
  seedWmsIntegrationToggles,
} from '../wmsIntegrationToggles'

const findOneWithDecryptionMock = jest.mocked(findOneWithDecryption)

describe('wmsIntegrationToggles', () => {
  beforeEach(() => {
    findOneWithDecryptionMock.mockReset()
  })

  it('seeds missing toggles idempotently', async () => {
    findOneWithDecryptionMock.mockResolvedValue(null)
    const persist = jest.fn()
    const create = jest.fn((_, data) => data)
    const em = {
      persist,
      create,
      flush: jest.fn().mockResolvedValue(undefined),
    }

    await seedWmsIntegrationToggles(em as never)

    expect(create).toHaveBeenCalledTimes(3)
    expect(persist).toHaveBeenCalledTimes(3)
    expect(em.flush).toHaveBeenCalledTimes(1)
  })

  it('auto-seeds and resolves enabled when toggle row is missing', async () => {
    findOneWithDecryptionMock.mockResolvedValue(null)
    const em = {
      persist: jest.fn(),
      create: jest.fn((_, data) => data),
      flush: jest.fn().mockResolvedValue(undefined),
    }
    const invalidateIsEnabledCacheByKey = jest.fn().mockResolvedValue(undefined)
    const getBoolConfig = jest
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        error: { code: 'MISSING_TOGGLE' },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: true,
      })

    const enabled = await resolveWmsIntegrationToggleEnabled(
      { getBoolConfig, invalidateIsEnabledCacheByKey } as never,
      em as never,
      'wms_integration_sales_order_inventory',
      'tenant-1',
    )

    expect(enabled).toBe(true)
    expect(getBoolConfig).toHaveBeenCalledTimes(2)
    expect(invalidateIsEnabledCacheByKey).toHaveBeenCalledWith(
      'wms_integration_sales_order_inventory',
      'tenant-1',
    )
    expect(findOneWithDecryptionMock).toHaveBeenCalledWith(
      em,
      FeatureToggle,
      expect.objectContaining({ identifier: 'wms_integration_sales_order_inventory' }),
    )
  })

  it('returns configured default when toggle exists and is disabled', async () => {
    const getBoolConfig = jest.fn().mockResolvedValue({ ok: true, value: false })
    const enabled = await resolveWmsIntegrationToggleEnabled(
      { getBoolConfig, invalidateIsEnabledCacheByKey: jest.fn() } as never,
      { flush: jest.fn() } as never,
      'wms_integration_sales_order_inventory',
      'tenant-1',
    )

    expect(enabled).toBe(false)
    expect(getBoolConfig).toHaveBeenCalledTimes(1)
  })
})
