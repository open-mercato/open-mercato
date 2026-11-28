/** @jest-environment jsdom */
import * as React from 'react'
import { act, render, screen } from '@testing-library/react'
import { useRevealError } from '../utils/useRevealError'

function ErrorSurface({ rejection, loading = false, layoutKey }: { rejection: object | null; loading?: boolean; layoutKey?: string }) {
  const targetRef = React.useRef<HTMLDivElement>(null)
  useRevealError(targetRef, rejection, loading, layoutKey)
  return <><button>Other field</button>{rejection ? <div ref={targetRef} tabIndex={-1} role="alert">Save rejected</div> : null}</>
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
  it('reveals a still-focused rejection displaced by completed loading without refocusing it', () => {
    const rejection = {}
    const { rerender } = render(<ErrorSurface rejection={rejection} loading />)
    flushFrames()
    const target = screen.getByRole('alert')
    const focus = jest.spyOn(target, 'focus')
    jest.spyOn(target, 'getBoundingClientRect').mockReturnValue({ top: 1000 } as DOMRect)
    rerender(<ErrorSurface rejection={rejection} loading={false} />)
    flushFrames()
    expect(target).toHaveFocus()
    expect(focus).not.toHaveBeenCalled()
    expect(scrollIntoView).toHaveBeenCalledTimes(2)
  })

  it('reveals a focused error displaced by form growth and stops watching on blur', () => {
    const previousObserver = Object.getOwnPropertyDescriptor(window, 'ResizeObserver')
    const observer = { observe: jest.fn(), disconnect: jest.fn(), unobserve: jest.fn() }
    let notify = () => {}
    const ResizeObserverMock = jest.fn((callback: ResizeObserverCallback) => {
      notify = () => callback([], observer)
      return observer
    })
    Object.defineProperty(window, 'ResizeObserver', { configurable: true, value: ResizeObserverMock })
    try {
      render(<form><ErrorSurface rejection={{}} layoutKey="catalog" /></form>)
      flushFrames()
      const error = screen.getByRole('alert')
      const focus = jest.spyOn(error, 'focus')
      const bounds = jest.spyOn(error, 'getBoundingClientRect').mockReturnValue({ top: 100 } as DOMRect)
      act(notify)
      expect(scrollIntoView).toHaveBeenCalledTimes(1)

      bounds.mockReturnValue({ top: 1000 } as DOMRect)
      act(notify)
      expect(scrollIntoView).toHaveBeenCalledTimes(2)
      expect(error).toHaveFocus()
      expect(focus).not.toHaveBeenCalled()

      screen.getByRole('button').focus()
      expect(observer.disconnect).toHaveBeenCalledTimes(1)
      act(notify)
      expect(scrollIntoView).toHaveBeenCalledTimes(2)
      expect(screen.getByRole('button')).toHaveFocus()
    } finally {
      if (previousObserver) Object.defineProperty(window, 'ResizeObserver', previousObserver)
      else Reflect.deleteProperty(window, 'ResizeObserver')
    }
  })

  it('does not scroll again when the focused message remains visible after loading', () => {
    const rejection = {}
    const { rerender } = render(<ErrorSurface rejection={rejection} loading />)
    flushFrames()
    jest.spyOn(screen.getByRole('alert'), 'getBoundingClientRect').mockReturnValue({ top: 100 } as DOMRect)
    rerender(<ErrorSurface rejection={rejection} />)
    flushFrames()
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
  })

  it('does not resume an old reveal after focus moves away and returns', () => {
    const rejection = {}
    const { rerender } = render(<ErrorSurface rejection={rejection} loading />)
    flushFrames()
    const target = screen.getByRole('alert')
    jest.spyOn(target, 'getBoundingClientRect').mockReturnValue({ top: 1000 } as DOMRect)
    screen.getByRole('button').focus()
    target.focus()
    rerender(<ErrorSurface rejection={rejection} />)
    flushFrames()
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
  })

  it('cancels a pending layout reveal when a rejection clears, changes, or unmounts', () => {
    const first = {}
    const { rerender, unmount } = render(<ErrorSurface rejection={first} loading />)
    flushFrames()
    rerender(<ErrorSurface rejection={null} />)
    flushFrames()
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    rerender(<ErrorSurface rejection={{}} loading />)
    flushFrames()
    rerender(<ErrorSurface rejection={{}} loading />)
    flushFrames()
    unmount()
    flushFrames()
    expect(scrollIntoView).toHaveBeenCalledTimes(3)
  })

  it('detects a summary clipped by a nested scroll container', () => {
    const rejection = {}
    const { rerender } = render(<div data-testid="dialog" style={{ overflowY: 'auto' }}><ErrorSurface rejection={rejection} loading /></div>)
    flushFrames()
    const dialog = screen.getByTestId('dialog')
    Object.defineProperty(dialog, 'clientHeight', { value: 100 })
    jest.spyOn(dialog, 'getBoundingClientRect').mockReturnValue({ top: 100 } as DOMRect)
    jest.spyOn(screen.getByRole('alert'), 'getBoundingClientRect').mockReturnValue({ top: 250 } as DOMRect)
    rerender(<div data-testid="dialog" style={{ overflowY: 'auto' }}><ErrorSurface rejection={rejection} /></div>)
    flushFrames()
    expect(scrollIntoView).toHaveBeenCalledTimes(2)
  })

  it('cancels the old rejection when definitions reload while still pending', () => {
    const rejection = {}
    const { rerender } = render(<ErrorSurface rejection={rejection} loading layoutKey="first" />)
    flushFrames()
    jest.spyOn(screen.getByRole('alert'), 'getBoundingClientRect').mockReturnValue({ top: 1000 } as DOMRect)
    rerender(<ErrorSurface rejection={rejection} loading layoutKey="second" />)
    rerender(<ErrorSurface rejection={rejection} layoutKey="second" />)
    flushFrames()
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
  })

})
