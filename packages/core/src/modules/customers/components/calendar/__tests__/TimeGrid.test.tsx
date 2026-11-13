/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { TimeGrid } from '../TimeGrid'
import type { TimeGridProps } from '../types'

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
    { days: 1 as const, dayIndex: 0, startY: 1080, endY: 1200 },
    { days: 1 as const, dayIndex: 0, startY: 1200, endY: 1080 },
    { days: 7 as const, dayIndex: 2, startY: 1080, endY: 1200 },
    { days: 7 as const, dayIndex: 2, startY: 1200, endY: 1080 },
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

  it.each([null, 1140])('uses the latest pointer movement before React renders it (previous movement: %s)', (previousMovement) => {
    const { layers, onCreateRange } = renderGrid(1)
    const layer = layers[0]
    dispatchPointer(layer, 'pointerdown', 1080)
    if (previousMovement !== null) dispatchPointer(layer, 'pointermove', previousMovement)

    act(() => {
      layer.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientY: 1200 }))
      layer.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientY: 1200 }))
    })

    expect(onCreateRange).toHaveBeenCalledTimes(1)
    expect(onCreateRange).toHaveBeenCalledWith(new Date(2026, 7, 10, 9), new Date(2026, 7, 10, 10))
    expect(screen.queryByText('New event')).not.toBeInTheDocument()
  })

  it('does not create a range for a plain click', () => {
    const { layers, onCreateRange } = renderGrid(1)
    dispatchPointer(layers[0], 'pointerdown', 1080)
    dispatchPointer(layers[0], 'pointerup', 1080)

    expect(onCreateRange).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('Created range')).not.toBeInTheDocument()
    expect(screen.queryByText('New event')).not.toBeInTheDocument()
  })

  it('clears a canceled drag without creating a range', () => {
    const { layers, onCreateRange } = renderGrid(1)
    dispatchPointer(layers[0], 'pointerdown', 1080)
    dispatchPointer(layers[0], 'pointermove', 1200)
    expect(screen.getByText('New event')).toBeInTheDocument()
    dispatchPointer(layers[0], 'pointercancel', 1200)
    dispatchPointer(layers[0], 'pointerup', 1200)

    expect(onCreateRange).not.toHaveBeenCalled()
    expect(screen.queryByText('New event')).not.toBeInTheDocument()
  })
})
