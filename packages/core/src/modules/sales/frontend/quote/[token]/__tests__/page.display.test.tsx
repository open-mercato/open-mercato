/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { resolveDateLocaleSettings } from '@open-mercato/shared/lib/date-locale/resolve'
import { DateLocaleSettingsProvider } from '@open-mercato/ui/primitives/date-locale-settings'
import QuotePublicPage from '../page'
import { formatQuoteValidUntil } from '../../../../lib/quoteEmailDates'

const mockApiCallOrThrow = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCallOrThrow: (...args: unknown[]) => mockApiCallOrThrow(...args),
}))
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, params?: { date?: string }) => (params?.date ? `${key}:${params.date}` : key),
  useLocale: () => 'en',
}))

const quoteResponse = (display?: { timeZone: string | null; locale: string | null }) => ({
  quote: {
    quoteNumber: 'Q-1',
    currencyCode: 'USD',
    validFrom: null,
    validUntil: '2026-07-01T20:00:00.000Z',
    status: 'sent',
    subtotalNetAmount: '0',
    subtotalGrossAmount: '0',
    discountTotalAmount: '0',
    taxTotalAmount: '0',
    grandTotalNetAmount: '0',
    grandTotalGrossAmount: '0',
  },
  lines: [],
  isExpired: false,
  ...(display ? { display } : {}),
})

// The viewer's own provider says Los Angeles (still July 1st) with a pinned `yyyy-MM-dd`; the
// quote's tenant says Tokyo (already July 2nd). The page names the day the quote email named, in
// the email's long format, never in the viewer's own pattern.
const viewerSettings = resolveDateLocaleSettings({
  tenant: { timeZone: 'America/Los_Angeles', dateFormat: 'yyyy-MM-dd' },
  env: {},
})

function renderPage() {
  return render(
    <DateLocaleSettingsProvider value={viewerSettings}>
      <QuotePublicPage params={{ token: 'token-1' }} />
    </DateLocaleSettingsProvider>,
  )
}

describe('public quote page validity date', () => {
  beforeEach(() => mockApiCallOrThrow.mockReset())

  it('names the validity day in the time zone returned with the quote, as the email does', async () => {
    mockApiCallOrThrow.mockResolvedValue({ result: quoteResponse({ timeZone: 'Asia/Tokyo', locale: null }) })
    renderPage()
    const expected = formatQuoteValidUntil(new Date('2026-07-01T20:00:00.000Z'), 'en', { timeZone: 'Asia/Tokyo', locale: null })
    expect(expected).toBe('July 2, 2026')
    expect(await screen.findByText(`sales.quotes.public.validUntil:${expected}`)).toBeTruthy()
  })

  it('uses the tenant formatting locale returned with the quote', async () => {
    mockApiCallOrThrow.mockResolvedValue({ result: quoteResponse({ timeZone: 'Asia/Tokyo', locale: 'en-GB' }) })
    renderPage()
    expect(await screen.findByText('sales.quotes.public.validUntil:2 July 2026')).toBeTruthy()
  })

  it('falls back to the surrounding zone when the response has no display block', async () => {
    mockApiCallOrThrow.mockResolvedValue({ result: quoteResponse() })
    renderPage()
    expect(await screen.findByText('sales.quotes.public.validUntil:July 1, 2026')).toBeTruthy()
  })
})
