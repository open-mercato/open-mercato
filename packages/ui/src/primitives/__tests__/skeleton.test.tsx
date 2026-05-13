/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { Skeleton } from '../skeleton'

describe('Skeleton primitive', () => {
  it('renders a single rect placeholder by default', () => {
    const { container } = render(<Skeleton className="h-8 w-32" />)
    const root = container.querySelector('[data-slot="skeleton"]')
    expect(root).toBeInTheDocument()
    expect(root!.className).toContain('animate-pulse')
    expect(root!.className).toContain('bg-muted')
    expect(root!.className).toContain('rounded-md')
    expect(root!.className).toContain('h-8')
    expect(root!.className).toContain('w-32')
  })

  it('shape="circle" renders a rounded-full placeholder', () => {
    const { container } = render(<Skeleton shape="circle" className="size-10" />)
    const root = container.querySelector('[data-slot="skeleton"]')
    expect(root!.className).toContain('rounded-full')
    expect(root!.className).toContain('animate-pulse')
  })

  it('shape="text" with default lines renders one h-4 line', () => {
    const { container } = render(<Skeleton shape="text" />)
    const root = container.querySelector('[data-slot="skeleton"]')
    expect(root).toBeInTheDocument()
    const lines = root!.querySelectorAll('div')
    expect(lines.length).toBe(1)
    expect(lines[0].className).toContain('h-4')
    expect(lines[0].className).toContain('w-full')
  })

  it('shape="text" with lines={3} renders 3 lines and shortens the last one', () => {
    const { container } = render(<Skeleton shape="text" lines={3} />)
    const root = container.querySelector('[data-slot="skeleton"]')
    const lines = root!.querySelectorAll('div')
    expect(lines.length).toBe(3)
    expect(lines[0].className).toContain('w-full')
    expect(lines[1].className).toContain('w-full')
    expect(lines[2].className).toContain('w-3/4')
  })

  it('clamps lines to at least 1', () => {
    const { container } = render(<Skeleton shape="text" lines={0} />)
    const root = container.querySelector('[data-slot="skeleton"]')
    const lines = root!.querySelectorAll('div')
    expect(lines.length).toBe(1)
  })

  it('exposes role="status" + aria-busy for accessibility', () => {
    render(<Skeleton aria-label="Loading user profile" />)
    const root = screen.getByRole('status', { name: 'Loading user profile' })
    expect(root).toHaveAttribute('aria-busy', 'true')
  })

  it('forwards arbitrary HTML props (data-*, id, etc.)', () => {
    const { container } = render(
      <Skeleton id="loader-1" data-testid="my-loader" className="h-8" />,
    )
    const root = container.querySelector('#loader-1')
    expect(root).not.toBeNull()
    expect(root).toHaveAttribute('data-testid', 'my-loader')
  })

  it('text variant exposes role="status" on the wrapper, not on each line', () => {
    const { container } = render(<Skeleton shape="text" lines={2} aria-label="Loading copy" />)
    const wrappers = container.querySelectorAll('[role="status"]')
    expect(wrappers.length).toBe(1)
    expect(wrappers[0]).toHaveAttribute('aria-label', 'Loading copy')
  })
})
