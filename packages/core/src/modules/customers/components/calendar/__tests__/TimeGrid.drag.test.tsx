/** @jest-environment jsdom */

import * as React from 'react'
import { act, fireEvent } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { TimeGrid } from '../TimeGrid'

const anchor = new Date(2026, 8, 29)

function dispatchPointer(layer: Element, type: string, clientY = 0) {
  fireEvent(layer, new MouseEvent(type, { bubbles: true, button: 0, clientY }))
}

function renderGrid(onCreateRange: (start: Date, end: Date) => void) {
  function Host() {
    const [created, setCreated] = React.useState(false)
    return (
      <>
        <output>{created ? 'created' : 'idle'}</output>
        <TimeGrid
          anchor={anchor}
          days={1}
          items={[]}
          showWeekends
          showConflicts={false}
          aiSummaries={false}
          conflictIds={new Set()}
          onItemClick={() => {}}
          onJoin={() => {}}
          onNavigate={() => {}}
          onCreateRange={(start, end) => {
            setCreated(true)
            onCreateRange(start, end)
          }}
        />
      </>
    )
  }
  return renderWithProviders(<React.StrictMode><Host /></React.StrictMode>)
}

it('opens one event with the latest dragged range without updating its parent during render', () => {
  const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
  try {
    const onCreateRange = jest.fn()
    const { container } = renderGrid(onCreateRange)
    const layer = container.querySelector('.cursor-cell')!
    act(() => {
      dispatchPointer(layer, 'pointerdown', 1080)
      dispatchPointer(layer, 'pointermove', 1200)
      dispatchPointer(layer, 'pointerup', 1200)
    })
    expect(onCreateRange).toHaveBeenCalledTimes(1)
    expect(onCreateRange).toHaveBeenCalledWith(new Date(2026, 8, 29, 9), new Date(2026, 8, 29, 10))
    expect(container.querySelector('output')).toHaveTextContent('created')
    expect(consoleError).not.toHaveBeenCalled()
    dispatchPointer(layer, 'pointerup', 1200)
    expect(onCreateRange).toHaveBeenCalledTimes(1)
  } finally {
    consoleError.mockRestore()
  }
})

it('creates the half-hour slot under the pointer on a plain click', () => {
  const onCreateRange = jest.fn()
  const { container } = renderGrid(onCreateRange)
  const layer = container.querySelector('.cursor-cell')!
  act(() => {
    dispatchPointer(layer, 'pointerdown', 1100)
    dispatchPointer(layer, 'pointerup', 1100)
  })
  expect(onCreateRange).toHaveBeenCalledTimes(1)
  expect(onCreateRange).toHaveBeenCalledWith(new Date(2026, 8, 29, 9), new Date(2026, 8, 29, 9, 30))
})

it('creates the highlighted slot when clicking just below a slot boundary', () => {
  const onCreateRange = jest.fn()
  const { container } = renderGrid(onCreateRange)
  const layer = container.querySelector('.cursor-cell')!
  act(() => {
    dispatchPointer(layer, 'pointermove', 1138)
  })
  expect(container.querySelector('[data-calendar-hover-slot]')?.getAttribute('data-calendar-hover-slot')).toBe('540')
  act(() => {
    dispatchPointer(layer, 'pointerdown', 1138)
    dispatchPointer(layer, 'pointerup', 1138)
  })
  expect(onCreateRange).toHaveBeenCalledTimes(1)
  expect(onCreateRange).toHaveBeenCalledWith(new Date(2026, 8, 29, 9), new Date(2026, 8, 29, 9, 30))
})

it('highlights the hovered half-hour slot and clears it when the pointer leaves', () => {
  const { container } = renderGrid(jest.fn())
  const layer = container.querySelector('.cursor-cell')!
  act(() => {
    dispatchPointer(layer, 'pointermove', 1270)
  })
  const slot = container.querySelector('[data-calendar-hover-slot]')
  expect(slot).not.toBeNull()
  expect(slot?.getAttribute('data-calendar-hover-slot')).toBe('630')
  act(() => {
    // React derives onPointerLeave from the native pointerout event.
    dispatchPointer(layer, 'pointerout')
  })
  expect(container.querySelector('[data-calendar-hover-slot]')).toBeNull()
})

it('ignores cancelled drags and pointer movements without an active drag', () => {
  const onCreateRange = jest.fn()
  const { container } = renderGrid(onCreateRange)
  const layer = container.querySelector('.cursor-cell')!
  dispatchPointer(layer, 'pointermove', 1200)
  dispatchPointer(layer, 'pointerdown', 1080)
  dispatchPointer(layer, 'pointermove', 1200)
  dispatchPointer(layer, 'pointercancel')
  dispatchPointer(layer, 'pointerup', 1200)
  expect(onCreateRange).not.toHaveBeenCalled()
})
