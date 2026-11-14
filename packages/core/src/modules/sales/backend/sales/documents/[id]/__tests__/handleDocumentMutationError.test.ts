/**
 * @jest-environment jsdom
 */
const mockSurfaceRecordConflict = jest.fn()
const mockFlash = jest.fn()

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: (...args: unknown[]) => mockFlash(...args),
}))

jest.mock('@open-mercato/ui/backend/conflicts', () => ({
  surfaceRecordConflict: (...args: unknown[]) => mockSurfaceRecordConflict(...args),
}))

import { handleDocumentMutationError, handleQuoteActionError } from '../page'

import { raiseCrudError } from '@open-mercato/ui/backend/utils/serverErrors'

const t = (_key: string, fallback?: string) => fallback ?? _key

describe('handleDocumentMutationError', () => {
  beforeEach(() => {
    mockSurfaceRecordConflict.mockReset()
  })

  it('surfaces the conflict, refreshes, and returns true for an optimistic-lock 409', () => {
    mockSurfaceRecordConflict.mockReturnValue(true)
    const refresh = jest.fn()
    const err = new Error('optimistic_lock_conflict')

    const handled = handleDocumentMutationError(err, t, refresh)

    expect(handled).toBe(true)
    expect(mockSurfaceRecordConflict).toHaveBeenCalledTimes(1)
    expect(mockSurfaceRecordConflict).toHaveBeenCalledWith(err, t, { onRefresh: refresh })
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('returns false and does not refresh for a non-conflict error', () => {
    mockSurfaceRecordConflict.mockReturnValue(false)
    const refresh = jest.fn()
    const err = new Error('boom')

    const handled = handleDocumentMutationError(err, t, refresh)

    expect(handled).toBe(false)
    expect(mockSurfaceRecordConflict).toHaveBeenCalledTimes(1)
    expect(refresh).not.toHaveBeenCalled()
  })
})

describe('handleQuoteActionError', () => {
  beforeEach(() => {
    mockSurfaceRecordConflict.mockReset().mockReturnValue(false)
    mockFlash.mockReset()
  })

  it.each([
    ['send', 'Add at least one line before sending or converting a recurring quote.'],
    ['convert', 'This recurring quote starts in the past. Create a new quote with a current start date.'],
  ])('shows the server refusal for %s', async (_action, message) => {
    const response = { status: 422, text: async () => JSON.stringify({ error: message }) } as Response
    let error: unknown
    try {
      await raiseCrudError(response, 'Generic action failure')
    } catch (caught) {
      error = caught
    }
    handleQuoteActionError(error, t, jest.fn(), 'Generic action failure')
    expect(mockFlash).toHaveBeenCalledWith(message, 'error')
  })

  it.each([undefined, {}, new Error('')])('uses the translated fallback for an error without a message: %p', (error) => {
    handleQuoteActionError(error, t, jest.fn(), 'Nie udało się wysłać oferty.')
    expect(mockFlash).toHaveBeenCalledWith('Nie udało się wysłać oferty.', 'error')
  })

  it('keeps a real optimistic-lock conflict on the existing conflict surface', () => {
    mockSurfaceRecordConflict.mockReturnValue(true)
    const refresh = jest.fn()
    handleQuoteActionError(new Error('record_modified'), t, refresh, 'Action failed')
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(mockFlash).not.toHaveBeenCalled()
  })
})
