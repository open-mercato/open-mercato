/** @jest-environment jsdom */
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { resolveDateLocaleSettings } from '@open-mercato/shared/lib/date-locale'
import { DateLocaleSettingsProvider } from '@open-mercato/ui/primitives/date-locale-settings'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { EntitlementLookupBadge } from '../backend/components/EntitlementLookupBadge'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
}))

it('keeps a UTC-midnight warranty expiry on July 1 in Los Angeles', async () => {
  jest.mocked(apiCall).mockResolvedValue({
    ok: true,
    status: 200,
    result: { warrantyStatus: 'in_warranty', expiresAt: '2026-07-01T00:00:00Z' },
  } as Awaited<ReturnType<typeof apiCall>>)

  renderWithProviders(
    <DateLocaleSettingsProvider value={resolveDateLocaleSettings({
      tenant: { timeZone: 'America/Los_Angeles', dateFormat: 'yyyy-MM-dd' },
    })}>
      <EntitlementLookupBadge claim={{ orderId: 'order-1' }} lines={[]} />
    </DateLocaleSettingsProvider>,
  )

  expect(await screen.findByText('Expires 2026-07-01')).toBeInTheDocument()
})
