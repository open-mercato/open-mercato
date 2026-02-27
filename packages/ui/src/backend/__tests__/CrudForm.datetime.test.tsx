jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {} }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))
jest.mock('remark-gfm', () => ({ __esModule: true, default: {} }))
jest.mock('@uiw/react-md-editor', () => ({ __esModule: true, default: () => null }))

import * as React from 'react'
import { renderToString } from 'react-dom/server'
import { CrudForm, type CrudField } from '../CrudForm'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'

function renderForm(
  fields: CrudField[],
  initialValues?: Record<string, unknown>,
): string {
  return renderToString(
    React.createElement(
      I18nProvider as React.ComponentType<{
        locale: string
        dict: Record<string, string>
        children: React.ReactNode
      }>,
      { locale: 'en', dict: {} },
      React.createElement(CrudForm as React.ComponentType<{
        title: string
        fields: CrudField[]
        initialValues?: Record<string, unknown>
        onSubmit: () => void
      }>, {
        title: 'Form',
        fields,
        initialValues,
        onSubmit: () => {},
      })
    )
  )
}

describe('CrudForm — datetime field types render correct picker component', () => {
  it('type: datepicker renders DatePicker trigger (aria-haspopup + date placeholder)', () => {
    const fields: CrudField[] = [{ id: 'due_date', label: 'Due Date', type: 'datepicker' }]
    const html = renderForm(fields)
    expect(html).toContain('aria-haspopup="dialog"')
    expect(html).toContain('Pick a date')
  })

  it('type: datetime renders DateTimePicker trigger (aria-haspopup + datetime placeholder)', () => {
    const fields: CrudField[] = [{ id: 'occurred_at', label: 'Occurred At', type: 'datetime' }]
    const html = renderForm(fields)
    expect(html).toContain('aria-haspopup="dialog"')
    expect(html).toContain('Pick date and time')
  })

  it('type: time renders TimePicker trigger (aria-haspopup + time placeholder)', () => {
    const fields: CrudField[] = [{ id: 'sync_time', label: 'Sync Time', type: 'time' }]
    const html = renderForm(fields)
    expect(html).toContain('aria-haspopup="dialog"')
    expect(html).toContain('Pick a time')
  })

  it('type: datetime-local renders raw <input> (backward compatibility)', () => {
    const fields: CrudField[] = [{ id: 'at', label: 'At', type: 'datetime-local' }]
    const html = renderForm(fields)
    expect(html).toContain('type="datetime-local"')
    expect(html).not.toContain('Pick date and time')
  })

  it('type: date renders raw <input type="date"> (backward compatibility)', () => {
    const fields: CrudField[] = [{ id: 'dt', label: 'Date', type: 'date' }]
    const html = renderForm(fields)
    expect(html).toContain('type="date"')
  })

  it('datepicker shows formatted date in trigger when initialValues provided', () => {
    const fields: CrudField[] = [{ id: 'due_date', label: 'Due Date', type: 'datepicker' }]
    const html = renderForm(fields, { due_date: '2026-02-22' })
    // parseISO('2026-02-22') = local midnight Feb 22; default format contains year
    expect(html).toContain('2026')
  })

  it('datetime shows formatted datetime in trigger when initialValues provided', () => {
    const fields: CrudField[] = [{ id: 'occurred_at', label: 'Occurred At', type: 'datetime' }]
    // UTC ISO string → local Date; default format contains year
    const html = renderForm(fields, { occurred_at: '2026-02-22T12:00:00.000Z' })
    expect(html).toContain('2026')
  })

  it('time shows HH:MM in trigger when initialValues provided', () => {
    const fields: CrudField[] = [{ id: 'sync_time', label: 'Sync Time', type: 'time' }]
    const html = renderForm(fields, { sync_time: '14:30' })
    expect(html).toContain('14:30')
  })
})
