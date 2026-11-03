import * as React from 'react'
import { render } from '@testing-library/react'
import { resolveDateLocaleSettings } from '@open-mercato/shared/lib/date-locale/resolve'
import { DateLocaleSettingsProvider, useDateLocaleSettings } from '../date-locale-settings'
import { getActiveDateLocaleSettings, setClientDateLocaleSettings } from '../date-locale-store'

const rootSettings = resolveDateLocaleSettings({ env: { timeZone: 'UTC' } })
const tenantSettings = resolveDateLocaleSettings({ tenant: { timeZone: 'Asia/Tokyo', dateFormat: 'dd.MM.yyyy' } })

function ZoneProbe() {
  return <span data-testid="zone">{useDateLocaleSettings().timeZone}</span>
}

afterEach(() => setClientDateLocaleSettings(null))

describe('DateLocaleSettingsProvider', () => {
  it('lets a nested provider (backend/portal layout) override the root one for context and store', () => {
    const { getByTestId } = render(
      <DateLocaleSettingsProvider value={rootSettings}>
        <DateLocaleSettingsProvider value={tenantSettings}>
          <ZoneProbe />
        </DateLocaleSettingsProvider>
      </DateLocaleSettingsProvider>,
    )
    expect(getByTestId('zone').textContent).toBe('Asia/Tokyo')
    expect(getActiveDateLocaleSettings().timeZone).toBe('Asia/Tokyo')
  })

  it('picks up new settings when the nested provider re-renders after a login navigation', () => {
    const { getByTestId, rerender } = render(
      <DateLocaleSettingsProvider value={rootSettings}>
        <ZoneProbe />
      </DateLocaleSettingsProvider>,
    )
    expect(getActiveDateLocaleSettings().timeZone).toBe('UTC')
    rerender(
      <DateLocaleSettingsProvider value={rootSettings}>
        <DateLocaleSettingsProvider value={tenantSettings}>
          <ZoneProbe />
        </DateLocaleSettingsProvider>
      </DateLocaleSettingsProvider>,
    )
    expect(getByTestId('zone').textContent).toBe('Asia/Tokyo')
    expect(getActiveDateLocaleSettings().timeZone).toBe('Asia/Tokyo')
  })

  it('restores the root settings in the store when the nested provider unmounts (logout)', () => {
    const { rerender } = render(
      <DateLocaleSettingsProvider value={rootSettings}>
        <DateLocaleSettingsProvider value={tenantSettings}>
          <ZoneProbe />
        </DateLocaleSettingsProvider>
      </DateLocaleSettingsProvider>,
    )
    rerender(
      <DateLocaleSettingsProvider value={rootSettings}>
        <ZoneProbe />
      </DateLocaleSettingsProvider>,
    )
    expect(getActiveDateLocaleSettings().timeZone).toBe('UTC')
  })
})
