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
})
