import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { ForbiddenError } from '@open-mercato/ui/backend/utils/api'
import { flashMutationError } from '../flashMutationError'

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

describe('flashMutationError', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('names the missing WMS permission when ForbiddenError carries requiredFeatures', () => {
    const error = new ForbiddenError('Forbidden', {
      requiredFeatures: ['wms.manage_locations'],
    })

    flashMutationError(error, 'Failed to save location.', (key, fallback) => fallback ?? key)

    expect(flash).toHaveBeenCalledWith(
      "You don't have permission to manage warehouse locations.",
      'error',
    )
  })

  it('names the missing permission when raiseCrudError-shaped errors include requiredFeatures', () => {
    const error = Object.assign(new Error('Forbidden'), {
      status: 403,
      requiredFeatures: ['wms.manage_warehouses'],
    })

    flashMutationError(error, 'Failed to save warehouse.', (key, fallback) => fallback ?? key)

    expect(flash).toHaveBeenCalledWith(
      "You don't have permission to manage warehouses.",
      'error',
    )
  })

  it('falls back to the dialog message for a bare Forbidden toast', () => {
    flashMutationError(new ForbiddenError('Forbidden'), 'Failed to save location.')

    expect(flash).toHaveBeenCalledWith('Failed to save location.', 'error')
  })

  it.each([
    ['location_capacity_exceeded', 'wms.errors.codes.locationCapacityExceeded'],
    ['putaway_lot_mismatch', 'wms.errors.codes.putawayLotMismatch'],
    ['invalid_putaway_quantity', 'wms.errors.codes.invalidPutawayQuantity'],
    ['putaway_quantity_exceeds_task', 'wms.errors.codes.putawayQuantityExceedsTask'],
    ['duplicate_serial', 'wms.errors.codes.duplicateSerial'],
    ['invalid_qc_transition', 'wms.errors.codes.invalidQcTransition'],
  ])('translates the %s error code instead of flashing the raw token', (code, key) => {
    const error = Object.assign(new Error(code), { status: 422, error: code })
    const translate = jest.fn((translationKey: string) => `translated:${translationKey}`)

    flashMutationError(error, 'Failed to save.', translate)

    expect(translate).toHaveBeenCalledWith(key, expect.any(String))
    expect(flash).toHaveBeenCalledWith(`translated:${key}`, 'error')
  })

  it('keeps the server message for unmapped error codes', () => {
    const error = Object.assign(new Error('Something specific went wrong'), {
      status: 422,
      error: 'some_other_code',
    })

    flashMutationError(error, 'Failed to save.', (key, fallback) => fallback ?? key)

    expect(flash).toHaveBeenCalledWith('Something specific went wrong', 'error')
  })
})
