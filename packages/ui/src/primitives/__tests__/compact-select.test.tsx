/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { render, screen } from '@testing-library/react'
import {
  CompactSelectTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectValue,
} from '../compact-select'

function renderCompactSelect(
  props: Partial<React.ComponentProps<typeof CompactSelectTrigger>> = {},
  defaultValue: string = 'all',
) {
  return render(
    <Select defaultValue={defaultValue}>
      <CompactSelectTrigger aria-label="View" {...props}>
        <SelectValue />
      </CompactSelectTrigger>
      <SelectContent>
        <SelectItem value="all">All</SelectItem>
        <SelectItem value="open">Open</SelectItem>
      </SelectContent>
    </Select>,
  )
}

describe('CompactSelect primitive', () => {
  it('renders the trigger at h-7 (xs) regardless of explicit size attempts', () => {
    const { container } = renderCompactSelect()
    const trigger = container.querySelector('[data-slot="compact-select-trigger"]')
    expect(trigger).not.toBeNull()
    expect(trigger).toHaveClass('h-7')
  })

  it('uses the smaller px-2 text-xs styling of the xs size variant', () => {
    const { container } = renderCompactSelect()
    const trigger = container.querySelector('[data-slot="compact-select-trigger"]')!
    expect(trigger).toHaveClass('px-2')
    expect(trigger).toHaveClass('text-xs')
  })

  it('renders the triggerLabel prefix when provided', () => {
    renderCompactSelect({ triggerLabel: 'View:' })
    expect(screen.getByText('View:')).toBeInTheDocument()
  })

  it('omits the triggerLabel slot when no label is provided', () => {
    const { container } = renderCompactSelect()
    expect(container.querySelector('[data-slot="compact-select-trigger-label"]')).toBeNull()
  })

  it('marks the trigger label slot with data-slot for styling hooks', () => {
    const { container } = renderCompactSelect({ triggerLabel: 'Sort:' })
    const slot = container.querySelector('[data-slot="compact-select-trigger-label"]')
    expect(slot).not.toBeNull()
    expect(slot?.textContent).toBe('Sort:')
  })

  it('forwards the trigger to a ref consumer', () => {
    const ref = React.createRef<HTMLButtonElement>()
    render(
      <Select defaultValue="a">
        <CompactSelectTrigger ref={ref} aria-label="Pick">
          <SelectValue />
        </CompactSelectTrigger>
        <SelectContent>
          <SelectItem value="a">A</SelectItem>
        </SelectContent>
      </Select>,
    )
    expect(ref.current).not.toBeNull()
    expect(ref.current?.tagName).toBe('BUTTON')
  })

  it('applies className alongside the size variant', () => {
    const { container } = renderCompactSelect({ className: 'rounded-full border-brand-violet' })
    const trigger = container.querySelector('[data-slot="compact-select-trigger"]')
    expect(trigger).toHaveClass('rounded-full')
    expect(trigger).toHaveClass('border-brand-violet')
    expect(trigger).toHaveClass('h-7')
  })

  it('forwards SelectTrigger ARIA props to the underlying Radix trigger', () => {
    renderCompactSelect({ 'aria-label': 'Period selector' })
    expect(screen.getByRole('combobox', { name: 'Period selector' })).toBeInTheDocument()
  })

  it('renders aria-invalid styling when aria-invalid is set', () => {
    const { container } = renderCompactSelect({ 'aria-invalid': true })
    const trigger = container.querySelector('[aria-invalid="true"]')
    expect(trigger).not.toBeNull()
  })
})
