/** @jest-environment jsdom */

import * as React from 'react'
import { fireEvent, render as baseRender, screen } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'

import { Splitter, SplitterPanel, initialSplitterSizes, resizeSplitterPair } from '../splitter'

if (typeof window.PointerEvent === 'undefined') {
  class TestPointerEvent extends MouseEvent {
    pointerId: number
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init)
      this.pointerId = init.pointerId ?? 0
    }
  }
  Object.defineProperty(window, 'PointerEvent', { configurable: true, value: TestPointerEvent })
}

function render(ui: React.ReactElement) {
  return baseRender(ui, { wrapper: ({ children }) => <I18nProvider locale="en" dict={{}}>{children}</I18nProvider> })
}

function panelGrow(index: number): number {
  const panels = document.querySelectorAll<HTMLElement>('[data-slot="splitter-panel"]')
  return Number(panels[index].style.flexGrow)
}

describe('Splitter', () => {
  it('shares the remaining space between panels without a default size', () => {
    expect(initialSplitterSizes([30, undefined, undefined])).toEqual([30, 35, 35])
    expect(initialSplitterSizes([undefined, undefined])).toEqual([50, 50])
    expect(initialSplitterSizes([60, 60])).toEqual([50, 50])
  })

  it('keeps both panels of a pair inside their limits', () => {
    const limits = [{ min: 20, max: 70 }, { min: 25, max: 100 }]
    expect(resizeSplitterPair([50, 50], 0, 40, limits)).toEqual([70, 30])
    expect(resizeSplitterPair([50, 50], 0, -40, limits)).toEqual([20, 80])
    expect(resizeSplitterPair([70, 30], 0, 10, [{ min: 0, max: 100 }, { min: 25, max: 100 }])).toEqual([75, 25])
  })

  it('renders a focusable separator between each pair of panels', () => {
    render(
      <Splitter>
        <SplitterPanel defaultSize={30} minSize={20}>List</SplitterPanel>
        <SplitterPanel>Preview</SplitterPanel>
        <SplitterPanel>Details</SplitterPanel>
      </Splitter>,
    )
    const handles = screen.getAllByRole('separator', { name: 'Resize panels' })
    expect(handles).toHaveLength(2)
    expect(handles[0]).toHaveAttribute('tabindex', '0')
    expect(handles[0]).toHaveAttribute('aria-orientation', 'vertical')
    expect(handles[0]).toHaveAttribute('aria-valuenow', '30')
    expect(handles[0]).toHaveAttribute('aria-valuemin', '20')
    expect(handles[0]).toHaveAttribute('aria-controls', screen.getByText('List').id)
    expect(panelGrow(0)).toBe(30)
  })

  it('moves the handle with arrow keys, Home and End', () => {
    const onResize = jest.fn()
    const onResizeEnd = jest.fn()
    render(
      <Splitter onResize={onResize} onResizeEnd={onResizeEnd}>
        <SplitterPanel defaultSize={40} minSize={20} maxSize={60}>A</SplitterPanel>
        <SplitterPanel>B</SplitterPanel>
      </Splitter>,
    )
    const handle = screen.getByRole('separator')
    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(handle).toHaveAttribute('aria-valuenow', '45')
    expect(onResize).toHaveBeenLastCalledWith([45, 55])
    expect(onResizeEnd).toHaveBeenLastCalledWith([45, 55])
    fireEvent.keyDown(handle, { key: 'End' })
    expect(handle).toHaveAttribute('aria-valuenow', '60')
    fireEvent.keyDown(handle, { key: 'Home' })
    expect(handle).toHaveAttribute('aria-valuenow', '20')
    fireEvent.keyDown(handle, { key: 'ArrowUp' })
    expect(handle).toHaveAttribute('aria-valuenow', '20')
  })

  it('uses up and down keys in a vertical splitter', () => {
    render(
      <Splitter orientation="vertical">
        <SplitterPanel>A</SplitterPanel>
        <SplitterPanel>B</SplitterPanel>
      </Splitter>,
    )
    const handle = screen.getByRole('separator')
    expect(handle).toHaveAttribute('aria-orientation', 'horizontal')
    fireEvent.keyDown(handle, { key: 'ArrowDown' })
    expect(handle).toHaveAttribute('aria-valuenow', '55')
  })

  it('resizes by dragging relative to the container size', () => {
    const onResizeEnd = jest.fn()
    const { container } = render(
      <Splitter onResizeEnd={onResizeEnd}>
        <SplitterPanel>A</SplitterPanel>
        <SplitterPanel>B</SplitterPanel>
      </Splitter>,
    )
    const root = container.querySelector('[data-slot="splitter"]') as HTMLElement
    root.getBoundingClientRect = () => ({ width: 400, height: 200, top: 0, left: 0, right: 400, bottom: 200, x: 0, y: 0, toJSON: () => ({}) })
    const handle = screen.getByRole('separator')
    fireEvent.pointerDown(handle, { button: 0, clientX: 200, pointerId: 1 })
    expect(handle).toHaveAttribute('data-dragging', 'true')
    fireEvent.pointerMove(handle, { clientX: 240, pointerId: 1 })
    expect(handle).toHaveAttribute('aria-valuenow', '60')
    fireEvent.pointerUp(handle, { pointerId: 1 })
    expect(handle).not.toHaveAttribute('data-dragging')
    expect(onResizeEnd).toHaveBeenCalledWith([60, 40])
  })

  it('accepts a custom handle label', () => {
    render(
      <Splitter handleLabel="Resize list">
        <SplitterPanel>A</SplitterPanel>
        <SplitterPanel>B</SplitterPanel>
      </Splitter>,
    )
    expect(screen.getByRole('separator', { name: 'Resize list' })).toBeInTheDocument()
  })
})
