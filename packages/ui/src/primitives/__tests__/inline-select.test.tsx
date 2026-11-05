/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { render, screen } from '@testing-library/react'
import {
  InlineSelectTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectValue,
} from '../inline-select'

function renderInlineSelect(
  props: Partial<React.ComponentProps<typeof InlineSelectTrigger>> = {},
) {
  return render(
    <Select defaultValue="open">
      <InlineSelectTrigger aria-label="Status" {...props}>
        <SelectValue />
      </InlineSelectTrigger>
      <SelectContent>
        <SelectItem value="open">Open</SelectItem>
        <SelectItem value="closed">Closed</SelectItem>
      </SelectContent>
    </Select>,
  )
}

describe('InlineSelect primitive', () => {
  it('renders the trigger borderless at rest', () => {
    const { container } = renderInlineSelect()
    const trigger = container.querySelector('[data-slot="inline-select-trigger"]')
    expect(trigger).not.toBeNull()
    expect(trigger).toHaveClass('border-transparent')
    expect(trigger).toHaveClass('bg-transparent')
    expect(trigger).toHaveClass('shadow-none')
  })

  it('shows the hover border by default', () => {
    const { container } = renderInlineSelect()
    const trigger = container.querySelector('[data-slot="inline-select-trigger"]')
    expect(trigger).toHaveClass('hover:border-input')
    expect(trigger).toHaveClass('hover:bg-muted/40')
  })

  it('omits the hover border when showBorderOnHover is false', () => {
    const { container } = renderInlineSelect({ showBorderOnHover: false })
    const trigger = container.querySelector('[data-slot="inline-select-trigger"]')
    expect(trigger).not.toHaveClass('hover:border-input')
    expect(trigger).toHaveClass('hover:bg-transparent')
  })

  it('defaults to the sm size (h-8)', () => {
    const { container } = renderInlineSelect()
    const trigger = container.querySelector('[data-slot="inline-select-trigger"]')
    expect(trigger).toHaveClass('h-8')
  })

  it('supports size="default" (h-9)', () => {
    const { container } = renderInlineSelect({ size: 'default' })
    const trigger = container.querySelector('[data-slot="inline-select-trigger"]')
    expect(trigger).toHaveClass('h-9')
  })

  it('forwards refs to the underlying button trigger', () => {
    const ref = React.createRef<HTMLButtonElement>()
    render(
      <Select defaultValue="a">
        <InlineSelectTrigger ref={ref} aria-label="Pick">
          <SelectValue />
        </InlineSelectTrigger>
        <SelectContent>
          <SelectItem value="a">A</SelectItem>
        </SelectContent>
      </Select>,
    )
    expect(ref.current).not.toBeNull()
    expect(ref.current?.tagName).toBe('BUTTON')
  })

  it('merges consumer className alongside the borderless baseline', () => {
    const { container } = renderInlineSelect({
      className: 'text-right font-mono',
    })
    const trigger = container.querySelector('[data-slot="inline-select-trigger"]')
    expect(trigger).toHaveClass('text-right')
    expect(trigger).toHaveClass('font-mono')
    expect(trigger).toHaveClass('border-transparent')
  })

  it('forwards aria-label to the Radix trigger', () => {
    renderInlineSelect({ 'aria-label': 'Pipeline stage' })
    expect(screen.getByRole('combobox', { name: 'Pipeline stage' })).toBeInTheDocument()
  })

  it('renders aria-invalid styling when aria-invalid is set', () => {
    const { container } = renderInlineSelect({ 'aria-invalid': true })
    const trigger = container.querySelector('[aria-invalid="true"]')
    expect(trigger).not.toBeNull()
  })
})
