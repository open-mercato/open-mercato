import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { ForbiddenError } from '@open-mercato/ui/backend/utils/api'
import {
  flashMutationError,
  readWmsErrorCode,
  resolveWmsErrorCodeMessage,
} from '../flashMutationError'

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
    ['putaway_quantity_exceeds_task', 'wms.errors.codes.putawayQuantityExceedsTask'],
    ['invalid_putaway_quantity', 'wms.errors.codes.invalidPutawayQuantity'],
    ['invalid_putaway_state', 'wms.errors.invalidPutawayState'],
    ['invalid_putaway_target_location', 'wms.errors.codes.invalidPutawayTargetLocation'],
    ['putaway_complete_quantity_conflict', 'wms.errors.codes.putawayCompleteQuantityConflict'],
    ['putaway_delete_done_forbidden', 'wms.errors.codes.putawayDeleteDoneForbidden'],
    ['putaway_delete_requires_terminal_status', 'wms.errors.codes.putawayDeleteRequiresTerminalStatus'],
    ['lifecycle_field_forbidden', 'wms.errors.codes.lifecycleFieldForbidden'],
    ['invalid_location', 'wms.errors.codes.invalidLocation'],
    ['inactive_location', 'wms.errors.codes.inactiveLocation'],
    ['insufficient_stock', 'wms.errors.codes.insufficientStock'],
  ])('translates the %s error code instead of flashing it raw', (code, key) => {
    const error = Object.assign(new Error(code), { status: 422, error: code })
    const translate = jest.fn((translationKey: string) => `translated:${translationKey}`)

    flashMutationError(error, 'Failed to complete putaway task.', translate)

    expect(translate).toHaveBeenCalledWith(key, expect.any(String))
    expect(flash).toHaveBeenCalledWith(`translated:${key}`, 'error')
  })

  it('uses the English fallback for a known code when no translator is passed', () => {
    const error = Object.assign(new Error('putaway_quantity_exceeds_task'), {
      status: 422,
      error: 'putaway_quantity_exceeds_task',
    })

    flashMutationError(error, 'Failed to complete putaway task.')

    expect(flash).toHaveBeenCalledWith(
      'The confirmed quantity exceeds the open quantity of this putaway task.',
      'error',
    )
  })

  it('keeps the server message for an unknown error code', () => {
    const error = Object.assign(new Error('Warehouse not found.'), {
      status: 404,
      error: 'Warehouse not found.',
    })

    flashMutationError(error, 'Failed to complete putaway task.', (key, fallback) => fallback ?? key)

    expect(flash).toHaveBeenCalledWith('Warehouse not found.', 'error')
  })

  it('ignores inherited object keys when resolving error codes', () => {
    const error = Object.assign(new Error('toString'), { status: 422, error: 'toString' })

    expect(resolveWmsErrorCodeMessage(error)).toBeNull()
    expect(readWmsErrorCode(error)).toBe('toString')
  })
})
