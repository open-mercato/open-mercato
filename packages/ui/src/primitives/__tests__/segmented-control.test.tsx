/** @jest-environment jsdom */

import * as React from 'react'
import { render, fireEvent } from '@testing-library/react'
import { SegmentedControl, SegmentedControlItem } from '../segmented-control'

function Controlled({
  initial = 'all',
  size,
  disabled,
  onChange,
}: {
  initial?: string
  size?: 'sm' | 'default'
  disabled?: boolean
  onChange?: (next: string) => void
}) {
  const [value, setValue] = React.useState(initial)
  return (
    <SegmentedControl
      value={value}
      onValueChange={(next) => {
        setValue(next)
        onChange?.(next)
      }}
      size={size}
      disabled={disabled}
      aria-label="View"
    >
      <SegmentedControlItem value="all">All</SegmentedControlItem>
      <SegmentedControlItem value="active">Active</SegmentedControlItem>
      <SegmentedControlItem value="archived">Archived</SegmentedControlItem>
    </SegmentedControl>
  )
}

describe('SegmentedControl', () => {
  it('renders a radiogroup with one radio item per child', () => {
    const { container, getByRole, getAllByRole } = render(<Controlled />)
    const root = getByRole('radiogroup', { name: 'View' })
    expect(root).toBeInTheDocument()
    expect(root.getAttribute('data-slot')).toBe('segmented-control')
    const items = getAllByRole('radio')
    expect(items.length).toBe(3)
    expect(container.querySelectorAll('[data-slot="segmented-control-item"]').length).toBe(3)
  })

  it('marks the initial value as checked', () => {
    const { getByRole } = render(<Controlled initial="active" />)
    const all = getByRole('radio', { name: 'All' })
    const active = getByRole('radio', { name: 'Active' })
    const archived = getByRole('radio', { name: 'Archived' })
    expect(all.getAttribute('aria-checked')).toBe('false')
    expect(active.getAttribute('aria-checked')).toBe('true')
    expect(active.getAttribute('data-state')).toBe('checked')
    expect(archived.getAttribute('aria-checked')).toBe('false')
  })

  it('fires onValueChange when an unselected item is clicked', () => {
    const onChange = jest.fn()
    const { getByRole } = render(<Controlled onChange={onChange} />)
    fireEvent.click(getByRole('radio', { name: 'Active' }))
    expect(onChange).toHaveBeenCalledWith('active')
  })

  it('updates aria-checked + data-state after selection', () => {
    const { getByRole } = render(<Controlled />)
    fireEvent.click(getByRole('radio', { name: 'Archived' }))
    expect(getByRole('radio', { name: 'Archived' }).getAttribute('aria-checked')).toBe('true')
    expect(getByRole('radio', { name: 'All' }).getAttribute('aria-checked')).toBe('false')
  })

  it('applies size="default" classes by default (h-8 track, h-7 items, text-sm)', () => {
    const { container } = render(<Controlled />)
    const root = container.querySelector('[data-slot="segmented-control"]') as HTMLElement
    expect(root.className).toContain('h-8')
    expect(root.className).toContain('rounded-full')
    const item = container.querySelector('[data-slot="segmented-control-item"]') as HTMLElement
    expect(item.className).toContain('h-7')
    expect(item.className).toContain('text-sm')
  })

  it('applies size="sm" classes (h-7 track, h-6 items, text-xs)', () => {
    const { container } = render(<Controlled size="sm" />)
    const root = container.querySelector('[data-slot="segmented-control"]') as HTMLElement
    expect(root.className).toContain('h-7')
    expect(root.className).not.toContain('h-8')
    const item = container.querySelector('[data-slot="segmented-control-item"]') as HTMLElement
    expect(item.className).toContain('h-6')
    expect(item.className).toContain('text-xs')
  })

  it('disables all items when disabled prop is set on the root', () => {
    const onChange = jest.fn()
    const { container, getByRole } = render(<Controlled disabled onChange={onChange} />)
    const root = container.querySelector('[data-slot="segmented-control"]') as HTMLElement
    expect(root.className).toContain('opacity-60')
    const items = container.querySelectorAll('[data-slot="segmented-control-item"]')
    items.forEach((item) => {
      expect((item as HTMLButtonElement).disabled).toBe(true)
    })
    fireEvent.click(getByRole('radio', { name: 'Active' }))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('forwards ref to the root element', () => {
    const ref = React.createRef<HTMLDivElement>()
    render(
      <SegmentedControl ref={ref} value="a" onValueChange={() => {}} aria-label="x">
        <SegmentedControlItem value="a">A</SegmentedControlItem>
        <SegmentedControlItem value="b">B</SegmentedControlItem>
      </SegmentedControl>,
    )
    expect(ref.current).not.toBeNull()
    expect(ref.current?.getAttribute('data-slot')).toBe('segmented-control')
  })

  it('forwards className without dropping variant classes', () => {
    const { container } = render(
      <SegmentedControl value="a" onValueChange={() => {}} className="custom-class">
        <SegmentedControlItem value="a">A</SegmentedControlItem>
      </SegmentedControl>,
    )
    const root = container.querySelector('[data-slot="segmented-control"]') as HTMLElement
    expect(root.className).toContain('custom-class')
    expect(root.className).toContain('rounded-full')
    expect(root.className).toContain('bg-muted')
  })
})
