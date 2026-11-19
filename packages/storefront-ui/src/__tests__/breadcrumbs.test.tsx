import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { Breadcrumbs } from '../primitives/breadcrumbs'

const items = [{ label: 'Home', href: '/' }, { label: 'Coffee' }]

describe('Breadcrumbs', () => {
  it('marks the last item as the current page', () => {
    render(<Breadcrumbs label="Breadcrumb" items={items} />)
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeInTheDocument()
    expect(screen.getByText('Coffee')).toHaveAttribute('aria-current', 'page')
    expect(screen.getByText('Coffee')).toHaveClass('text-foreground')
  })

  it('switches to primary-foreground colours on a primary surface', () => {
    render(<Breadcrumbs label="Breadcrumb" items={items} tone="inverse" />)
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveClass('text-primary-foreground/80')
    expect(screen.getByText('Coffee')).toHaveClass('text-primary-foreground')
    expect(screen.getByText('Coffee')).not.toHaveClass('text-foreground')
  })

  it('shows only the parents when the title below would repeat the current page', () => {
    render(<Breadcrumbs label="Breadcrumb" items={items} showCurrent={false} />)
    expect(screen.getByRole('link', { name: 'Home' })).toBeInTheDocument()
    expect(screen.queryByText('Coffee')).not.toBeInTheDocument()
  })
})
