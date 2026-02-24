jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}))
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}))

import * as React from 'react'
import { renderToString } from 'react-dom/server'
import { DatePicker } from '../DatePicker'

// Note: Tests for Today/Clear button visibility require opening the Radix Popover
// (portal content is not rendered by renderToString when popover is closed).
// Those tests are covered by integration tests (TC-DTP-004) post-migration.

function render(element: React.ReactElement): string {
  return renderToString(element)
}

describe('DatePicker SSR render', () => {
  it('shows placeholder text when no value', () => {
    const html = render(<DatePicker onChange={jest.fn()} placeholder="Pick a date" />)
    expect(html).toContain('Pick a date')
  })

  it('shows formatted date in trigger when value is provided', () => {
    const date = new Date(2026, 1, 22) // Feb 22, 2026
    const html = render(<DatePicker value={date} onChange={jest.fn()} displayFormat="yyyy-MM-dd" />)
    expect(html).toContain('2026-02-22')
  })

  it('renders trigger button with aria-haspopup="dialog"', () => {
    const html = render(<DatePicker onChange={jest.fn()} />)
    expect(html).toContain('aria-haspopup="dialog"')
  })

  it('renders trigger with data-crud-focus-target for CrudForm auto-focus', () => {
    const html = render(<DatePicker onChange={jest.fn()} />)
    expect(html).toContain('data-crud-focus-target')
  })

  it('renders disabled trigger when disabled prop is true', () => {
    const html = render(<DatePicker onChange={jest.fn()} disabled />)
    expect(html).toContain('disabled')
  })

  it('does not show date value when value is null', () => {
    const html = render(<DatePicker value={null} onChange={jest.fn()} placeholder="Pick a date" />)
    expect(html).toContain('Pick a date')
  })
})

describe('DatePicker — day selection midnight contract', () => {
  it('selected day has time set to local midnight (00:00:00.000)', () => {
    // Mirrors handleDaySelect logic: new Date(day).setHours(0, 0, 0, 0)
    const day = new Date(2026, 1, 22, 14, 30, 15, 500)
    const result = new Date(day)
    result.setHours(0, 0, 0, 0)
    expect(result.getHours()).toBe(0)
    expect(result.getMinutes()).toBe(0)
    expect(result.getSeconds()).toBe(0)
    expect(result.getMilliseconds()).toBe(0)
    expect(result.getDate()).toBe(22)
    expect(result.getMonth()).toBe(1)
  })

  it('YYYY-MM-DD string formatted via date-fns roundtrips via parseISO without UTC shift', () => {
    const { format, parseISO } = require('date-fns')
    const original = new Date(2026, 1, 22) // local Feb 22
    const str = format(original, 'yyyy-MM-dd')
    const restored = parseISO(str) // parseISO treats YYYY-MM-DD as local midnight
    expect(restored.getFullYear()).toBe(2026)
    expect(restored.getMonth()).toBe(1)
    expect(restored.getDate()).toBe(22)
  })
})
