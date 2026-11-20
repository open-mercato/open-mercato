/** @jest-environment jsdom */

import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { updateCrud } from '@open-mercato/ui/backend/utils/crud'
import EditExchangeRatePage from '../[id]/page'

const mockPush = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => '/backend/exchange-rates/rate-1',
  useSearchParams: () => new URLSearchParams(),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  ...jest.requireActual<typeof import('@open-mercato/ui/backend/utils/apiCall')>('@open-mercato/ui/backend/utils/apiCall'),
  apiCall: jest.fn(),
}))
jest.mock('@open-mercato/ui/backend/utils/crud', () => ({ updateCrud: jest.fn() }))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('@open-mercato/ui/backend/injection/InjectionSpot', () => ({
  InjectionSpot: () => null,
  useInjectionWidgets: () => ({ widgets: [], loading: false, error: null }),
  useInjectionSpotEvents: () => ({ triggerEvent: async () => ({ ok: true }) }),
}))
jest.mock('@open-mercato/ui/backend/injection/useInjectionDataWidgets', () => ({
  useInjectionDataWidgets: () => ({ widgets: [], isLoading: false, error: null }),
}))

const savedRate = {
  id: 'rate-1',
  fromCurrencyCode: 'USD',
  toCurrencyCode: 'PLN',
  rate: '3.9876543219',
  date: '2026-11-19T00:00:00.000Z',
  source: 'REL test',
  type: 'buy',
  isActive: true,
  metadata: { tableNo: '223/C/NBP/2026' },
  updatedAt: '2026-11-19T10:30:00.000Z',
  organizationId: 'org-1',
  tenantId: 'tenant-1',
}

const dict = {
  'exchangeRates.form.field.fromCurrency': 'From Currency',
  'exchangeRates.form.field.toCurrency': 'To Currency',
  'exchangeRates.form.field.rate': 'Exchange Rate',
  'exchangeRates.form.action.save': 'Save',
}

describe('saved exchange rate editing', () => {
  const originalTZ = process.env.TZ

  afterEach(() => {
    process.env.TZ = originalTZ
  })

  beforeEach(() => {
    process.env.TZ = 'America/Los_Angeles'
    jest.clearAllMocks()
    jest.mocked(apiCall).mockImplementation(async (input) => ({
      ok: true,
      status: 200,
      result: {
        items: String(input).startsWith('/api/currencies/exchange-rates?')
          ? [savedRate]
          : ['USD', 'PLN', 'EUR'].map((code) => ({ id: code, code, name: code, isActive: true })),
      },
      response: new Response(),
    }) as Awaited<ReturnType<typeof apiCall>>)
    jest.mocked(updateCrud).mockResolvedValue({ ok: true } as Awaited<ReturnType<typeof updateCrud>>)
  })

  it.each([false, true])('populates both currencies and preserves saved values on submit (change currency: %s)', async (changeCurrency) => {
    renderWithProviders(<EditExchangeRatePage params={{ id: savedRate.id }} />, { dict })

    const fromCurrency = await screen.findByRole('combobox', { name: /^From Currency/ })
    await waitFor(() => expect(fromCurrency).toHaveValue('USD'))
    expect(screen.getByRole('combobox', { name: /^To Currency/ })).toHaveValue('PLN')
    expect(screen.getByRole('textbox', { name: 'Exchange Rate' })).toHaveValue(savedRate.rate)

    if (changeCurrency) {
      fireEvent.change(fromCurrency, { target: { value: 'EUR' } })
      fireEvent.keyDown(fromCurrency, { key: 'ArrowDown' })
      fireEvent.keyDown(fromCurrency, { key: 'Enter' })
    }

    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0])

    await waitFor(() => expect(updateCrud).toHaveBeenCalledWith('currencies/exchange-rates', {
      id: savedRate.id,
      fromCurrencyCode: changeCurrency ? 'EUR' : 'USD',
      toCurrencyCode: 'PLN',
      rate: savedRate.rate,
      date: savedRate.date,
      source: savedRate.source,
      type: savedRate.type,
      isActive: savedRate.isActive,
    }))
    expect(mockPush).toHaveBeenCalledWith('/backend/exchange-rates')
  })
})
