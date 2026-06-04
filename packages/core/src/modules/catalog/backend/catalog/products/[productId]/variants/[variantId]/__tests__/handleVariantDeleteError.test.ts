jest.mock('@open-mercato/ui/backend/conflicts', () => ({
  surfaceRecordConflict: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { handleVariantDeleteError } from '../page'

const surfaceRecordConflictMock = surfaceRecordConflict as jest.MockedFunction<typeof surfaceRecordConflict>
const flashMock = flash as jest.MockedFunction<typeof flash>

const translate = (_key: string, fallback?: string) => fallback ?? _key

function buildConflictError() {
  return {
    status: 409,
    body: {
      error: 'record_modified',
      code: 'optimistic_lock_conflict',
      currentUpdatedAt: '2026-05-29T10:00:00.000Z',
      expectedUpdatedAt: '2026-05-29T09:00:00.000Z',
    },
  }
}

describe('handleVariantDeleteError', () => {
  beforeEach(() => {
    surfaceRecordConflictMock.mockReset()
    flashMock.mockReset()
  })

  it('routes an optimistic-lock 409 conflict to the unified conflict bar and skips the generic flash', () => {
    surfaceRecordConflictMock.mockReturnValue(true)
    const conflict = buildConflictError()

    handleVariantDeleteError(conflict, translate)

    expect(surfaceRecordConflictMock).toHaveBeenCalledTimes(1)
    expect(surfaceRecordConflictMock).toHaveBeenCalledWith(conflict, translate)
    expect(flashMock).not.toHaveBeenCalled()
  })

  it('falls back to the generic delete-error flash for non-conflict errors', () => {
    surfaceRecordConflictMock.mockReturnValue(false)
    const error = new Error('Network down')

    handleVariantDeleteError(error, translate)

    expect(surfaceRecordConflictMock).toHaveBeenCalledTimes(1)
    expect(flashMock).toHaveBeenCalledTimes(1)
    expect(flashMock).toHaveBeenCalledWith('Network down', 'error')
  })

  it('uses the localized fallback message when the error has no message', () => {
    surfaceRecordConflictMock.mockReturnValue(false)

    handleVariantDeleteError({}, translate)

    expect(flashMock).toHaveBeenCalledWith('Failed to delete variant.', 'error')
  })
})
