/** @jest-environment jsdom */

import * as React from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { CollapsibleZoneLayout } from '../crud/CollapsibleZoneLayout'

let currentWidth = 1400
let resizeObserverTarget: Element | null = null
let resizeObserverInstance: ResizeObserverMock | null = null
let desktopViewport = true
const mediaQueryListeners = new Set<() => void>()

function createResizeEntry(target: Element, width: number): ResizeObserverEntry {
  return {
    target,
    contentRect: {
      width,
      height: 0,
      x: 0,
      y: 0,
      top: 0,
      right: width,
      bottom: 0,
      left: 0,
      toJSON: () => ({}),
    } as DOMRectReadOnly,
  } as ResizeObserverEntry
}

class ResizeObserverMock {
  readonly callback: ResizeObserverCallback

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
    resizeObserverInstance = this
  }

  observe(target: Element) {
    resizeObserverTarget = target
    this.callback([createResizeEntry(target, currentWidth)], this as unknown as ResizeObserver)
  }

  unobserve() {}

  disconnect() {
    resizeObserverTarget = null
  }
}

function setContainerWidth(width: number) {
  currentWidth = width
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: width,
  })
  if (!resizeObserverTarget || !resizeObserverInstance) return
  resizeObserverInstance.callback(
    [createResizeEntry(resizeObserverTarget, width)],
    resizeObserverInstance as unknown as ResizeObserver,
  )
}

describe('CollapsibleZoneLayout', () => {
  beforeEach(() => {
    currentWidth = 1400
    desktopViewport = true
    resizeObserverTarget = null
    resizeObserverInstance = null
    mediaQueryListeners.clear()
    localStorage.clear()

    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: currentWidth,
    })

    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: jest.fn().mockImplementation(() => ({
        matches: desktopViewport,
        media: '(min-width: 1024px)',
        onchange: null,
        addEventListener: (_event: string, listener: () => void) => {
          mediaQueryListeners.add(listener)
        },
        removeEventListener: (_event: string, listener: () => void) => {
          mediaQueryListeners.delete(listener)
        },
        addListener: (listener: () => void) => {
          mediaQueryListeners.add(listener)
        },
        removeListener: (listener: () => void) => {
          mediaQueryListeners.delete(listener)
        },
        dispatchEvent: () => true,
      })),
    })

    ;(globalThis as typeof globalThis & { ResizeObserver?: typeof ResizeObserverMock }).ResizeObserver = ResizeObserverMock
  })

  it('auto-collapses zone1 before the two-column layout becomes too narrow', async () => {
    const { container } = renderWithProviders(
      <CollapsibleZoneLayout
        zone1={<div>Zone 1</div>}
        zone2={<div>Zone 2</div>}
        entityName="Brightside Solar"
        pageType="company-v2"
      />,
      { dict: {} },
    )

    const layout = container.firstElementChild as HTMLElement

    await waitFor(() => {
      expect(layout).toHaveAttribute('data-zone-layout-mode', 'side-by-side')
    })

    act(() => {
      setContainerWidth(1180)
    })

    await waitFor(() => {
      expect(layout).toHaveAttribute('data-zone-layout-mode', 'collapsed')
    })

    expect(screen.queryByText('Zone 1')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Expand form panel' })).toBeInTheDocument()
  })

  it('stacks zone1 above zone2 when the user expands it in constrained space', async () => {
    currentWidth = 1180
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: currentWidth,
    })

    const { container } = renderWithProviders(
      <CollapsibleZoneLayout
        zone1={<div>Zone 1</div>}
        zone2={<div>Zone 2</div>}
        entityName="Brightside Solar"
        pageType="person-v2"
      />,
      { dict: {} },
    )

    const layout = container.firstElementChild as HTMLElement

    await waitFor(() => {
      expect(layout).toHaveAttribute('data-zone-layout-mode', 'collapsed')
    })

    fireEvent.click(screen.getByRole('button', { name: 'Expand form panel' }))

    await waitFor(() => {
      expect(layout).toHaveAttribute('data-zone-layout-mode', 'stacked')
    })

    const zone1 = screen.getByText('Zone 1')
    const zone2 = screen.getByText('Zone 2')

    expect(zone1.compareDocumentPosition(zone2) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
    expect(screen.getByRole('button', { name: 'Collapse form panel' })).toBeInTheDocument()
  })
})
