/**
 * @jest-environment node
 */

import * as React from 'react'
import { renderToString } from 'react-dom/server'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { readDateLocaleEnv, resolveDateLocaleSettings } from '@open-mercato/shared/lib/date-locale/resolve'
import { DateLocaleSettingsProvider } from '@open-mercato/ui/primitives/date-locale-settings'
import { CalendarToolbar } from '../CalendarToolbar'
import type { CalendarToolbarProps } from '../types'

function baseProps(): CalendarToolbarProps {
  const anchor = new Date(2026, 5, 15)
  return {
    view: 'week',
    anchor,
    range: { from: anchor, to: new Date(2026, 5, 21) },
    preset: null,
    search: '',
    filters: { types: [], status: null, ownerUserId: null },
    typeOptions: [],
    ownerOptions: [],
    onToday: () => {},
    onPresetChange: () => {},
    onAnchorChange: () => {},
    onSearchChange: () => {},
    onFiltersChange: () => {},
    onOpenSettings: () => {},
  }
}

function renderWithSettings(node: React.ReactNode): string {
  const settings = resolveDateLocaleSettings({
    tenant: { locale: 'pl-PL', dateFormat: 'd MMMM yyyy' },
    env: readDateLocaleEnv({}),
  })
  return renderToString(
    <I18nProvider locale="en" dict={{}}>
      <DateLocaleSettingsProvider value={settings}>{node}</DateLocaleSettingsProvider>
    </I18nProvider>,
  )
}

describe('CalendarToolbar server render', () => {
  it('formats the range label with the provider date pattern and formatting locale', () => {
    const html = renderWithSettings(<CalendarToolbar {...baseProps()} />)
    expect(html).toContain('15 czerwca 2026 – 21 czerwca 2026')
  })
})
