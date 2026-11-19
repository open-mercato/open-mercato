import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ResolvedDateLocaleSettings } from '@open-mercato/shared/lib/date-locale/types'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { formatDisplayDateTime } from '@open-mercato/ui/primitives/date-format'
import { DateLocaleSettingsProvider } from '@open-mercato/ui/primitives/date-locale-settings'
import { TriggerEditor } from '../backend/processes/definitions/TriggerEditor'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => (key: string) => key }))
jest.mock('@open-mercato/scheduler/modules/scheduler/lib/cronParser', () => ({
  validateCronExpression: () => ({ ok: true, nextRuns: [new Date('2026-07-02T02:05:00Z')] }),
}), { virtual: true })
jest.mock('../data/validators', () => ({
  PROCESS_TRIGGERS_MAX: 10,
  isValidIanaTimeZone: () => true,
}))
jest.mock('../backend/processes/definitions/formHelpers', () => ({ listTimeZones: () => ['UTC'] }))
jest.mock('lucide-react', () => ({
  CalendarClock: () => null,
  Hand: () => null,
  Plus: () => null,
  Radio: () => null,
  Trash2: () => null,
  TriangleAlert: () => null,
}), { virtual: true })
jest.mock('@open-mercato/ui/primitives/button', () => ({ Button: () => null }))
jest.mock('@open-mercato/ui/primitives/icon-button', () => ({ IconButton: () => null }))
jest.mock('@open-mercato/ui/primitives/input', () => ({ Input: () => null }))
jest.mock('@open-mercato/ui/primitives/switch', () => ({ Switch: () => null }))
jest.mock('@open-mercato/ui/primitives/textarea', () => ({ Textarea: () => null }))

const settings: ResolvedDateLocaleSettings = {
  locale: 'en-GB',
  dateFormat: 'dd/MM/yyyy',
  dateTimeFormat: 'dd/MM/yyyy HH:mm',
  timeFormat: 'HH:mm',
  timeZone: 'America/Los_Angeles',
  firstDayOfWeek: 1,
  sources: {
    locale: 'tenant', dateFormat: 'tenant', dateTimeFormat: 'tenant',
    timeFormat: 'tenant', timeZone: 'tenant', firstDayOfWeek: 'tenant',
  },
}

function Preview() {
  const t = useT()
  return <TriggerEditor value={[{ kind: 'schedule', cron: '5 2 * * *', timezone: 'UTC', enabled: true }]} onChange={() => {}} locale="en" t={t} />
}

describe('cron preview server rendering', () => {
  it('uses provider settings on the initial render when environment defaults differ', () => {
    const previousFormat = process.env.NEXT_PUBLIC_OM_DATE_TIME_FORMAT
    process.env.NEXT_PUBLIC_OM_DATE_TIME_FORMAT = 'yyyy-MM-dd HH:mm'
    try {
      const environmentDisplay = formatDisplayDateTime('2026-07-02T02:05:00Z', 'en')
      expect(environmentDisplay).toMatch(/^2026-07-0[12] /)
      const html = renderToStaticMarkup(<DateLocaleSettingsProvider value={settings}><Preview /></DateLocaleSettingsProvider>)
      expect(html).toContain('01/07/2026 19:05')
      expect(html).not.toContain(environmentDisplay)
    } finally {
      if (previousFormat === undefined) delete process.env.NEXT_PUBLIC_OM_DATE_TIME_FORMAT
      else process.env.NEXT_PUBLIC_OM_DATE_TIME_FORMAT = previousFormat
    }
  })
})
