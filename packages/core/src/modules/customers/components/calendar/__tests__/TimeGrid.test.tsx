/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { HOUR_HEIGHT_PX, TimeGrid } from '../TimeGrid'
import type { TimeGridProps } from '../types'

/** Vertical offset (px) of a time of day, expressed in minutes since midnight. */
const yAt = (minutes: number) => (minutes / 60) * HOUR_HEIGHT_PX

const ANCHOR = new Date(2026, 7, 10)

function renderGrid(days: TimeGridProps['days'], onCreateRange = jest.fn()) {
  function CalendarScreen() {
    const [range, setRange] = React.useState<{ start: Date; end: Date } | null>(null)
    return (
      <>
        <TimeGrid
          days={days}
          anchor={ANCHOR}
          items={[]}
          conflictIds={new Set()}
          showWeekends
          showConflicts={false}
          aiSummaries={false}
          onItemClick={jest.fn()}
          onJoin={jest.fn()}
          onNavigate={jest.fn()}
          onCreateRange={(start, end) => {
            onCreateRange(start, end)
            setRange({ start, end })
          }}
        />
        {range ? <output aria-label="Created range">{range.start.toISOString()} / {range.end.toISOString()}</output> : null}
      </>
    )
  }

  const view = renderWithProviders(<React.StrictMode><CalendarScreen /></React.StrictMode>)
  const layers = Array.from(view.container.querySelectorAll<HTMLDivElement>('.cursor-cell'))
  expect(layers).toHaveLength(days)
  return { ...view, layers, onCreateRange }
}

function dispatchPointer(layer: HTMLDivElement, type: string, clientY: number) {
  fireEvent(layer, new MouseEvent(type, { bubbles: true, button: 0, clientY }))
}

describe('TimeGrid drag-to-create', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it.each([
    { days: 1 as const, dayIndex: 0, startY: yAt(9 * 60), endY: yAt(10 * 60) },
    { days: 1 as const, dayIndex: 0, startY: yAt(10 * 60), endY: yAt(9 * 60) },
    { days: 7 as const, dayIndex: 2, startY: yAt(9 * 60), endY: yAt(10 * 60) },
    { days: 7 as const, dayIndex: 2, startY: yAt(10 * 60), endY: yAt(9 * 60) },
  ])('creates one range without updating the parent during render in the $days-day view ($startY to $endY)', ({ days, dayIndex, startY, endY }) => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
    const { layers, onCreateRange } = renderGrid(days)
    const layer = layers[dayIndex]
    const expectedStart = new Date(2026, 7, 10 + dayIndex, 9)
    const expectedEnd = new Date(2026, 7, 10 + dayIndex, 10)

    dispatchPointer(layer, 'pointerdown', startY)
    dispatchPointer(layer, 'pointermove', endY)
    expect(screen.getByText('New event')).toBeInTheDocument()
    dispatchPointer(layer, 'pointerup', endY)

    expect(consoleError).not.toHaveBeenCalled()
    expect(onCreateRange).toHaveBeenCalledTimes(1)
    expect(onCreateRange).toHaveBeenCalledWith(expectedStart, expectedEnd)
    expect(screen.getByLabelText('Created range')).toHaveTextContent(`${expectedStart.toISOString()} / ${expectedEnd.toISOString()}`)
    expect(screen.queryByText('New event')).not.toBeInTheDocument()
  })

  it.each([null, yAt(9 * 60 + 30)])('uses the latest pointer movement before React renders it (previous movement: %s)', (previousMovement) => {
    const { layers, onCreateRange } = renderGrid(1)
    const layer = layers[0]
    dispatchPointer(layer, 'pointerdown', yAt(9 * 60))
    if (previousMovement !== null) dispatchPointer(layer, 'pointermove', previousMovement)

    act(() => {
      layer.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientY: yAt(10 * 60) }))
      layer.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientY: yAt(10 * 60) }))
    })

    expect(onCreateRange).toHaveBeenCalledTimes(1)
    expect(onCreateRange).toHaveBeenCalledWith(new Date(2026, 7, 10, 9), new Date(2026, 7, 10, 10))
    expect(screen.queryByText('New event')).not.toBeInTheDocument()
  })

  it('creates the half-hour slot under the pointer for a plain click', () => {
    const { layers, onCreateRange } = renderGrid(1)
    dispatchPointer(layers[0], 'pointerdown', yAt(9 * 60))
    dispatchPointer(layers[0], 'pointerup', yAt(9 * 60))

    expect(onCreateRange).toHaveBeenCalledTimes(1)
    const [start, end] = onCreateRange.mock.calls[0] as [Date, Date]
    expect(start.getHours()).toBe(9)
    expect(start.getMinutes()).toBe(0)
    expect(end.getTime() - start.getTime()).toBe(30 * 60000)
  })

  it('clears a canceled drag without creating a range', () => {
    const { layers, onCreateRange } = renderGrid(1)
    dispatchPointer(layers[0], 'pointerdown', yAt(9 * 60))
    dispatchPointer(layers[0], 'pointermove', yAt(10 * 60))
    expect(screen.getByText('New event')).toBeInTheDocument()
    dispatchPointer(layers[0], 'pointercancel', yAt(10 * 60))
    dispatchPointer(layers[0], 'pointerup', yAt(10 * 60))

    expect(onCreateRange).not.toHaveBeenCalled()
    expect(screen.queryByText('New event')).not.toBeInTheDocument()
  })
})

describe('TimeGrid default visible hours', () => {
  it('opens scrolled to 07:00 and is sized to show the hours through 20:00', () => {
    const { container } = renderGrid(7)
    const scroller = container.querySelector<HTMLDivElement>('.overflow-auto')!
    expect(scroller.scrollTop).toBe(7 * HOUR_HEIGHT_PX)
    const maxHeight = Number.parseFloat(scroller.style.maxHeight)
    expect(maxHeight).toBeGreaterThanOrEqual((20 - 7) * HOUR_HEIGHT_PX)
    expect(maxHeight).toBeLessThan((20 - 7 + 1) * HOUR_HEIGHT_PX)
  })
})
