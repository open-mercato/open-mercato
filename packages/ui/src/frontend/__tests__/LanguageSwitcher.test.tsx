/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { LanguageSwitcher } from '../LanguageSwitcher'

const mockRefresh = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: mockRefresh,
  }),
}))

describe('LanguageSwitcher', () => {
  const originalFetch = global.fetch
  let dispatchEventSpy: jest.SpyInstance

  beforeEach(() => {
    mockRefresh.mockReset()
    dispatchEventSpy = jest.spyOn(window, 'dispatchEvent')
  })

  afterEach(() => {
    dispatchEventSpy.mockRestore()
    if (originalFetch) {
      global.fetch = originalFetch
      return
    }
    delete (global as typeof globalThis & { fetch?: typeof fetch }).fetch
  })

  it('refreshes the router and dispatches sidebar refresh on successful locale update', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(null, { status: 200 }),
    ) as typeof fetch

    renderWithProviders(<LanguageSwitcher />, { dict: {}, locale: 'en' })

    fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'pl' } })

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/auth/locale',
        expect.objectContaining({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ locale: 'pl' }),
        }),
      )
    })
    await waitFor(() => {
      expect(mockRefresh).toHaveBeenCalledTimes(1)
    })
    expect(dispatchEventSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'om:refresh-sidebar' }))
  })

  it('does not refresh the router when locale update returns non-ok', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'Invalid locale' }), { status: 400, headers: { 'content-type': 'application/json' } }),
    ) as typeof fetch

    renderWithProviders(<LanguageSwitcher />, { dict: {}, locale: 'en' })

    fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'pl' } })

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1)
    })
    expect(mockRefresh).not.toHaveBeenCalled()
    expect(dispatchEventSpy).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'om:refresh-sidebar' }))
  })
})
