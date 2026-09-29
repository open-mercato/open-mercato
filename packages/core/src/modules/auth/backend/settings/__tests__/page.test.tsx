/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'

const routerReplaceMock = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: routerReplaceMock }),
}))

import SettingsPage from '../page'

describe('SettingsPage', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders the settings landing page without redirecting to a feature-gated section', () => {
    const { getByRole, getByText } = renderWithProviders(<SettingsPage />)

    expect(getByRole('heading', { name: 'Settings' })).toBeTruthy()
    expect(getByText('System configuration and administration')).toBeTruthy()
    expect(getByText('Select an item from the menu to configure system settings.')).toBeTruthy()
    expect(routerReplaceMock).not.toHaveBeenCalled()
  })
})
