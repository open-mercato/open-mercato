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

it('ignores clicks, cancelled drags, and pointer movements without an active drag', () => {
  const onCreateRange = jest.fn()
  const { container } = renderGrid(onCreateRange)
  const layer = container.querySelector('.cursor-cell')!
  dispatchPointer(layer, 'pointermove', 1200)
  dispatchPointer(layer, 'pointerdown', 1080)
  dispatchPointer(layer, 'pointerup', 1080)
  dispatchPointer(layer, 'pointerdown', 1080)
  dispatchPointer(layer, 'pointermove', 1200)
  dispatchPointer(layer, 'pointercancel')
  dispatchPointer(layer, 'pointerup', 1200)
  expect(onCreateRange).not.toHaveBeenCalled()
})
