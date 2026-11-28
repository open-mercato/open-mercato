/** @jest-environment jsdom */

import * as React from 'react'
import { render } from '@testing-library/react'

import { BorderBeam, borderBeamGradient, resolveBorderBeamItems } from '../border-beam'

function beams(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-slot="border-beam-beam"]'))
}

describe('BorderBeam', () => {
  const originalMatchMedia = window.matchMedia
  let animate: jest.Mock

  beforeEach(() => {
    animate = jest.fn(() => ({ cancel: jest.fn() }))
    Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, writable: true, value: animate })
    window.matchMedia = jest.fn().mockReturnValue({ matches: false })
  })

  afterEach(() => {
    delete (HTMLElement.prototype as { animate?: unknown }).animate
    window.matchMedia = originalMatchMedia
  })

  it('wraps content and hides the decorative layer from assistive technology', () => {
    const { container, getByText } = render(<BorderBeam className="rounded-card">Content</BorderBeam>)
    const root = container.querySelector('[data-slot="border-beam"]') as HTMLElement
    expect(getByText('Content')).toBeInTheDocument()
    expect(root.className).toContain('relative')
    expect(root.className).toContain('rounded-card')
    const layer = container.querySelector('[data-slot="border-beam-beams"]') as HTMLElement
    expect(layer.getAttribute('aria-hidden')).toBe('true')
    expect(layer.className).toContain('pointer-events-none')
    expect(container.querySelector('[data-slot="border-beam-layer"]')?.className).toContain('motion-reduce:hidden')
  })

  it('renders evenly phased beams from count', () => {
    const { container } = render(<BorderBeam count={4}>x</BorderBeam>)
    expect(beams(container)).toHaveLength(4)
    expect(animate).toHaveBeenCalledTimes(4)
    const delays = animate.mock.calls.map(([, options]) => (options as KeyframeAnimationOptions).delay)
    expect(delays).toEqual([-0, -1500, -3000, -4500])
  })

  it('lets items override count and top-level settings', () => {
    const { container } = render(
      <BorderBeam count={5} size={80} lineWidth={2} items={[{ color: 'var(--primary)' }, { size: 40, lineWidth: '3px' }]}>x</BorderBeam>,
    )
    const rendered = beams(container)
    expect(rendered).toHaveLength(2)
    expect(rendered[0].style.width).toBe('80px')
    expect(rendered[1].style.width).toBe('40px')
    const layers = container.querySelectorAll<HTMLElement>('[data-slot="border-beam-layer"]')
    expect(layers[0].style.borderWidth).toBe('2px')
    expect(layers[1].style.borderWidth).toBe('3px')
  })

  it('uses the duration for one loop', () => {
    render(<BorderBeam duration={3}>x</BorderBeam>)
    expect((animate.mock.calls[0][1] as KeyframeAnimationOptions).duration).toBe(3000)
  })

  it('does not animate when the user prefers reduced motion', () => {
    window.matchMedia = jest.fn().mockReturnValue({ matches: true })
    render(<BorderBeam>x</BorderBeam>)
    expect(animate).not.toHaveBeenCalled()
  })

  it('shows the beams only on hover or focus with trigger="hover"', () => {
    const { container } = render(<BorderBeam trigger="hover">x</BorderBeam>)
    const layer = container.querySelector('[data-slot="border-beam-beams"]') as HTMLElement
    expect(layer.className).toContain('opacity-0')
    expect(layer.className).toContain('group-hover/border-beam:opacity-100')
    expect(layer.className).toContain('group-focus-within/border-beam:opacity-100')
  })

  it('draws inside the child with asChild', () => {
    const { container } = render(
      <BorderBeam asChild>
        <section className="rounded-card" data-testid="card">Card</section>
      </BorderBeam>,
    )
    const section = container.querySelector('section') as HTMLElement
    expect(section.getAttribute('data-slot')).toBe('border-beam')
    expect(section.className).toContain('relative')
    expect(section.querySelector('[data-slot="border-beam-beams"]')).not.toBeNull()
    expect(container.querySelector('div[data-slot="border-beam"]')).toBeNull()
  })

  it('builds a gradient with a transparent tail', () => {
    expect(borderBeamGradient('red')).toBe('linear-gradient(to right, transparent, red)')
    expect(borderBeamGradient([{ color: 'blue', percent: 100 }, { color: 'red', percent: 0 }])).toBe(
      'linear-gradient(to right, transparent, red 20%, blue 100%)',
    )
  })

  it('falls back to one beam for invalid counts', () => {
    expect(resolveBorderBeamItems(0, undefined)).toHaveLength(1)
    expect(resolveBorderBeamItems(2.5, undefined)).toHaveLength(1)
    expect(resolveBorderBeamItems(3, [])).toHaveLength(3)
  })
})
