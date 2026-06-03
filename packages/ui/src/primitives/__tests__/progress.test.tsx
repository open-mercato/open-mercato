/** @jest-environment jsdom */

import * as React from 'react'
import { render } from '@testing-library/react'

import { Progress, CircularProgress } from '../progress'

describe('Progress (linear)', () => {
  it('renders bar role + aria attrs with computed percentage width', () => {
    const { container } = render(<Progress value={42} />)
    const bar = container.querySelector('[data-slot="progress"]') as HTMLElement
    expect(bar).not.toBeNull()
    expect(bar.getAttribute('role')).toBe('progressbar')
    expect(bar.getAttribute('aria-valuenow')).toBe('42')
    expect(bar.getAttribute('aria-valuemin')).toBe('0')
    expect(bar.getAttribute('aria-valuemax')).toBe('100')
    const fill = bar.querySelector('[data-slot="progress-fill"]') as HTMLElement
    expect(fill).not.toBeNull()
    expect(fill.style.width).toBe('42%')
  })

  it('clamps value to [0, max]', () => {
    const { container, rerender } = render(<Progress value={-50} />)
    let fill = container.querySelector('[data-slot="progress-fill"]') as HTMLElement
    expect(fill.style.width).toBe('0%')
    rerender(<Progress value={250} max={100} />)
    fill = container.querySelector('[data-slot="progress-fill"]') as HTMLElement
    expect(fill.style.width).toBe('100%')
  })

  it('honors custom max', () => {
    const { container } = render(<Progress value={5} max={10} />)
    const fill = container.querySelector('[data-slot="progress-fill"]') as HTMLElement
    expect(fill.style.width).toBe('50%')
    const bar = container.querySelector('[data-slot="progress"]') as HTMLElement
    expect(bar.getAttribute('aria-valuemax')).toBe('10')
  })

  it('applies size variant classes', () => {
    const { container, rerender } = render(<Progress value={50} />)
    let bar = container.querySelector('[data-slot="progress"]') as HTMLElement
    expect(bar.className).toContain('h-2')

    rerender(<Progress value={50} size="sm" />)
    bar = container.querySelector('[data-slot="progress"]') as HTMLElement
    expect(bar.className).toContain('h-1')

    rerender(<Progress value={50} size="lg" />)
    bar = container.querySelector('[data-slot="progress"]') as HTMLElement
    expect(bar.className).toContain('h-3')
  })

  it('applies tone variant classes to the fill', () => {
    const cases: Array<{ tone: 'accent' | 'success' | 'warning' | 'destructive' | 'muted'; cls: string }> = [
      { tone: 'accent', cls: 'bg-accent-indigo' },
      { tone: 'success', cls: 'bg-status-success-icon' },
      { tone: 'warning', cls: 'bg-status-warning-icon' },
      { tone: 'destructive', cls: 'bg-status-error-icon' },
      { tone: 'muted', cls: 'bg-muted-foreground' },
    ]
    for (const { tone, cls } of cases) {
      const { container, unmount } = render(<Progress value={50} tone={tone} />)
      const fill = container.querySelector('[data-slot="progress-fill"]') as HTMLElement
      expect(fill.className).toContain(cls)
      const bar = container.querySelector('[data-slot="progress"]') as HTMLElement
      expect(bar.getAttribute('data-tone')).toBe(tone)
      unmount()
    }
  })

  it('renders the label + value row when `label` is provided and showValue=true', () => {
    const { container } = render(
      <Progress value={80} label="Data Storage" showValue description="Upgrade to unlock more." />,
    )
    expect(container.querySelector('[data-slot="progress-wrapper"]')).not.toBeNull()
    const label = container.querySelector('[data-slot="progress-label"]') as HTMLElement
    expect(label.textContent).toBe('Data Storage')
    const value = container.querySelector('[data-slot="progress-value"]') as HTMLElement
    expect(value.textContent).toBe('80%')
    const description = container.querySelector('[data-slot="progress-description"]') as HTMLElement
    expect(description.textContent).toBe('Upgrade to unlock more.')
  })

  it('omits the label row entirely when no label/showValue/description is set', () => {
    const { container } = render(<Progress value={50} />)
    expect(container.querySelector('[data-slot="progress-wrapper"]')).toBeNull()
    expect(container.querySelector('[data-slot="progress-label"]')).toBeNull()
    expect(container.querySelector('[data-slot="progress-value"]')).toBeNull()
    expect(container.querySelector('[data-slot="progress-description"]')).toBeNull()
  })

  it('renders showValue alone (no label) — empty label slot stays in place for layout', () => {
    const { container } = render(<Progress value={42} showValue />)
    expect(container.querySelector('[data-slot="progress-wrapper"]')).not.toBeNull()
    const value = container.querySelector('[data-slot="progress-value"]') as HTMLElement
    expect(value.textContent).toBe('42%')
  })

  it('forwards className to the bar without dropping track classes', () => {
    const { container } = render(<Progress value={50} className="custom-class" />)
    const bar = container.querySelector('[data-slot="progress"]') as HTMLElement
    expect(bar.className).toContain('custom-class')
    expect(bar.className).toContain('rounded-full')
    expect(bar.className).toContain('bg-input')
  })

  it('forwards fillClassName to override the fill', () => {
    const { container } = render(
      <Progress value={50} fillClassName="custom-fill" />,
    )
    const fill = container.querySelector('[data-slot="progress-fill"]') as HTMLElement
    expect(fill.className).toContain('custom-fill')
    // Default tone class still applied (cn merges, doesn't replace).
    expect(fill.className).toContain('bg-accent-indigo')
  })
})

