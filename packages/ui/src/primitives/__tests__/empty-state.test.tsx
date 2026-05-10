/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { EmptyState } from '../empty-state'

describe('EmptyState primitive', () => {
  it('renders the title', () => {
    render(<EmptyState title="No results" />)
    expect(screen.getByText('No results')).toBeInTheDocument()
  })

  it('renders description when provided', () => {
    render(<EmptyState title="Empty" description="Try adjusting filters" />)
    expect(screen.getByText('Try adjusting filters')).toBeInTheDocument()
  })

  it('renders an icon when provided', () => {
    const Icon = () => <svg data-testid="empty-icon" />
    render(<EmptyState title="None" icon={<Icon />} />)
    expect(screen.getByTestId('empty-icon')).toBeInTheDocument()
  })

  it('renders custom actions ReactNode when provided', () => {
    render(
      <EmptyState
        title="Empty"
        actions={<button type="button">Custom action</button>}
      />,
    )
    expect(screen.getByRole('button', { name: 'Custom action' })).toBeInTheDocument()
  })

  it('renders the legacy action object as a default outline button', () => {
    const onClick = jest.fn()
    render(
      <EmptyState
        title="Empty"
        action={{ label: 'Add item', onClick }}
      />,
    )
    const button = screen.getByRole('button', { name: /Add item/i })
    expect(button).toBeInTheDocument()
    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('renders legacy actionLabel + onAction as a button (BC for old backend EmptyState)', () => {
    const onAction = jest.fn()
    render(
      <EmptyState title="Empty" actionLabel="Create" onAction={onAction} />,
    )
    const button = screen.getByRole('button', { name: /Create/i })
    fireEvent.click(button)
    expect(onAction).toHaveBeenCalledTimes(1)
  })

  it('prefers actions over legacy action when both are provided', () => {
    render(
      <EmptyState
        title="Empty"
        actions={<button type="button">Primary</button>}
        action={{ label: 'Legacy', onClick: () => {} }}
      />,
    )
    expect(screen.getByRole('button', { name: 'Primary' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Legacy/i })).not.toBeInTheDocument()
  })

  it('default variant renders dashed border + bg-muted/30', () => {
    const { container } = render(<EmptyState title="Default" />)
    const root = container.querySelector('[data-slot="empty-state"]')
    expect(root!.className).toContain('border-dashed')
    expect(root!.className).toContain('bg-muted/30')
  })

  it('subtle variant has no border and no muted background', () => {
    const { container } = render(<EmptyState title="Subtle" variant="subtle" />)
    const root = container.querySelector('[data-slot="empty-state"]')
    expect(root!.className).not.toContain('border-dashed')
    expect(root!.className).not.toContain('bg-muted/30')
  })

  it('subtle variant wraps icon in a square muted box', () => {
    const Icon = () => <svg data-testid="boxed-icon" />
    const { container } = render(
      <EmptyState title="Subtle" variant="subtle" icon={<Icon />} />,
    )
    const iconWrapper = container.querySelector('[data-slot="empty-state"] > div')
    expect(iconWrapper!.className).toContain('bg-muted')
    expect(iconWrapper!.className).toContain('rounded-lg')
  })

  it('size variants apply correct padding tokens', () => {
    const { container: sm } = render(<EmptyState title="X" size="sm" />)
    expect(sm.querySelector('[data-slot="empty-state"]')!.className).toContain('py-6')

    const { container: dft } = render(<EmptyState title="X" />)
    expect(dft.querySelector('[data-slot="empty-state"]')!.className).toContain('py-10')

    const { container: lg } = render(<EmptyState title="X" size="lg" />)
    expect(lg.querySelector('[data-slot="empty-state"]')!.className).toContain('py-16')
  })

  it('forwards className to the root element', () => {
    const { container } = render(
      <EmptyState title="Empty" className="custom-class" />,
    )
    expect(container.querySelector('[data-slot="empty-state"]')!.className).toContain('custom-class')
  })

  it('renders children between description and actions', () => {
    render(
      <EmptyState
        title="Empty"
        description="No items"
      >
        <p data-testid="custom-child">Extra content</p>
      </EmptyState>,
    )
    expect(screen.getByTestId('custom-child')).toBeInTheDocument()
  })
})
