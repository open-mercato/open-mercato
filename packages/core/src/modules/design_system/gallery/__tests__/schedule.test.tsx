/** @jest-environment jsdom */
import * as React from 'react'
import { render } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { ScheduleView, ScheduleToolbar, type ScheduleViewProps, type ScheduleToolbarProps } from '@open-mercato/ui/backend/schedule'
import { entries } from '../entries/schedule'

jest.mock('@open-mercato/ui/backend/schedule', () => ({
  ScheduleView: jest.fn(() => null),
  ScheduleToolbar: jest.fn(() => null),
  ScheduleAgenda: jest.fn(() => null),
  ScheduleGrid: jest.fn(() => null),
}))

describe('schedule gallery week fixtures', () => {
  beforeEach(() => jest.clearAllMocks())

  it.each([
    ['en', 7, 13],
    ['pl', 8, 14],
    ['de', 8, 14],
    ['es', 8, 14],
    ['ko', 7, 13],
  ] as const)('keeps the calendar and toolbar aligned with %s week boundaries', (locale, startDay, endDay) => {
    const calendar = entries.find((entry) => entry.id === 'schedule-view')!.variants[0]
    const toolbar = entries.find((entry) => entry.id === 'schedule-toolbar')!.variants[0]
    render(<I18nProvider locale={locale} dict={{}}>{calendar.render()}{toolbar.render()}</I18nProvider>)
    const calendarProps = jest.mocked(ScheduleView).mock.calls[0][0] as ScheduleViewProps
    const toolbarProps = jest.mocked(ScheduleToolbar).mock.calls[0][0] as ScheduleToolbarProps
    expect(calendarProps.range).toEqual({
      start: new Date(2026, 5, startDay),
      end: new Date(2026, 5, endDay, 23, 59, 59, 999),
    })
    expect(toolbarProps.range).toEqual(calendarProps.range)
    expect(calendarProps.items).toHaveLength(5)
    for (const item of calendarProps.items) {
      expect(new Date(item.startsAt).getTime()).toBeGreaterThanOrEqual(calendarProps.range.start.getTime())
      expect(new Date(item.endsAt).getTime()).toBeLessThanOrEqual(calendarProps.range.end.getTime())
    }
  })
})
