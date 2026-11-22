/** @jest-environment jsdom */
import * as React from 'react'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { updateCrud } from '@open-mercato/ui/backend/utils/crud'
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

jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  ...jest.requireActual('@open-mercato/ui/backend/utils/crud'),
  updateCrud: jest.fn(),
}))

const payload = {
  settings: { locale: null, dateFormat: null, dateTimeFormat: null, timeFormat: null, timeZone: null, firstDayOfWeek: null },
  envDefaults: {},
  updatedAt: null,
}

describe('Date locale settings page permissions and errors', () => {
  const scrollIntoView = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView')

  beforeAll(() => {
    Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: jest.fn() })
  })

  afterAll(() => {
    if (scrollIntoView) Object.defineProperty(Element.prototype, 'scrollIntoView', scrollIntoView)
    else Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
  })

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

  it.each([
    ['Formatting locale', 'locale', 'de-DE'],
    ['First day of the week', 'firstDayOfWeek', 0],
    ['Date format', 'dateFormat', 'dd.MM.yyyy'],
    ['Date and time format', 'dateTimeFormat', 'dd.MM.yyyy HH:mm'],
    ['Time format', 'timeFormat', 'HH:mm'],
  ])('only offers Automatic to reset %s and saves null', async (label, field, value) => {
    grantedFeatures = ['configs.date_locale.view', 'configs.date_locale.manage']
    jest.mocked(readApiResultOrThrow).mockResolvedValue({
      ...payload,
      settings: { ...payload.settings, [field]: value },
    })
    jest.mocked(updateCrud).mockClear()
    renderWithProviders(<DateLocaleSettingsPage />)

    const trigger = await screen.findByRole('combobox', { name: (name) => name.replace(/ \*$/, '') === label })
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    const options = within(await screen.findByRole('listbox'))
    expect(options.queryByText(/Clear/)).not.toBeInTheDocument()
    fireEvent.keyDown(options.getByRole('option', { name: 'Automatic' }), { key: 'Enter' })

    fireEvent.click(screen.getAllByRole('button', { name: /Save settings/ })[0])
    await waitFor(() => expect(updateCrud).toHaveBeenCalledWith(
      'configs/date-locale',
      expect.objectContaining({ [field]: null }),
      expect.any(Object),
    ))
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
