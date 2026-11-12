/** @jest-environment jsdom */
import * as React from 'react'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import DateLocaleSettingsPage from '../page'

let grantedFeatures = ['configs.date_locale.view']

jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: jest.fn() }),
  usePathname: () => '/backend/config/date-locale',
  useSearchParams: () => new URLSearchParams(),
}))
jest.mock('@open-mercato/ui/backend/BackendChromeProvider', () => ({
  useBackendChrome: () => ({ payload: { grantedFeatures } }),
}))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  ...jest.requireActual('@open-mercato/ui/backend/utils/apiCall'),
  readApiResultOrThrow: jest.fn(),
}))

const payload = {
  settings: { locale: null, dateFormat: null, dateTimeFormat: null, timeFormat: null, timeZone: null, firstDayOfWeek: null },
  envDefaults: {},
  updatedAt: null,
}

describe('Date locale settings page permissions and errors', () => {
  beforeEach(() => {
    grantedFeatures = ['configs.date_locale.view']
    jest.mocked(readApiResultOrThrow).mockReset().mockResolvedValue(payload)
  })

  it('does not expose a save action to a view-only user', async () => {
    renderWithProviders(<DateLocaleSettingsPage />)
    await screen.findByText('You can view these settings but not change them.')
    expect(screen.queryByRole('button', { name: /Save settings/ })).not.toBeInTheDocument()
    expect(screen.getByTestId('date-locale-preview').closest('[aria-disabled="true"]')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Date & time' })).toBeVisible()
  })

  it('keeps the save action available to managers', async () => {
    grantedFeatures = ['configs.date_locale.view', 'configs.date_locale.manage']
    renderWithProviders(<DateLocaleSettingsPage />)
    expect((await screen.findAllByRole('button', { name: /Save settings/ })).length).toBeGreaterThan(0)
  })

  it('translates transport failures instead of showing browser error text', async () => {
    jest.mocked(readApiResultOrThrow).mockRejectedValue(new TypeError('Failed to fetch'))
    renderWithProviders(<DateLocaleSettingsPage />, {
      locale: 'pl',
      dict: { 'configs.dateLocale.errors.load': 'Nie udało się załadować ustawień daty i czasu.' },
    })
    expect(await screen.findByText('Nie udało się załadować ustawień daty i czasu.')).toBeInTheDocument()
    expect(screen.queryByText('Failed to fetch')).not.toBeInTheDocument()
  })
})
