/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { render, screen, within } from '@testing-library/react'
import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  BreadcrumbStatic,
} from '../breadcrumb'

describe('Breadcrumb primitive', () => {
  it('renders a <nav> with aria-label="Breadcrumb"', () => {
    render(
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbPage>Home</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>,
    )
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(nav).toBeInTheDocument()
    expect(nav).toHaveAttribute('data-slot', 'breadcrumb')
    expect(nav).toHaveAttribute('data-divider', 'slash')
  })

  it('marks the last item with aria-current="page"', () => {
    render(
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/">Home</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Current</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>,
    )
    const current = screen.getByText('Current')
    expect(current).toHaveAttribute('aria-current', 'page')
    expect(current).toHaveAttribute('data-slot', 'breadcrumb-page')
  })

  it('renders <ol> for the list and <li> for items + separators', () => {
    render(
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/">Home</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Current</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>,
    )
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' })
    const list = within(nav).getByRole('list')
    expect(list.tagName).toBe('OL')
    const listItems = within(nav).getAllByRole('listitem')
    expect(listItems).toHaveLength(2)
  })

  it('renders slash separator by default', () => {
    render(
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/">Home</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Current</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>,
    )
    const separator = document.querySelector('[data-slot="breadcrumb-separator"]')!
    expect(separator).toHaveAttribute('aria-hidden', 'true')
    expect(separator).toHaveAttribute('data-divider', 'slash')
    expect(separator.textContent).toContain('/')
  })

  it('renders arrow separator (ChevronRight svg) when divider="arrow"', () => {
    render(
      <Breadcrumb divider="arrow">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/">Home</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Current</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>,
    )
    const separator = document.querySelector('[data-slot="breadcrumb-separator"]')!
    expect(separator).toHaveAttribute('data-divider', 'arrow')
    expect(separator.querySelector('svg')).not.toBeNull()
  })

  it('renders dot separator when divider="dot"', () => {
    render(
      <Breadcrumb divider="dot">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/">Home</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Current</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>,
    )
    const separator = document.querySelector('[data-slot="breadcrumb-separator"]')!
    expect(separator).toHaveAttribute('data-divider', 'dot')
    expect(separator.textContent).toContain('·')
  })

  it('allows a per-separator divider override', () => {
    render(
      <Breadcrumb divider="slash">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/a">A</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator divider="arrow" data-testid="custom-sep" />
          <BreadcrumbItem>
            <BreadcrumbPage>B</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>,
    )
    const sep = screen.getByTestId('custom-sep')
    expect(sep).toHaveAttribute('data-divider', 'arrow')
    expect(sep.querySelector('svg')).not.toBeNull()
  })

  it('BreadcrumbLink renders an <a> with hover underline classes', () => {
    render(
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/customers">Customers</BreadcrumbLink>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>,
    )
    const link = screen.getByRole('link', { name: 'Customers' })
    expect(link.tagName).toBe('A')
    expect(link).toHaveAttribute('href', '/customers')
    expect(link.className).toContain('hover:text-foreground')
    expect(link.className).toContain('text-muted-foreground')
  })

  it('BreadcrumbLink with asChild slots the child element', () => {
    render(
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <a href="/people" data-testid="slotted">People</a>
            </BreadcrumbLink>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>,
    )
    const slotted = screen.getByTestId('slotted')
    expect(slotted.tagName).toBe('A')
    expect(slotted).toHaveAttribute('href', '/people')
    expect(slotted).toHaveAttribute('data-slot', 'breadcrumb-link')
    expect(slotted.className).toContain('hover:text-foreground')
  })

  it('BreadcrumbLink renders icon children alongside the label', () => {
    render(
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/">
              <span data-testid="home-icon">H</span>
              Home
            </BreadcrumbLink>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>,
    )
    const link = screen.getByRole('link', { name: 'H Home' })
    expect(within(link).getByTestId('home-icon')).toBeInTheDocument()
  })

  it('BreadcrumbLink asChild preserves aria-label on the slotted icon-only anchor', () => {
    render(
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild aria-label="Dashboard">
              <a href="/backend" data-testid="home-link">
                <svg data-testid="home-svg" />
              </a>
            </BreadcrumbLink>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>,
    )
    const link = screen.getByRole('link', { name: 'Dashboard' })
    expect(link).toHaveAttribute('href', '/backend')
    expect(link).toHaveAttribute('data-slot', 'breadcrumb-link')
    expect(within(link).getByTestId('home-svg')).toBeInTheDocument()
  })

  it('BreadcrumbList renders nothing when it has no children', () => {
    const { container } = render(
      <Breadcrumb>
        <BreadcrumbList>{null}</BreadcrumbList>
      </Breadcrumb>,
    )
    expect(container.querySelector('ol')).toBeNull()
  })

  it('BreadcrumbLink default classes include truncate and a viewport-bounded max-width', () => {
    render(
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/products">Products</BreadcrumbLink>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>,
    )
    const link = screen.getByRole('link', { name: 'Products' })
    expect(link.className).toContain('truncate')
    expect(link.className).toContain('max-w-[40vw]')
    expect(link.className).toContain('md:max-w-[28vw]')
  })

  it('BreadcrumbLink forwards the title attribute for native tooltip on truncated labels', () => {
    render(
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/x" title="A very long category name that overflows">
              A very long category name that overflows
            </BreadcrumbLink>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>,
    )
    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('title', 'A very long category name that overflows')
  })

  it('BreadcrumbStatic renders muted text without aria-current or cursor affordance', () => {
    render(
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbStatic>Settings</BreadcrumbStatic>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>,
    )
    const node = screen.getByText('Settings')
    expect(node).toHaveAttribute('data-slot', 'breadcrumb-static')
    expect(node).not.toHaveAttribute('aria-current')
    expect(node.className).toContain('text-muted-foreground')
    expect(node.className).toContain('select-none')
  })

  it('BreadcrumbEllipsis renders MoreHorizontal icon and an sr-only label', () => {
    render(
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbEllipsis />
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>,
    )
    const ellipsis = document.querySelector('[data-slot="breadcrumb-ellipsis"]')!
    expect(ellipsis).toBeInTheDocument()
    expect(ellipsis.querySelector('svg')).not.toBeNull()
    expect(ellipsis.textContent).toContain('More')
  })
})
