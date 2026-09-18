import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { ScheduleToolbar } from '../ScheduleToolbar'
import { getScheduleLocale } from '../localization'
import type { ScheduleRange, ScheduleViewMode } from '../types'

const selectedRange = { start: new Date(2026, 5, 8), end: new Date(2026, 5, 14, 23, 59, 59) }

function renderToolbar(view: ScheduleViewMode = 'week', range: ScheduleRange = selectedRange) {
  const onRangeChange = jest.fn()
  const onViewChange = jest.fn()
  render(
    <I18nProvider locale="pl" dict={{}}>
      <ScheduleToolbar view={view} range={range} onRangeChange={onRangeChange} onViewChange={onViewChange} />
    </I18nProvider>,
  )
  return { onRangeChange, onViewChange }
}

describe('ScheduleToolbar locale and navigation', () => {
  it('shows the Polish date range once', () => {
    renderToolbar()
    const datePicker = screen.getByRole('button', { name: 'Date range' })
    expect(datePicker.textContent).toContain('cze')
    expect(datePicker.textContent).toContain('2026')
    expect(screen.getAllByText(/cze/)).toHaveLength(1)
    expect(screen.queryByText(/Jun/)).not.toBeInTheDocument()
  })

  it('keeps the selected date when switching from week to day', () => {
    const { onViewChange, onRangeChange } = renderToolbar()
    fireEvent.click(screen.getByRole('radio', { name: 'Day' }))
    expect(onViewChange).toHaveBeenCalledWith('day')
    expect(onRangeChange).toHaveBeenCalledWith({
      start: new Date(2026, 5, 8), end: new Date(2026, 5, 8, 23, 59, 59, 999),
    })
  })

  it('uses Monday as the first day of a Polish week when changing views', () => {
    const { onRangeChange } = renderToolbar('day', {
      start: new Date(2026, 5, 10), end: new Date(2026, 5, 10, 23, 59, 59),
    })
    fireEvent.click(screen.getByRole('radio', { name: 'Week' }))
    expect(onRangeChange).toHaveBeenCalledWith({
      start: new Date(2026, 5, 8), end: new Date(2026, 5, 14, 23, 59, 59, 999),
    })
  })

  it('keeps Monday boundaries when navigating to the next week', () => {
    const { onRangeChange } = renderToolbar()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(onRangeChange).toHaveBeenCalledWith({
      start: new Date(2026, 5, 15), end: new Date(2026, 5, 21, 23, 59, 59, 999),
    })
  })

  it.each(['en', 'pl', 'de', 'es', 'ko'])('resolves %s regional language codes', (locale) => {
    expect(getScheduleLocale(`${locale}-XX`)).toBe(getScheduleLocale(locale))
  })

  it('falls back to English for unsupported languages', () => {
    expect(getScheduleLocale('xx')).toBe(getScheduleLocale('en'))
  })
})
