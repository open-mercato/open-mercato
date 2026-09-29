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
})
