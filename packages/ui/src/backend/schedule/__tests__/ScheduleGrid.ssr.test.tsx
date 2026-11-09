/**
 * @jest-environment node
 */

import * as React from 'react'
import { renderToString } from 'react-dom/server'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { readDateLocaleEnv, resolveDateLocaleSettings } from '@open-mercato/shared/lib/date-locale/resolve'
import { DateLocaleSettingsProvider } from '../../../primitives/date-locale-settings'
import { ScheduleGrid } from '../ScheduleGrid'
import { ScheduleAgenda } from '../ScheduleAgenda'
import type { ScheduleItem, ScheduleRange } from '../types'

const item: ScheduleItem = {
  id: 'item-1',
  kind: 'event',
  title: 'Planning',
  startsAt: new Date('2026-05-20T12:00:00.000Z'),
  endsAt: new Date('2026-05-20T13:30:00.000Z'),
}

const range: ScheduleRange = {
  start: new Date('2026-05-20T00:00:00.000Z'),
  end: new Date('2026-05-20T23:59:59.000Z'),
}

function renderWithSettings(node: React.ReactNode): string {
  const settings = resolveDateLocaleSettings({
    tenant: { locale: 'en-US', timeFormat: 'h:mm a' },
    env: readDateLocaleEnv({}),
  })
  return renderToString(
    <I18nProvider locale="de" dict={{}}>
      <DateLocaleSettingsProvider value={settings}>{node}</DateLocaleSettingsProvider>
    </I18nProvider>,
  )
}

describe('schedule views server render', () => {
  it('ScheduleGrid formats time ranges with the provider time pattern and the explicit timezone', () => {
    const html = renderWithSettings(<ScheduleGrid items={[item]} range={range} timezone="UTC" />)
    expect(html).toContain('12:00 PM–1:30 PM')
  })

  it('ScheduleAgenda formats time ranges with the provider time pattern and the explicit timezone', () => {
    const html = renderWithSettings(<ScheduleAgenda items={[item]} range={range} timezone="UTC" />)
    expect(html).toContain('12:00 PM–1:30 PM')
  })
})
