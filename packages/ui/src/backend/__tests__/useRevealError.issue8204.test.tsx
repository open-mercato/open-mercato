/** @jest-environment jsdom */
import * as React from 'react'
import { act, render, screen } from '@testing-library/react'
import { useRevealError } from '../utils/useRevealError'

function ErrorSurface({ rejection }: { rejection: object | null }) {
  const targetRef = React.useRef<HTMLDivElement>(null)
  useRevealError(targetRef, rejection)
  return rejection ? <div ref={targetRef} tabIndex={-1} role="alert">Save rejected</div> : null
}

describe('useRevealError', () => {
  let frames: Map<number, FrameRequestCallback>
  let scrollIntoView: jest.Mock

  beforeEach(() => {
    frames = new Map()
    let nextFrame = 0
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      nextFrame += 1
      frames.set(nextFrame, callback)
      return nextFrame
    })
    jest.spyOn(window, 'cancelAnimationFrame').mockImplementation((frame) => { frames.delete(frame) })
    scrollIntoView = jest.fn()
    Element.prototype.scrollIntoView = scrollIntoView
  })

  afterEach(() => { jest.restoreAllMocks() })

  function flushFrames() {
    act(() => {
      const pending = Array.from(frames.values())
      frames.clear()
      pending.forEach((callback) => callback(0))
    })
  }

  it('reveals and focuses the committed error once for each rejected attempt', () => {
    const rejection = {}
    const { rerender } = render(<ErrorSurface rejection={null} />)
    flushFrames()
    expect(scrollIntoView).not.toHaveBeenCalled()
    rerender(<ErrorSurface rejection={rejection} />)
    flushFrames()
    expect(screen.getByRole('alert')).toHaveFocus()
    expect(scrollIntoView.mock.instances[0]).toBe(screen.getByRole('alert'))
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'instant', block: 'start', inline: 'nearest' })
    rerender(<ErrorSurface rejection={rejection} />)
    flushFrames()
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    rerender(<ErrorSurface rejection={{}} />)
    flushFrames()
    expect(scrollIntoView).toHaveBeenCalledTimes(2)
  })

  it('cancels a queued reveal when the error clears or the surface unmounts', () => {
    const { rerender, unmount } = render(<ErrorSurface rejection={{}} />)
    rerender(<ErrorSurface rejection={null} />)
    flushFrames()
    expect(scrollIntoView).not.toHaveBeenCalled()
    rerender(<ErrorSurface rejection={{}} />)
    unmount()
    flushFrames()
    expect(scrollIntoView).not.toHaveBeenCalled()
  })
})
