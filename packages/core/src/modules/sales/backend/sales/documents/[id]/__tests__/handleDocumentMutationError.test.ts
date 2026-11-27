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

  it('surfaces the conflict without refreshing until the user explicitly requests it', () => {
    mockSurfaceRecordConflict.mockReturnValue(true)
    const refresh = jest.fn()
    const err = new Error('optimistic_lock_conflict')

    const handled = handleDocumentMutationError(err, t, refresh)

    expect(handled).toBe(true)
    expect(mockSurfaceRecordConflict).toHaveBeenCalledTimes(1)
    expect(mockSurfaceRecordConflict).toHaveBeenCalledWith(err, t, { onRefresh: refresh })
    expect(refresh).not.toHaveBeenCalled()
    mockSurfaceRecordConflict.mock.calls[0][2].onRefresh()
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('localizes the rejected conflict without losing its transport details', () => {
    mockSurfaceRecordConflict.mockReturnValue(true)
    const details = { error: 'record_modified', currentUpdatedAt: '2026-11-22T20:00:00.000Z' }
    const error = Object.assign(new Error('record_modified'), { status: 409, details })
    const translate = jest.fn(() => 'Ten rekord został zmieniony. Odśwież i spróbuj ponownie.')

    expect(handleDocumentMutationError(error, translate, jest.fn())).toBe(true)
    expect(error.message).toBe('Ten rekord został zmieniony. Odśwież i spróbuj ponownie.')
    expect(translate).toHaveBeenCalledWith(
      'ui.forms.flash.recordModified',
      'This record was modified by someone else. Refresh and try again.',
    )
    expect(error.status).toBe(409)
    expect(error.details).toBe(details)
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
    expect(refresh).not.toHaveBeenCalled()
    mockSurfaceRecordConflict.mock.calls[0][2].onRefresh()
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(mockFlash).not.toHaveBeenCalled()
  })
})
