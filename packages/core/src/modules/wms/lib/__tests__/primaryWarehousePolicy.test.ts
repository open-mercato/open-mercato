/** @jest-environment node */

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(),
  findOneWithDecryption: jest.fn(),
}))

import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  resolvePrimaryWarehouseId,
  sortWarehouseAvailabilityForReservation,
  type WarehouseAvailability,
} from '../primaryWarehousePolicy'
import { Warehouse } from '../../data/entities'

const findOneWithDecryptionMock = jest.mocked(findOneWithDecryption)
const findWithDecryptionMock = jest.mocked(findWithDecryption)

describe('primary warehouse reservation policy', () => {
  beforeEach(() => {
    findOneWithDecryptionMock.mockReset()
    findWithDecryptionMock.mockReset()
  })

  it('resolvePrimaryWarehouseId returns the active primary warehouse id', async () => {
    findOneWithDecryptionMock.mockResolvedValue({ id: 'warehouse-primary' } as Warehouse)

    await expect(
      resolvePrimaryWarehouseId({} as never, { tenantId: 'tenant-1', organizationId: 'org-1' }),
    ).resolves.toBe('warehouse-primary')

    expect(findOneWithDecryptionMock).toHaveBeenCalledWith(
      {},
      Warehouse,
      {
        organizationId: 'org-1',
        isPrimary: true,
        isActive: true,
        deletedAt: null,
      },
      undefined,
      { tenantId: 'tenant-1', organizationId: 'org-1' },
    )
  })

  it('resolvePrimaryWarehouseId returns null when no primary warehouse exists', async () => {
    findOneWithDecryptionMock.mockResolvedValue(null)

    await expect(
      resolvePrimaryWarehouseId({} as never, { tenantId: 'tenant-1', organizationId: 'org-1' }),
    ).resolves.toBeNull()
  })

  it('prefers the primary warehouse before higher-availability secondary warehouses', () => {
    const primaryWarehouseId = 'warehouse-primary'
    const availability: WarehouseAvailability[] = [
      { warehouseId: 'warehouse-secondary', available: 100 },
      { warehouseId: primaryWarehouseId, available: 5 },
    ]

    expect(
      sortWarehouseAvailabilityForReservation(availability, primaryWarehouseId).map((entry) => entry.warehouseId),
    ).toEqual([primaryWarehouseId, 'warehouse-secondary'])
  })

  it('falls back to availability ordering when no primary warehouse is configured', () => {
    const availability: WarehouseAvailability[] = [
      { warehouseId: 'warehouse-a', available: 10 },
      { warehouseId: 'warehouse-b', available: 25 },
    ]

    expect(sortWarehouseAvailabilityForReservation(availability, null).map((entry) => entry.warehouseId)).toEqual([
      'warehouse-b',
      'warehouse-a',
    ])
  })
})
