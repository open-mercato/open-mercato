/** @jest-environment jsdom */

import * as React from 'react'
import { render } from '@testing-library/react'
import {
  ScrollArea,
  ScrollAreaRoot,
  ScrollAreaViewport,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaCorner,
} from '../scroll-area'

// NOTE: Radix ScrollArea defers scrollbar / corner rendering until the viewport
// reports overflow via layout measurements. jsdom does not implement layout,
// so scrollbars are not mounted in these tests. The assertions below cover
// the primitive's own surface area (root + viewport + className/ref
// forwarding + exported sub-components). Scrollbar visual behaviour belongs
// to Radix's own test suite.

describe('ScrollArea', () => {
  it('renders children inside the viewport', () => {
    const { getByText, container } = render(
      <ScrollArea className="h-32">
        <div>Scrollable content</div>
      </ScrollArea>,
    )
    expect(getByText('Scrollable content')).toBeInTheDocument()
    const viewport = container.querySelector('[data-slot="scroll-area-viewport"]')
    expect(viewport).not.toBeNull()
    expect(viewport?.textContent).toContain('Scrollable content')
  })

  it('forwards className to the root element', () => {
    const { container } = render(
      <ScrollArea className="custom-class h-32">
        <div>content</div>
      </ScrollArea>,
    )
    const root = container.querySelector('[data-slot="scroll-area-root"]')
    expect(root).not.toBeNull()
    expect(root?.className).toContain('custom-class')
    expect(root?.className).toContain('h-32')
    expect(root?.className).toContain('relative')
    expect(root?.className).toContain('overflow-hidden')
  })

  it('forwards viewportClassName to the viewport', () => {
    const { container } = render(
      <ScrollArea className="h-32" viewportClassName="custom-viewport">
        <div>content</div>
      </ScrollArea>,
    )
    const viewport = container.querySelector('[data-slot="scroll-area-viewport"]')
    expect(viewport?.className).toContain('custom-viewport')
    expect(viewport?.className).toContain('h-full')
    expect(viewport?.className).toContain('w-full')
  })

  it('forwards ref to the root element', () => {
    const ref = React.createRef<HTMLDivElement>()
    render(
      <ScrollArea ref={ref} className="h-32">
        <div>content</div>
      </ScrollArea>,
    )
    expect(ref.current).not.toBeNull()
    expect(ref.current?.getAttribute('data-slot')).toBe('scroll-area-root')
  })

  it('accepts dir, type, and other Radix Root passthrough props without error', () => {
    expect(() => {
      render(
        <ScrollArea className="h-32" dir="rtl" type="always">
          <div>content</div>
        </ScrollArea>,
      )
    }).not.toThrow()
  })

  it('exposes compound sub-components for custom composition', () => {
    // The convenience `<ScrollArea>` wrapper covers the 90% case; reaching for
    // the lower-level primitives must stay possible for callers that need
    // conditional scrollbars, a custom viewport, or a custom corner element.
    const { container, getByText } = render(
      <ScrollAreaRoot className="h-32">
        <ScrollAreaViewport>
          <div>custom composition</div>
        </ScrollAreaViewport>
        <ScrollAreaScrollbar orientation="vertical">
          <ScrollAreaThumb />
        </ScrollAreaScrollbar>
        <ScrollAreaCorner />
      </ScrollAreaRoot>,
    )
    expect(getByText('custom composition')).toBeInTheDocument()
    expect(container.querySelector('[data-slot="scroll-area-root"]')).not.toBeNull()
    expect(container.querySelector('[data-slot="scroll-area-viewport"]')).not.toBeNull()
  })

  it('exports every sub-component as a referenceable React component', () => {
    // Guards against accidental removal of the compound API exports.
    expect(typeof ScrollAreaRoot).toBe('object')
    expect(typeof ScrollAreaViewport).toBe('object')
    expect(typeof ScrollAreaScrollbar).toBe('object')
    expect(typeof ScrollAreaThumb).toBe('object')
    expect(typeof ScrollAreaCorner).toBe('object')
  })
})
