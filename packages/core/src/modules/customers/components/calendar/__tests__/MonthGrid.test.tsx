/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { cleanup } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { MonthGrid } from '../MonthGrid'
import { formatTimeRange } from '../EventBlock'
import type { CalendarItem } from '../types'
import { buildCalendarItem } from './fixtures'

const MONTH_ANCHOR = new Date(2026, 7, 10, 12, 0, 0)

function renderGrid(locale: string, items: CalendarItem[] = []) {
  return renderWithProviders(
    <MonthGrid anchor={MONTH_ANCHOR} items={items} onItemClick={jest.fn()} onDayOpen={jest.fn()} />,
    { locale },
  )
}

function weekdayHeaderText(container: HTMLElement): string {
  return container.firstElementChild?.firstElementChild?.textContent ?? ''
}

function dayCellLabel(container: HTMLElement): string {
  return container.querySelector('button[aria-label]')?.getAttribute('aria-label') ?? ''
}

function eventPillLabel(container: HTMLElement): string {
  return container.querySelector('button[aria-label*="–"]')?.getAttribute('aria-label') ?? ''
}

describe('MonthGrid — locale-aware date formatting (#5116)', () => {
  afterEach(() => {
    cleanup()
  })

  it('formats the weekday header row using the application locale, not the browser/OS locale', () => {
    const en = renderGrid('en')
    const enText = weekdayHeaderText(en.container)
    en.unmount()

    const pl = renderGrid('pl')
    const plText = weekdayHeaderText(pl.container)
    pl.unmount()

    expect(enText).not.toBe('')
    expect(plText).not.toBe('')
    expect(plText).not.toBe(enText)
    expect(enText.toUpperCase()).toContain('MON')
    expect(plText.toUpperCase()).toContain('PON')
  })

  it('formats the day-cell full date label using the application locale, not the browser/OS locale', () => {
    const en = renderGrid('en')
    const enLabel = dayCellLabel(en.container)
    en.unmount()

    const pl = renderGrid('pl')
    const plLabel = dayCellLabel(pl.container)
    pl.unmount()

    expect(enLabel).not.toBe('')
    expect(plLabel).not.toBe('')
    expect(plLabel).not.toBe(enLabel)
  })

  it('formats the event pill time range using the application locale, not the browser/OS locale', () => {
    const items = [buildCalendarItem()]

    const en = renderGrid('en', items)
    const enLabel = eventPillLabel(en.container)
    en.unmount()

    const pl = renderGrid('pl', items)
    const plLabel = eventPillLabel(pl.container)
    pl.unmount()

    expect(enLabel).not.toBe('')
    expect(plLabel).not.toBe('')
    expect(plLabel).not.toBe(enLabel)
  })
})

describe('MonthGrid — shared time-range formatting (#5275)', () => {
  afterEach(() => {
    cleanup()
  })

  it.each(['pl', 'de'])(
    'renders the event pill range exactly as the week view renders it in %s',
    (locale) => {
      const item = buildCalendarItem()

      const view = renderGrid(locale, [item])
      const pillLabel = eventPillLabel(view.container)
      view.unmount()

      expect(pillLabel).toBe(`${item.title} · ${formatTimeRange(locale, item.start, item.end)}`)
    },
  )
})
