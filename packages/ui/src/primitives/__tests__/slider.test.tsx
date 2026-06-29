/** @jest-environment jsdom */

import * as React from 'react'
import { render } from '@testing-library/react'
import { Slider } from '../slider'

describe('Slider', () => {
  it('renders a single thumb when value has one entry', () => {
    const { container } = render(<Slider value={[42]} onValueChange={() => {}} />)
    expect(container.querySelectorAll('[data-slot="slider-thumb"]').length).toBe(1)
    expect(container.querySelector('[data-slot="slider-root"]')).not.toBeNull()
    expect(container.querySelector('[data-slot="slider-track"]')).not.toBeNull()
    expect(container.querySelector('[data-slot="slider-range"]')).not.toBeNull()
  })

  it('renders two thumbs when value has two entries (range mode)', () => {
    const { container } = render(<Slider value={[10, 80]} onValueChange={() => {}} />)
    expect(container.querySelectorAll('[data-slot="slider-thumb"]').length).toBe(2)
  })

  it('falls back to a single thumb when only defaultValue is provided', () => {
    const { container } = render(<Slider defaultValue={[30]} />)
    expect(container.querySelectorAll('[data-slot="slider-thumb"]').length).toBe(1)
  })

  it('respects defaultValue with two entries (uncontrolled range)', () => {
    const { container } = render(<Slider defaultValue={[20, 70]} />)
    expect(container.querySelectorAll('[data-slot="slider-thumb"]').length).toBe(2)
  })

  it('exposes role="slider" with min/max/value via Radix', () => {
    const { container } = render(
      <Slider value={[25]} onValueChange={() => {}} min={0} max={100} step={1} />,
    )
    const thumb = container.querySelector('[role="slider"]')
    expect(thumb).not.toBeNull()
    expect(thumb?.getAttribute('aria-valuemin')).toBe('0')
    expect(thumb?.getAttribute('aria-valuemax')).toBe('100')
    expect(thumb?.getAttribute('aria-valuenow')).toBe('25')
  })

  it('applies horizontal-orientation classes by default', () => {
    const { container } = render(<Slider value={[10]} onValueChange={() => {}} />)
    const root = container.querySelector('[data-slot="slider-root"]') as HTMLElement
    expect(root.className).toContain('h-5')
    expect(root.className).not.toContain('flex-col')
    const track = container.querySelector('[data-slot="slider-track"]') as HTMLElement
    expect(track.className).toContain('h-1.5')
    expect(track.className).toContain('w-full')
  })

  it('applies vertical-orientation classes when orientation="vertical"', () => {
    const { container } = render(
      <Slider value={[10]} onValueChange={() => {}} orientation="vertical" />,
    )
    const root = container.querySelector('[data-slot="slider-root"]') as HTMLElement
    expect(root.className).toContain('flex-col')
    expect(root.className).toContain('w-5')
    const track = container.querySelector('[data-slot="slider-track"]') as HTMLElement
    expect(track.className).toContain('w-1.5')
    expect(track.className).toContain('h-full')
  })

  it('propagates disabled state to the root data attribute', () => {
    const { container } = render(<Slider value={[10]} onValueChange={() => {}} disabled />)
    const root = container.querySelector('[data-slot="slider-root"]') as HTMLElement
    expect(root.getAttribute('data-disabled')).not.toBeNull()
  })

  it('forwards className without dropping orientation classes', () => {
    const { container } = render(
      <Slider value={[10]} onValueChange={() => {}} className="custom-class" />,
    )
    const root = container.querySelector('[data-slot="slider-root"]') as HTMLElement
    expect(root.className).toContain('custom-class')
    expect(root.className).toContain('h-5')
    expect(root.className).toContain('touch-none')
  })

  it('forwards ref to the root element', () => {
    const ref = React.createRef<HTMLSpanElement>()
    render(<Slider ref={ref} value={[10]} onValueChange={() => {}} />)
    expect(ref.current).not.toBeNull()
    expect(ref.current?.getAttribute('data-slot')).toBe('slider-root')
  })
})
