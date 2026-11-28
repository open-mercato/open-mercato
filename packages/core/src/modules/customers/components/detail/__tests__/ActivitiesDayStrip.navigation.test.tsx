/** @jest-environment jsdom */
import * as React from 'react'
import { fireEvent, screen, within } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { ActivitiesDayStrip } from '../ActivitiesDayStrip'

function renderCalendar() {
  const onSelectDate = jest.fn()
  renderWithProviders(
    <ActivitiesDayStrip
      entityId="owned-person"
      selectedDate={new Date(2026, 10, 3)}
      onSelectDate={onSelectDate}
      events={[]}
    />,
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

  it('reveals the selected date inside the viewport on mount and selection changes', () => {
    const bounds = jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const viewport = this.getAttribute('role') === 'group' ? this : this.closest<HTMLElement>('[role="group"]')
      if (!viewport) return { left: 0, right: 0 } as DOMRect
      if (this === viewport) return { left: 79, right: 311 } as DOMRect
      const index = Array.from(viewport.querySelectorAll('button')).indexOf(this)
      const left = 83 + index * 104 - viewport.scrollLeft
      return { left, right: left + 100 } as DOMRect
    })
    try {
      const onSelectDate = jest.fn()
      const calendar = (day: number) => (
        <ActivitiesDayStrip entityId="owned-person" selectedDate={new Date(2026, 10, day)} onSelectDate={onSelectDate} events={[]} />
      )
      const { rerender } = renderWithProviders(calendar(3))
      const viewport = screen.getByRole('group', { name: 'November 2026' })
      expect(viewport.scrollLeft).toBe(80)
      expect(HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled()

      rerender(calendar(5))
      expect(viewport.scrollLeft).toBe(288)
      expect(HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled()
    } finally {
      bounds.mockRestore()
    }
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
})