describe('CircularProgress', () => {
  it('renders an SVG with two concentric circles + aria attrs', () => {
    const { container } = render(<CircularProgress value={50} />)
    const root = container.querySelector('[data-slot="circular-progress"]') as HTMLElement
    expect(root).not.toBeNull()
    expect(root.getAttribute('role')).toBe('progressbar')
    expect(root.getAttribute('aria-valuenow')).toBe('50')
    expect(root.getAttribute('aria-valuemin')).toBe('0')
    expect(root.getAttribute('aria-valuemax')).toBe('100')
    expect(root.getAttribute('aria-label')).toBe('50%')
    const track = root.querySelector('[data-slot="circular-progress-track"]') as SVGCircleElement
    const fill = root.querySelector('[data-slot="circular-progress-fill"]') as SVGCircleElement
    expect(track).not.toBeNull()
    expect(fill).not.toBeNull()
  })

  it('computes stroke-dashoffset from percentage', () => {
    const { container } = render(<CircularProgress value={75} size="default" />)
    const fill = container.querySelector('[data-slot="circular-progress-fill"]') as SVGCircleElement
    // size="default": box=48, stroke=4, radius=22, circumference≈138.23, dashOffset≈34.56
    const dashArray = parseFloat(fill.getAttribute('stroke-dasharray') ?? '0')
    const dashOffset = parseFloat(fill.getAttribute('stroke-dashoffset') ?? '0')
    expect(dashArray).toBeCloseTo(2 * Math.PI * 22, 1)
    expect(dashOffset).toBeCloseTo(dashArray * 0.25, 1)
  })

  it('clamps value', () => {
    const { container, rerender } = render(<CircularProgress value={-10} />)
    let fill = container.querySelector('[data-slot="circular-progress-fill"]') as SVGCircleElement
    const dashArray = parseFloat(fill.getAttribute('stroke-dasharray') ?? '0')
    expect(parseFloat(fill.getAttribute('stroke-dashoffset') ?? '0')).toBeCloseTo(dashArray, 1)

    rerender(<CircularProgress value={500} max={100} />)
    fill = container.querySelector('[data-slot="circular-progress-fill"]') as SVGCircleElement
    expect(parseFloat(fill.getAttribute('stroke-dashoffset') ?? '0')).toBeCloseTo(0, 1)
  })

  it('renders the centre value badge when showValue=true', () => {
    const { container } = render(<CircularProgress value={42} showValue />)
    const valueLabel = container.querySelector(
      '[data-slot="circular-progress-value"]',
    ) as HTMLElement
    expect(valueLabel).not.toBeNull()
    expect(valueLabel.textContent).toBe('42%')
  })

  it('replaces the centre value with children when both are provided', () => {
    const { container } = render(
      <CircularProgress value={42} showValue>
        <span data-testid="custom-center">3/7</span>
      </CircularProgress>,
    )
    const valueLabel = container.querySelector(
      '[data-slot="circular-progress-value"]',
    ) as HTMLElement
    expect(valueLabel.querySelector('[data-testid="custom-center"]')).not.toBeNull()
    expect(valueLabel.textContent).toBe('3/7')
  })

  it('honors ariaLabel override', () => {
    const { container } = render(
      <CircularProgress value={50} ariaLabel="Sprint completion" />,
    )
    const root = container.querySelector('[data-slot="circular-progress"]') as HTMLElement
    expect(root.getAttribute('aria-label')).toBe('Sprint completion')
  })

  it('applies tone variant strokes', () => {
    const cases: Array<{ tone: 'accent' | 'success' | 'warning' | 'destructive' | 'muted'; cls: string }> = [
      { tone: 'accent', cls: 'stroke-accent-indigo' },
      { tone: 'success', cls: 'stroke-status-success-icon' },
      { tone: 'warning', cls: 'stroke-status-warning-icon' },
      { tone: 'destructive', cls: 'stroke-status-error-icon' },
      { tone: 'muted', cls: 'stroke-muted-foreground' },
    ]
    for (const { tone, cls } of cases) {
      const { container, unmount } = render(<CircularProgress value={50} tone={tone} />)
      const fill = container.querySelector(
        '[data-slot="circular-progress-fill"]',
      ) as SVGCircleElement
      expect(fill.getAttribute('class')).toContain(cls)
      const root = container.querySelector('[data-slot="circular-progress"]') as HTMLElement
      expect(root.getAttribute('data-tone')).toBe(tone)
      unmount()
    }
  })

  it('honors size variants (box dimensions)', () => {
    const cases: Array<{ size: 'xs' | 'sm' | 'default' | 'lg'; box: number }> = [
      { size: 'xs', box: 24 },
      { size: 'sm', box: 32 },
      { size: 'default', box: 48 },
      { size: 'lg', box: 64 },
    ]
    for (const { size, box } of cases) {
      const { container, unmount } = render(<CircularProgress value={50} size={size} />)
      const root = container.querySelector('[data-slot="circular-progress"]') as HTMLElement
      expect(root.getAttribute('data-size')).toBe(size)
      const svg = root.querySelector('svg') as SVGElement
      expect(svg.getAttribute('width')).toBe(String(box))
      expect(svg.getAttribute('height')).toBe(String(box))
      unmount()
    }
  })
})
