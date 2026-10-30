/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { CalendarPicker } from '../CalendarPicker'

const mockTranslate = (_key: string, fallback?: string) => fallback ?? ''
let mockLocale: string | undefined = 'en'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => mockTranslate,
  useOptionalLocale: () => mockLocale,
}))

const browserSunday = new Date(2026, 8, 20, 23, 0, 0)
const deploymentMonday = new Date(2026, 8, 21, 8, 0, 0)

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
}

function openPicker() {
  fireEvent.click(screen.getByRole('button', { name: 'Open calendar' }))
}

describe('CalendarPicker reference date (#6325)', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(browserSunday)
    mockLocale = 'en'
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('keeps deriving "This week" from the browser clock when no reference date is passed', () => {
    const onWeekSelect = jest.fn()
    render(<CalendarPicker selectedWeekStart={new Date(2026, 8, 14)} onWeekSelect={onWeekSelect} />)
    openPicker()
    fireEvent.click(screen.getByRole('button', { name: 'This week' }))
    expect(localDateKey(onWeekSelect.mock.calls[0][0])).toBe('2026-9-14')
  })

  it('selects the week of the supplied reference date for "This week" and "Last week"', () => {
    const onWeekSelect = jest.fn()
    render(
      <CalendarPicker
        selectedWeekStart={new Date(2026, 8, 14)}
        onWeekSelect={onWeekSelect}
        today={() => deploymentMonday}
      />,
    )
    openPicker()
    fireEvent.click(screen.getByRole('button', { name: 'This week' }))
    openPicker()
    fireEvent.click(screen.getByRole('button', { name: 'Last week' }))
    expect(onWeekSelect.mock.calls.map(([weekStart]) => localDateKey(weekStart))).toEqual(['2026-9-21', '2026-9-14'])
  })

  it('reads a callable reference date at click time, not at render time', () => {
    const onWeekSelect = jest.fn()
    let now = new Date(2026, 8, 20, 23, 59, 0)
    render(
      <CalendarPicker
        selectedWeekStart={new Date(2026, 8, 14)}
        onWeekSelect={onWeekSelect}
        today={() => now}
      />,
    )
    openPicker()
    now = new Date(2026, 8, 21, 0, 1, 0)
    fireEvent.click(screen.getByRole('button', { name: 'This week' }))
    expect(localDateKey(onWeekSelect.mock.calls[0][0])).toBe('2026-9-21')
  })

  it('does not mutate a Date passed as the reference', () => {
    const onWeekSelect = jest.fn()
    const reference = new Date(deploymentMonday)
    render(
      <CalendarPicker selectedWeekStart={new Date(2026, 8, 14)} onWeekSelect={onWeekSelect} today={reference} />,
    )
    openPicker()
    fireEvent.click(screen.getByRole('button', { name: 'Last week' }))
    expect(localDateKey(onWeekSelect.mock.calls[0][0])).toBe('2026-9-14')
    expect(reference.getTime()).toBe(deploymentMonday.getTime())
  })

  it('highlights the reference date as today', () => {
    render(
      <CalendarPicker
        selectedWeekStart={new Date(2026, 8, 7)}
        onWeekSelect={jest.fn()}
        today={deploymentMonday}
      />,
    )
    openPicker()
    const highlighted = Array.from(document.querySelectorAll('span.font-bold')).map((node) => node.textContent)
    expect(highlighted).toEqual(['21'])
  })

  it('formats the month label and weekday headers in the application locale', () => {
    mockLocale = 'de'
    render(
      <CalendarPicker selectedWeekStart={new Date(2026, 2, 2)} onWeekSelect={jest.fn()} today={deploymentMonday} />,
    )
    openPicker()
    expect(screen.getByText('März 2026')).toBeTruthy()
    expect(screen.getAllByText('D')).toHaveLength(2)
  })
})
