/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { CalendarTabs } from '../CalendarTabs'

describe('CalendarTabs view switcher', () => {
  it('offers day, work week, week, month and agenda views in that order', () => {
    renderWithProviders(
      <CalendarTabs
        tab="all"
        counts={{ all: 0, meetings: 0, events: 0 }}
        view="week"
        onTabChange={jest.fn()}
        onViewChange={jest.fn()}
      />,
    )
    const group = screen.getByRole('radiogroup', { name: 'Calendar view' })
    const labels = Array.from(group.querySelectorAll('[role="radio"]')).map((node) => node.textContent?.trim())
    expect(labels).toEqual(['Day', 'Work week', 'Week', 'Month', 'Agenda'])
  })

  it('reports the work week view when it is picked', () => {
    const onViewChange = jest.fn()
    renderWithProviders(
      <CalendarTabs
        tab="all"
        counts={{ all: 0, meetings: 0, events: 0 }}
        view="week"
        onTabChange={jest.fn()}
        onViewChange={onViewChange}
      />,
    )
    fireEvent.click(screen.getByRole('radio', { name: 'Work week' }))
    expect(onViewChange).toHaveBeenCalledWith('workweek')
  })
})
