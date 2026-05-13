/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { Tag } from '../tag'

describe('Tag primitive', () => {
  it('renders default pill variant when no shape prop is given', () => {
    render(<Tag>Hello</Tag>)
    const root = screen.getByText('Hello').closest('[data-slot="tag"]')
    expect(root).not.toBeNull()
    expect(root!.className).toContain('rounded-full')
    expect(root!.className).toContain('border-border')
    expect(root).toHaveAttribute('data-shape', 'pill')
  })

  it('renders square shape with rounded-md when shape="square"', () => {
    render(<Tag shape="square">Berlin</Tag>)
    const root = screen.getByText('Berlin').closest('[data-slot="tag"]')
    expect(root!.className).toContain('rounded-md')
    expect(root!.className).not.toContain('rounded-full')
    expect(root).toHaveAttribute('data-shape', 'square')
  })

  it('applies status colour variants', () => {
    render(<Tag variant="success">OK</Tag>)
    const root = screen.getByText('OK').closest('[data-slot="tag"]')
    expect(root!.className).toContain('text-status-success-text')
  })

  it('renders a leading dot when dot=true', () => {
    render(
      <Tag variant="error" dot>
        Live
      </Tag>,
    )
    const root = screen.getByText('Live').closest('[data-slot="tag"]')
    const dotSpan = root!.querySelector('[aria-hidden="true"]')
    expect(dotSpan).not.toBeNull()
    expect(dotSpan!.className).toContain('bg-status-error-icon')
  })

  it('renders no remove button by default', () => {
    render(<Tag>Plain</Tag>)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('renders a remove button when onRemove is provided', () => {
    const onRemove = jest.fn()
    render(<Tag onRemove={onRemove}>Closeable</Tag>)
    const button = screen.getByRole('button', { name: 'Remove' })
    expect(button).toBeInTheDocument()
  })

  it('uses custom removeAriaLabel when provided', () => {
    const onRemove = jest.fn()
    render(
      <Tag onRemove={onRemove} removeAriaLabel="Remove Berlin">
        Berlin
      </Tag>,
    )
    expect(screen.getByRole('button', { name: 'Remove Berlin' })).toBeInTheDocument()
  })

  it('fires onRemove and stops propagation when close button is clicked', () => {
    const onRemove = jest.fn()
    const onClick = jest.fn()
    render(
      <Tag onRemove={onRemove} onClick={onClick}>
        ClickMe
      </Tag>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(onRemove).toHaveBeenCalledTimes(1)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('disables the close button and fades the chip when disabled is true', () => {
    const onRemove = jest.fn()
    render(
      <Tag onRemove={onRemove} disabled>
        Locked
      </Tag>,
    )
    const root = screen.getByText('Locked').closest('[data-slot="tag"]')
    expect(root!.className).toContain('opacity-60')
    expect(root).toHaveAttribute('aria-disabled', 'true')
    const button = screen.getByRole('button', { name: 'Remove' })
    expect(button).toBeDisabled()
  })

  it('forwards arbitrary HTMLSpan props (id, data-*, className)', () => {
    render(
      <Tag id="tag-1" data-testid="leading-tag" className="ml-2">
        Forwarded
      </Tag>,
    )
    const root = document.getElementById('tag-1')
    expect(root).not.toBeNull()
    expect(root).toHaveAttribute('data-testid', 'leading-tag')
    expect(root!.className).toContain('ml-2')
  })

  it('uses smaller close icon for pill shape and larger for square shape', () => {
    const { rerender, container } = render(
      <Tag shape="pill" onRemove={() => {}}>
        Pill
      </Tag>,
    )
    let svg = container.querySelector('button svg')
    expect(svg!.getAttribute('class')).toContain('size-2.5')

    rerender(
      <Tag shape="square" onRemove={() => {}}>
        Square
      </Tag>,
    )
    svg = container.querySelector('button svg')
    expect(svg!.getAttribute('class')).toContain('size-3.5')
  })
})
