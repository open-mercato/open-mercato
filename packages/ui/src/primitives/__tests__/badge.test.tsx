/** @jest-environment jsdom */

import * as React from 'react'
import { render, fireEvent } from '@testing-library/react'

import { Badge } from '../badge'

describe('Badge (Phase B.8)', () => {
  it('renders the badge root with data-slot + default variant + default size', () => {
    const { container } = render(<Badge>Active</Badge>)
    const root = container.querySelector('[data-slot="badge"]') as HTMLElement
    expect(root).not.toBeNull()
    expect(root.getAttribute('data-variant')).toBe('default')
    expect(root.getAttribute('data-size')).toBe('default')
    expect(root.textContent).toBe('Active')
    expect(root.className).toContain('bg-primary')
    expect(root.className).toContain('rounded-full')
  })

  it('renders all 10 pre-existing variants verbatim (backward compat for 83 import sites)', () => {
    const cases: Array<{
      variant: 'default' | 'secondary' | 'destructive' | 'outline' | 'muted' | 'success' | 'warning' | 'info' | 'neutral' | 'error'
      cls: string
    }> = [
      { variant: 'default', cls: 'bg-primary' },
      { variant: 'secondary', cls: 'bg-secondary' },
      // destructive stays solid loud (bg-destructive) per BC guarantee
      // in spec 2026-05-13-ds-foundation-v5.md. Soft error-tinted look
      // is the new `error` variant below.
      { variant: 'destructive', cls: 'bg-destructive' },
      { variant: 'outline', cls: 'text-foreground' },
      { variant: 'muted', cls: 'bg-muted' },
      { variant: 'success', cls: 'bg-status-success-bg' },
      { variant: 'warning', cls: 'bg-status-warning-bg' },
      { variant: 'info', cls: 'bg-status-info-bg' },
      { variant: 'neutral', cls: 'bg-status-neutral-bg' },
      { variant: 'error', cls: 'bg-status-error-bg' },
    ]
    for (const { variant, cls } of cases) {
      const { container, unmount } = render(<Badge variant={variant}>x</Badge>)
      const root = container.querySelector('[data-slot="badge"]') as HTMLElement
      expect(root.getAttribute('data-variant')).toBe(variant)
      expect(root.className).toContain(cls)
      unmount()
    }
  })

  it('adds the brand variant per Tag brand-violet pattern', () => {
    const { container } = render(<Badge variant="brand">Q1 2026</Badge>)
    const root = container.querySelector('[data-slot="badge"]') as HTMLElement
    expect(root.getAttribute('data-variant')).toBe('brand')
    expect(root.className).toContain('bg-brand-violet/10')
    expect(root.className).toContain('text-brand-violet')
    expect(root.className).toContain('border-brand-violet/30')
  })

  it('applies size variants (sm / default / lg)', () => {
    const cases: Array<{ size: 'sm' | 'default' | 'lg'; cls: string }> = [
      { size: 'sm', cls: 'text-[10px]' },
      { size: 'default', cls: 'text-xs' },
      { size: 'lg', cls: 'text-sm' },
    ]
    for (const { size, cls } of cases) {
      const { container, unmount } = render(<Badge size={size}>x</Badge>)
      const root = container.querySelector('[data-slot="badge"]') as HTMLElement
      expect(root.getAttribute('data-size')).toBe(size)
      expect(root.className).toContain(cls)
      unmount()
    }
  })

  it('renders the leading dot when dot=true with the variant tone', () => {
    const { container } = render(
      <Badge variant="success" dot>
        Active
      </Badge>,
    )
    const dot = container.querySelector('[data-slot="badge-dot"]') as HTMLElement
    expect(dot).not.toBeNull()
    expect(dot.className).toContain('bg-status-success-icon')
    expect(dot.className).toContain('rounded-full')
    expect(dot.className).toContain('size-1.5')
  })

  it('omits the dot by default', () => {
    const { container } = render(<Badge variant="success">No dot</Badge>)
    expect(container.querySelector('[data-slot="badge-dot"]')).toBeNull()
  })

  it('dot tone matches each variant', () => {
    const cases: Array<{ variant: 'success' | 'warning' | 'info' | 'error' | 'brand'; cls: string }> = [
      { variant: 'success', cls: 'bg-status-success-icon' },
      { variant: 'warning', cls: 'bg-status-warning-icon' },
      { variant: 'info', cls: 'bg-status-info-icon' },
      { variant: 'error', cls: 'bg-status-error-icon' },
      { variant: 'brand', cls: 'bg-brand-violet' },
    ]
    for (const { variant, cls } of cases) {
      const { container, unmount } = render(
        <Badge variant={variant} dot>
          x
        </Badge>,
      )
      const dot = container.querySelector('[data-slot="badge-dot"]') as HTMLElement
      expect(dot.className).toContain(cls)
      unmount()
    }
  })

  it('dot size scales with badge size (sm/default = size-1.5, lg = size-2)', () => {
    const { container, rerender } = render(
      <Badge variant="info" size="sm" dot>
        x
      </Badge>,
    )
    let dot = container.querySelector('[data-slot="badge-dot"]') as HTMLElement
    expect(dot.className).toContain('size-1.5')

    rerender(
      <Badge variant="info" size="default" dot>
        x
      </Badge>,
    )
    dot = container.querySelector('[data-slot="badge-dot"]') as HTMLElement
    expect(dot.className).toContain('size-1.5')

    rerender(
      <Badge variant="info" size="lg" dot>
        x
      </Badge>,
    )
    dot = container.querySelector('[data-slot="badge-dot"]') as HTMLElement
    expect(dot.className).toContain('size-2')
  })

  it('renders the remove button when removable=true and fires onRemove on click', () => {
    const onRemove = jest.fn()
    const { container } = render(
      <Badge variant="info" removable onRemove={onRemove}>
        Tag
      </Badge>,
    )
    const remove = container.querySelector('[data-slot="badge-remove"]') as HTMLButtonElement
    expect(remove).not.toBeNull()
    expect(remove.getAttribute('aria-label')).toBe('Remove')
    fireEvent.click(remove)
    expect(onRemove).toHaveBeenCalledTimes(1)
  })

  it('omits the remove button by default', () => {
    const { container } = render(<Badge>x</Badge>)
    expect(container.querySelector('[data-slot="badge-remove"]')).toBeNull()
  })

  it('honors removeAriaLabel override', () => {
    const { container } = render(
      <Badge removable onRemove={() => {}} removeAriaLabel="Remove tag">
        x
      </Badge>,
    )
    const remove = container.querySelector('[data-slot="badge-remove"]') as HTMLButtonElement
    expect(remove.getAttribute('aria-label')).toBe('Remove tag')
  })

  it('combines dot + removable + size=lg without conflict', () => {
    const { container } = render(
      <Badge variant="error" size="lg" dot removable onRemove={() => {}}>
        Blocked
      </Badge>,
    )
    expect(container.querySelector('[data-slot="badge-dot"]')).not.toBeNull()
    expect(container.querySelector('[data-slot="badge-remove"]')).not.toBeNull()
    const root = container.querySelector('[data-slot="badge"]') as HTMLElement
    expect(root.textContent).toBe('Blocked')
    expect(root.className).toContain('text-sm') // size=lg
  })

  it('forwards className without dropping variant or size classes', () => {
    const { container } = render(
      <Badge variant="success" size="lg" className="custom-class">
        x
      </Badge>,
    )
    const root = container.querySelector('[data-slot="badge"]') as HTMLElement
    expect(root.className).toContain('custom-class')
    expect(root.className).toContain('bg-status-success-bg')
    expect(root.className).toContain('text-sm')
  })
})
