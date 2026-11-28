/** @jest-environment jsdom */
import * as React from 'react'
import { fireEvent, screen, within } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import german from '../../../i18n/de.json'
import spanish from '../../../i18n/es.json'
import korean from '../../../i18n/ko.json'
import { ActivitiesDayStrip } from '../ActivitiesDayStrip'

function renderCalendar(selectedDate = new Date(2026, 10, 3), locale = 'en', dict: Record<string, string> = {}) {
  const onSelectDate = jest.fn()
  renderWithProviders(
    <ActivitiesDayStrip
      entityId="owned-person"
      selectedDate={selectedDate}
      onSelectDate={onSelectDate}
      events={[]}
    />,
    { locale, dict },
  )
  return onSelectDate
}

describe('ActivitiesDayStrip navigation', () => {
  beforeEach(() => {
    HTMLElement.prototype.scrollIntoView = jest.fn()
  })

  it('exposes all five dates inside a named keyboard-focusable group', () => {
    renderCalendar()

    const dates = screen.getByRole('group', { name: 'November 2026' })
    expect(dates).toHaveAttribute('tabindex', '0')
    expect(within(dates).getAllByRole('button')).toHaveLength(5)
    expect(within(dates).getByRole('button', { name: 'SUN 01' })).toBeInTheDocument()
    expect(within(dates).getByRole('button', { name: 'THU 05' })).toBeInTheDocument()
    expect(within(dates).getByRole('button', { name: 'TUE 03' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('selects the local calendar day without changing its callback contract', () => {
    const onSelectDate = renderCalendar()
    fireEvent.click(screen.getByRole('button', { name: 'THU 05' }))
    expect(onSelectDate).toHaveBeenCalledWith(new Date(2026, 10, 5))
  })

  it('reveals a clicked date again after it was already focused and scrolled', () => {
    renderCalendar()
    const date = screen.getByRole('button', { name: 'THU 05' })
    const reveal = jest.fn()
    date.scrollIntoView = reveal
    fireEvent.focus(date)
    reveal.mockClear()

    fireEvent.click(date)

    expect(reveal).toHaveBeenCalledWith({ behavior: 'instant', block: 'nearest', inline: 'nearest' })
  })

  it('keeps window navigation outside the date group and preserves its five-day step', () => {
    const onSelectDate = renderCalendar()
    const dates = screen.getByRole('group', { name: 'November 2026' })
    expect(within(dates).queryByRole('button', { name: 'Next days' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Next days' }))
    expect(within(dates).getByRole('button', { name: 'FRI 06' })).toBeInTheDocument()
    expect(within(dates).getByRole('button', { name: 'TUE 10' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Previous days' }))
    expect(within(dates).getByRole('button', { name: 'SUN 01' })).toBeInTheDocument()
    expect(onSelectDate).not.toHaveBeenCalled()
  })

  it('keeps month controls accessible and updates the date group name', () => {
    renderCalendar()
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }))
    expect(screen.getByRole('group', { name: 'December 2026' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }))
    expect(screen.getByRole('group', { name: 'November 2026' })).toBeInTheDocument()
  })

  it.each([
    { locale: 'de', dict: german, selectedDate: new Date(2026, 2, 3), name: 'März 2026' },
    { locale: 'es', dict: spanish, selectedDate: new Date(2026, 0, 3), name: 'enero de 2026' },
    { locale: 'ko', dict: korean, selectedDate: new Date(2026, 10, 3), name: '2026년 11월' },
  ])('renders the month and year in $locale', ({ locale, dict, selectedDate, name }) => {
    renderCalendar(selectedDate, locale, dict)

    expect(screen.getByRole('group', { name })).toBeInTheDocument()
  })
})
