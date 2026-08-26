/** @jest-environment node */

import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { enforceInventoryTrackingRequirements } from '../inventoryTrackingValidation'

describe('enforceInventoryTrackingRequirements', () => {
  it('requires lot when profile.trackLot is true', () => {
    expect(() =>
      enforceInventoryTrackingRequirements({ trackLot: true, trackSerial: false }, {}),
    ).toThrow(CrudHttpError)
    try {
      enforceInventoryTrackingRequirements({ trackLot: true }, { lotId: null })
    } catch (error) {
      expect(error).toBeInstanceOf(CrudHttpError)
      expect((error as CrudHttpError).status).toBe(422)
      expect((error as CrudHttpError).body).toMatchObject({ error: 'lot_required' })
    }
  })

  it('requires serial when profile.trackSerial is true', () => {
    expect(() =>
      enforceInventoryTrackingRequirements({ trackLot: false, trackSerial: true }, { lotId: 'lot-1' }),
    ).toThrow(CrudHttpError)
    try {
      enforceInventoryTrackingRequirements({ trackSerial: true }, { serialNumber: '  ' })
    } catch (error) {
      expect((error as CrudHttpError).body).toMatchObject({ error: 'serial_required' })
    }
  })

  it('allows receive when tracking fields satisfy the profile', () => {
    expect(() =>
      enforceInventoryTrackingRequirements(
        { trackLot: true, trackSerial: true },
        { lotId: 'lot-1', serialNumber: 'SN-1' },
      ),
    ).not.toThrow()
  })
})
