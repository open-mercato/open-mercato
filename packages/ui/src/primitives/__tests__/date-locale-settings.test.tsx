import * as React from 'react'
import { render } from '@testing-library/react'
import { resolveDateLocaleSettings } from '@open-mercato/shared/lib/date-locale/resolve'
import { formatDisplayDate } from '../date-format'
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

  // Regression: the root provider re-renders on every navigation (AppProviders reads the
  // pathname) while the backend layout's provider is a cached subtree that does not. The plain
  // helpers must keep using the nested settings rather than the root's anonymous defaults.
  it('keeps the nested settings after only the root provider re-renders on navigation', () => {
    const noEnv = { locale: null, dateFormat: null, dateTimeFormat: null, timeFormat: null, timeZone: null, firstDayOfWeek: null }
    const anonymous = resolveDateLocaleSettings({ env: noEnv })
    const signedIn = resolveDateLocaleSettings({ env: noEnv, tenant: { dateFormat: 'dd.MM.yyyy', timeZone: 'Asia/Tokyo' } })
    const NestedBackend = React.memo(function NestedBackend() {
      return (
        <DateLocaleSettingsProvider value={signedIn}>
          <span>backend</span>
        </DateLocaleSettingsProvider>
      )
    })
    function Root({ pathname }: { pathname: string }) {
      return (
        <DateLocaleSettingsProvider value={anonymous}>
          <span data-path={pathname} />
          <NestedBackend />
        </DateLocaleSettingsProvider>
      )
    }

    const view = render(<Root pathname="/backend" />)
    expect(getActiveDateLocaleSettings().dateFormat).toBe('dd.MM.yyyy')
    view.rerender(<Root pathname="/backend/customers" />)
    expect(formatDisplayDate('2026-07-01')).toBe('01.07.2026')
    expect(getActiveDateLocaleSettings().timeZone).toBe('Asia/Tokyo')
  })

  it('ignores a nested provider whose render React discarded', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    function Throws(): React.ReactElement {
      throw new Error('[internal] render discarded')
    }
    class Boundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
      state = { failed: false }
      static getDerivedStateFromError() {
        return { failed: true }
      }
      render() {
        return this.state.failed ? null : this.props.children
      }
    }
    try {
      render(
        <DateLocaleSettingsProvider value={rootSettings}>
          <Boundary>
            <DateLocaleSettingsProvider value={tenantSettings}>
              <Throws />
            </DateLocaleSettingsProvider>
          </Boundary>
        </DateLocaleSettingsProvider>,
      )
    } finally {
      errorSpy.mockRestore()
    }
    // The tenant provider rendered (and noted itself) but never mounted, so the root decides.
    expect(getActiveDateLocaleSettings().timeZone).toBe('UTC')
  })

  it('applies a nested provider value change after a refresh', () => {
    const { rerender } = render(
      <DateLocaleSettingsProvider value={rootSettings}>
        <DateLocaleSettingsProvider value={tenantSettings}>
          <ZoneProbe />
        </DateLocaleSettingsProvider>
      </DateLocaleSettingsProvider>,
    )
    const updated = resolveDateLocaleSettings({ tenant: { timeZone: 'Europe/Warsaw' } })
    rerender(
      <DateLocaleSettingsProvider value={rootSettings}>
        <DateLocaleSettingsProvider value={updated}>
          <ZoneProbe />
        </DateLocaleSettingsProvider>
      </DateLocaleSettingsProvider>,
    )
    expect(getActiveDateLocaleSettings().timeZone).toBe('Europe/Warsaw')
  })
})
