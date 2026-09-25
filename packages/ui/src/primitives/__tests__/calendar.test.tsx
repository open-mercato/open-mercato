import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { Calendar, CalendarMonthSelector } from '../calendar'

describe('Calendar source sizes and month selector', () => {
  it('preserves 36px days by default and supports optional 40px days', () => {
    const { rerender } = render(<Calendar mode="single" defaultMonth={new Date(2026, 5, 1)} />)
    expect(screen.getByRole('button', { name: /Friday, June 12/ })).toHaveClass('size-9')
    rerender(<Calendar mode="single" defaultMonth={new Date(2026, 5, 1)} daySize={40} />)
    expect(screen.getByRole('button', { name: /Friday, June 12/ })).toHaveClass('size-10')
  })

  it.each([[false, false, 0], [true, false, 1], [false, true, 1], [true, true, 2]])(
    'supports previous=%s and next=%s controls', (previous, next, count) => {
      const previousAction = jest.fn()
      const nextAction = jest.fn()
      render(<I18nProvider locale="en" dict={{}}><CalendarMonthSelector month={new Date(2026, 5, 1)} onPreviousMonth={previous ? previousAction : undefined} onNextMonth={next ? nextAction : undefined} /></I18nProvider>)
      expect(screen.queryAllByRole('button')).toHaveLength(count as number)
      expect(screen.getByText('June 2026')).toHaveAttribute('aria-live', 'polite')
      if (previous) { fireEvent.click(screen.getByRole('button', { name: 'Previous month' })); expect(previousAction).toHaveBeenCalledTimes(1) }
      if (next) { fireEvent.click(screen.getByRole('button', { name: 'Next month' })); expect(nextAction).toHaveBeenCalledTimes(1) }
    },
  )

  it('honors disabled navigation and translated accessible names', () => {
    const onPreviousMonth = jest.fn()
    render(<I18nProvider locale="pl" dict={{ 'ui.calendar.previousMonth': 'Poprzedni miesiąc' }}><CalendarMonthSelector month={new Date(2026, 5, 1)} onPreviousMonth={onPreviousMonth} disabledPrevious /></I18nProvider>)
    const previous = screen.getByRole('button', { name: 'Poprzedni miesiąc' })
    expect(previous).toBeDisabled()
    fireEvent.click(previous)
    expect(onPreviousMonth).not.toHaveBeenCalled()
  })

  it('translates the caption and month grid accessible names from the app locale', () => {
    const dict = {
      'ui.calendar.goToPreviousMonth': 'Poprzedni: {month}',
      'ui.calendar.goToNextMonth': 'Następny: {month}',
      'ui.calendar.openMonthYearNavigation': '{month} – otwórz nawigację',
      'ui.calendar.selectMonthAndYear': 'Wybierz miesiąc i rok',
      'ui.calendar.goToPreviousYear': 'Poprzedni rok: {year}',
      'ui.calendar.goToNextYear': 'Następny rok: {year}',
      'ui.calendar.backToDaySelection': '{year} – powrót do dni',
    }
    render(<I18nProvider locale="pl" dict={dict}><Calendar mode="single" defaultMonth={new Date(2026, 5, 1)} /></I18nProvider>)
    expect(screen.getByRole('button', { name: 'Poprzedni: May 2026' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Następny: July 2026' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'June 2026 – otwórz nawigację' }))
    expect(screen.getByRole('dialog', { name: 'Wybierz miesiąc i rok' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Poprzedni rok: 2025' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Następny rok: 2027' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '2026 – powrót do dni' })).toBeInTheDocument()
  })

  it('keeps the English accessible names without an I18nProvider', () => {
    render(<Calendar mode="single" defaultMonth={new Date(2026, 5, 1)} />)
    expect(screen.getByRole('button', { name: 'Go to previous month: May 2026' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'June 2026 – open month and year navigation' }))
    expect(screen.getByRole('dialog', { name: 'Select month and year' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Go to previous year: 2025' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Go to next year: 2027' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '2026 – back to day selection' })).toBeInTheDocument()
  })

  it('honors caller-supplied labels for the visible month arrows', () => {
    const labelPrevious = jest.fn((month?: Date) => `Back to ${month?.getMonth()}`)
    const labelNext = jest.fn((month?: Date) => `Forward to ${month?.getMonth()}`)
    render(<I18nProvider locale="en" dict={{}}><Calendar mode="single" defaultMonth={new Date(2026, 5, 1)} labels={{ labelPrevious, labelNext }} /></I18nProvider>)
    const outsideBuiltInNav = (name: string) =>
      screen.getAllByRole('button', { name }).filter((button) => !button.closest('nav'))
    expect(outsideBuiltInNav('Back to 4')).toHaveLength(1)
    expect(outsideBuiltInNav('Forward to 6')).toHaveLength(1)
  })
})
