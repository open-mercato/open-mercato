/** @jest-environment node */

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
}))

import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { FeatureToggle } from '@open-mercato/core/modules/feature_toggles/data/entities'
import { SALES_CHANNELS_TOGGLE_ID } from '../salesChannelsToggleId'
import { SALES_CHANNELS_TOGGLE_DEFINITION, seedSalesChannelsToggle } from '../salesChannelsToggleSeed'

const findOneWithDecryptionMock = jest.mocked(findOneWithDecryption)

function createEm() {
  return {
    persist: jest.fn(),
    create: jest.fn((_entity: unknown, data: unknown) => data),
    flush: jest.fn().mockResolvedValue(undefined),
  }
}

describe('seedSalesChannelsToggle', () => {
  beforeEach(() => {
    findOneWithDecryptionMock.mockReset()
  })

  it('registers the sales channels toggle when the definition row is missing', async () => {
    findOneWithDecryptionMock.mockResolvedValue(null)
    const em = createEm()

    await seedSalesChannelsToggle(em as never)

    // The filter must stay `deletedAt`-free: deletion is soft and the identifier
    // unique constraint covers deleted rows too, so a `deletedAt: null` filter
    // would turn a deleted toggle into a duplicate insert.
    expect(findOneWithDecryptionMock).toHaveBeenCalledWith(em, FeatureToggle, {
      identifier: SALES_CHANNELS_TOGGLE_ID,
    })
    expect(em.create).toHaveBeenCalledWith(
      FeatureToggle,
      expect.objectContaining({
        identifier: SALES_CHANNELS_TOGGLE_ID,
        type: 'boolean',
        defaultValue: true,
      }),
    )
    expect(em.persist).toHaveBeenCalledTimes(1)
    expect(em.flush).toHaveBeenCalledTimes(1)
  })

  it('is idempotent when the toggle already exists', async () => {
    findOneWithDecryptionMock.mockResolvedValue({ id: 'existing' })
    const em = createEm()

    await seedSalesChannelsToggle(em as never)

    expect(em.create).not.toHaveBeenCalled()
    expect(em.persist).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
  })

  // Deleting a toggle sets `deleted_at` but keeps the row, and
  // `feature_toggles_identifier_unique` is not scoped to live rows, so seeding on
  // top of a deleted definition must skip rather than raise a unique violation
  // and abort the whole seed run.
  it('does not insert when the definition row exists but was soft-deleted', async () => {
    findOneWithDecryptionMock.mockResolvedValue({ id: 'deleted', deletedAt: new Date() })
    const em = createEm()

    await seedSalesChannelsToggle(em as never)

    expect(em.create).not.toHaveBeenCalled()
    expect(em.persist).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('uses the identifier the client and server hooks poll', () => {
    expect(SALES_CHANNELS_TOGGLE_DEFINITION.identifier).toBe('sales_channels_enabled')
    expect(SALES_CHANNELS_TOGGLE_DEFINITION.defaultValue).toBe(true)
  })
})
