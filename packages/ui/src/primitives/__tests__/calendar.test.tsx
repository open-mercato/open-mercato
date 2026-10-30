import * as React from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { Calendar, CalendarMonthSelector } from '../calendar'
import { DatePicker } from '../date-picker'

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
    fireEvent.click(screen.getByRole('button', { name: 'Forward to 6' }))
    expect(screen.getByRole('button', { name: 'Back to 5' })).toBeInTheDocument()
  })

  it('does not render the hidden built-in navigation with its untranslated names', () => {
    render(<I18nProvider locale="pl" dict={{}}><Calendar mode="single" defaultMonth={new Date(2026, 5, 1)} /></I18nProvider>)
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Go to the (Previous|Next) Month/ })).not.toBeInTheDocument()
  })
})

describe('Calendar month grid keyboard navigation', () => {
  it('focuses the displayed month and makes the covered day view inactive', async () => {
    const user = userEvent.setup()
    render(<Calendar mode="single" defaultMonth={new Date(2026, 5, 1)} />)
    const day = screen.getByRole('button', { name: /Friday, June 12/ })
    const caption = screen.getByRole('button', { name: /June 2026 – open/ })
    caption.focus()

    await user.keyboard('{Enter}')

    const grid = screen.getByRole('dialog', { name: 'Select month and year' })
    expect(within(grid).getByRole('button', { name: 'Jun' })).toHaveFocus()
    expect(day.closest('[aria-hidden="true"]')).toHaveAttribute('inert')
    expect(day.closest('[aria-hidden="true"]')).toHaveClass('invisible')
    await user.tab()
    await user.tab()
    expect(within(grid).getByRole('button', { name: 'Aug' })).toHaveFocus()
  })

  it('cycles Tab and Shift+Tab through every grid control', async () => {
    const user = userEvent.setup()
    render(<Calendar mode="single" defaultMonth={new Date(2026, 5, 1)} />)
    await user.click(screen.getByRole('button', { name: /June 2026 – open/ }))
    const grid = screen.getByRole('dialog')
    const previousYear = within(grid).getByRole('button', { name: 'Go to previous year: 2025' })
    const december = within(grid).getByRole('button', { name: 'Dec' })
    december.focus()

    await user.tab()
    expect(previousYear).toHaveFocus()
    await user.tab({ shift: true })
    expect(december).toHaveFocus()

    for (const shift of [false, true]) {
      for (let tabIndex = 0; tabIndex < within(grid).getAllByRole('button').length; tabIndex++) {
        await user.tab({ shift })
        expect(grid).toContainElement(document.activeElement as HTMLElement)
      }
    }
  })

  it('restores caption focus after Escape without changing the date or month', async () => {
    const user = userEvent.setup()
    const onSelect = jest.fn()
    const onMonthChange = jest.fn()
    render(<Calendar mode="single" selected={new Date(2026, 5, 12)} defaultMonth={new Date(2026, 5, 1)} onSelect={onSelect} onMonthChange={onMonthChange} />)
    await user.click(screen.getByRole('button', { name: /June 2026 – open/ }))
    await user.click(screen.getByRole('button', { name: 'Go to next year: 2027' }))
    expect(screen.getByRole('button', { name: 'Go to next year: 2028' })).toHaveFocus()

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /June 2026 – open/ })).toHaveFocus()
    expect(screen.getByRole('button', { name: /Friday, June 12/ })).toBeVisible()
    expect(onSelect).not.toHaveBeenCalled()
    expect(onMonthChange).not.toHaveBeenCalled()
  })

  it('returns to the day view when the year button is activated', async () => {
    const user = userEvent.setup()
    render(<Calendar mode="single" defaultMonth={new Date(2026, 5, 1)} />)
    await user.click(screen.getByRole('button', { name: /June 2026 – open/ }))
    await user.click(screen.getByRole('button', { name: '2026 – back to day selection' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    const caption = screen.getByRole('button', { name: /June 2026 – open/ })
    expect(caption).toHaveFocus()
    expect(caption.closest('[inert]')).toBeNull()
  })

  it('restores focus to the new caption after selecting a different month and year', async () => {
    const user = userEvent.setup()
    const onMonthChange = jest.fn()
    const onSelect = jest.fn()
    render(<React.StrictMode><Calendar mode="single" defaultMonth={new Date(2026, 5, 1)} onMonthChange={onMonthChange} onSelect={onSelect} /></React.StrictMode>)
    await user.click(screen.getByRole('button', { name: /June 2026 – open/ }))
    await user.click(screen.getByRole('button', { name: 'Go to next year: 2027' }))
    expect(screen.getByRole('button', { name: 'Go to next year: 2028' })).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'Jul' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /July 2027 – open/ })).toHaveFocus()
    expect(onMonthChange).toHaveBeenCalledWith(new Date(2027, 6, 1))
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('keeps the date picker open when Escape dismisses the nested month grid', async () => {
    const user = userEvent.setup()
    render(<I18nProvider locale="en" dict={{}}><DatePicker value={new Date(2026, 5, 12)} onChange={jest.fn()} aria-label="Closing date" /></I18nProvider>)
    await user.click(screen.getByRole('button', { name: 'Closing date' }))
    await user.click(screen.getByRole('button', { name: /June 2026 – open/ }))
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog', { name: 'Select month and year' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /June 2026 – open/ })).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Apply' })).toBeVisible()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Closing date' })).toHaveFocus()
  })

  it('removes the Escape listener when the calendar unmounts with its grid open', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<Calendar mode="single" defaultMonth={new Date(2026, 5, 1)} />)
    await user.click(screen.getByRole('button', { name: /June 2026 – open/ }))
    unmount()
    render(<button type="button">Outside calendar</button>)
    const outsideButton = screen.getByRole('button', { name: 'Outside calendar' })
    outsideButton.focus()
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })

    expect(outsideButton.dispatchEvent(escape)).toBe(true)
    expect(outsideButton).toHaveFocus()
  })

  it('keeps multi-month calendars in the day view', () => {
    render(<Calendar mode="range" defaultMonth={new Date(2026, 5, 1)} numberOfMonths={2} />)

    expect(screen.queryByRole('button', { name: /open month and year/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Friday, June 12/ })).toBeVisible()
    expect(screen.getByRole('button', { name: /Friday, June 12/ }).closest('[inert]')).toBeNull()
  })
})
