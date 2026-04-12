/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { ProfileDropdown } from '../ProfileDropdown'
import { flash } from '../FlashMessages'
import { apiCall } from '../utils/apiCall'

jest.mock('next/link', () => {
  const React = require('react')
  return React.forwardRef(
    (
      { children, href, ...rest }: { children: React.ReactNode; href?: string },
      ref: React.ForwardedRef<HTMLAnchorElement>,
    ) => (
      <a href={typeof href === 'string' ? href : href?.toString?.()} ref={ref} {...rest}>
        {children}
      </a>
    ),
  )
})

jest.mock('../FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('../utils/apiCall', () => ({
  apiCall: jest.fn(),
}))

jest.mock('../injection/useInjectedMenuItems', () => ({
  useInjectedMenuItems: () => ({ items: [] }),
}))

jest.mock('../injection/InjectionSpot', () => ({
  InjectionSpot: () => null,
}))

describe('ProfileDropdown', () => {
  const mockApiCall = apiCall as jest.MockedFunction<typeof apiCall>
  const mockFlash = flash as jest.MockedFunction<typeof flash>
  const mockReload = window.location.reload as jest.Mock

  beforeEach(() => {
    mockApiCall.mockReset()
    mockFlash.mockReset()
    mockReload.mockClear()
  })

  async function openLanguageMenu() {
    renderWithProviders(<ProfileDropdown email="demo@example.com" />, { dict: {} })

    fireEvent.click(screen.getByTestId('profile-dropdown-trigger'))
    fireEvent.click(screen.getByRole('button', { name: /language/i }))

    await screen.findByRole('button', { name: 'Polski' })
  }

  it('reloads the page only after a successful locale change response', async () => {
    mockApiCall.mockResolvedValue({
      ok: true,
      status: 200,
      result: null,
      response: new Response(null, { status: 200 }),
      cacheStatus: null,
    })

    await openLanguageMenu()
    fireEvent.click(screen.getByRole('button', { name: 'Polski' }))

    await waitFor(() => {
      expect(mockApiCall).toHaveBeenCalledWith(
        '/api/auth/locale',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ locale: 'pl' }),
        }),
      )
    })

    await waitFor(() => {
      expect(mockReload).toHaveBeenCalledTimes(1)
    })
    expect(mockFlash).not.toHaveBeenCalled()
  })

  it('shows an error and skips reload when locale change returns a non-ok response', async () => {
    mockApiCall.mockResolvedValue({
      ok: false,
      status: 500,
      result: null,
      response: new Response(null, { status: 500 }),
      cacheStatus: null,
    })

    await openLanguageMenu()
    fireEvent.click(screen.getByRole('button', { name: 'Polski' }))

    await waitFor(() => {
      expect(mockReload).not.toHaveBeenCalled()
    })
    expect(mockFlash).toHaveBeenCalledWith(
      'Unable to change language. Please try again.',
      'error',
    )
  })
})
