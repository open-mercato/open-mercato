/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '../accordion'

function renderBasic(
  props: Partial<React.ComponentProps<typeof AccordionTrigger>> = {},
  itemProps: Partial<React.ComponentProps<typeof AccordionItem>> = {},
) {
  return render(
    <Accordion type="single" collapsible>
      <AccordionItem value="one" {...itemProps}>
        <AccordionTrigger {...props}>How do I update my account?</AccordionTrigger>
        <AccordionContent>Visit Settings → Profile to edit your details.</AccordionContent>
      </AccordionItem>
    </Accordion>,
  )
}

describe('Accordion primitive', () => {
  it('renders the trigger label', () => {
    renderBasic()
    expect(screen.getByText('How do I update my account?')).toBeInTheDocument()
  })

  it('starts closed by default (single + collapsible)', () => {
    const { container } = renderBasic()
    const item = container.querySelector('[data-slot="accordion-item"]')
    expect(item).toHaveAttribute('data-state', 'closed')
  })

  it('opens the item when the trigger is clicked', () => {
    const { container } = renderBasic()
    fireEvent.click(screen.getByRole('button', { name: /How do I update/ }))
    expect(container.querySelector('[data-slot="accordion-item"]')).toHaveAttribute('data-state', 'open')
  })

  it('closes the item on a second click when collapsible', () => {
    const { container } = renderBasic()
    const trigger = screen.getByRole('button', { name: /How do I update/ })
    fireEvent.click(trigger)
    fireEvent.click(trigger)
    expect(container.querySelector('[data-slot="accordion-item"]')).toHaveAttribute('data-state', 'closed')
  })

  it('only opens one item at a time with type="single"', () => {
    const { container } = render(
      <Accordion type="single" collapsible>
        <AccordionItem value="a">
          <AccordionTrigger>A</AccordionTrigger>
          <AccordionContent>A body</AccordionContent>
        </AccordionItem>
        <AccordionItem value="b">
          <AccordionTrigger>B</AccordionTrigger>
          <AccordionContent>B body</AccordionContent>
        </AccordionItem>
      </Accordion>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'A' }))
    fireEvent.click(screen.getByRole('button', { name: 'B' }))
    const items = container.querySelectorAll('[data-slot="accordion-item"]')
    expect(items[0]).toHaveAttribute('data-state', 'closed')
    expect(items[1]).toHaveAttribute('data-state', 'open')
  })

  it('allows multiple items to stay open with type="multiple"', () => {
    const { container } = render(
      <Accordion type="multiple">
        <AccordionItem value="a">
          <AccordionTrigger>A</AccordionTrigger>
          <AccordionContent>A body</AccordionContent>
        </AccordionItem>
        <AccordionItem value="b">
          <AccordionTrigger>B</AccordionTrigger>
          <AccordionContent>B body</AccordionContent>
        </AccordionItem>
      </Accordion>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'A' }))
    fireEvent.click(screen.getByRole('button', { name: 'B' }))
    const items = container.querySelectorAll('[data-slot="accordion-item"]')
    expect(items[0]).toHaveAttribute('data-state', 'open')
    expect(items[1]).toHaveAttribute('data-state', 'open')
  })

  it('marks the root slots with data-slot attributes', () => {
    const { container } = renderBasic()
    expect(container.querySelector('[data-slot="accordion-item"]')).not.toBeNull()
    expect(container.querySelector('[data-slot="accordion-trigger"]')).not.toBeNull()
    expect(container.querySelector('[data-slot="accordion-content"]')).not.toBeNull()
  })

  it('renders the Plus/Minus indicator by default (plus-minus triggerIcon)', () => {
    const { container } = renderBasic()
    const indicator = container.querySelector('[data-slot="accordion-trigger-indicator"]')
    expect(indicator).not.toBeNull()
    // Plus and Minus are both present; CSS toggles visibility via data-state.
    expect(indicator?.querySelectorAll('svg').length).toBe(2)
  })

  it('renders a single ChevronDown when triggerIcon="chevron"', () => {
    const { container } = renderBasic({ triggerIcon: 'chevron' })
    const indicator = container.querySelector('[data-slot="accordion-trigger-indicator"]')
    expect(indicator?.querySelectorAll('svg').length).toBe(1)
  })

  it('omits the indicator entirely when triggerIcon="none"', () => {
    const { container } = renderBasic({ triggerIcon: 'none' })
    expect(container.querySelector('[data-slot="accordion-trigger-indicator"]')).toBeNull()
  })

  it('renders a custom indicator node when provided (overrides triggerIcon)', () => {
    const { container } = renderBasic({
      triggerIcon: 'chevron',
      indicator: <span data-testid="custom-indicator">42</span>,
    })
    expect(screen.getByTestId('custom-indicator')).toBeInTheDocument()
    // No Chevron rendered when indicator override is supplied.
    const indicator = container.querySelector('[data-slot="accordion-trigger-indicator"]')
    expect(indicator?.querySelector('svg')).toBeNull()
  })

  it('renders leftIcon in a dedicated slot before the label', () => {
    const { container } = renderBasic({ leftIcon: <span data-testid="left-icon" /> })
    expect(container.querySelector('[data-slot="accordion-trigger-left-icon"]')).not.toBeNull()
    expect(screen.getByTestId('left-icon')).toBeInTheDocument()
  })

  it('suppresses leftIcon when iconPosition="start" (indicator owns the leading slot)', () => {
    const { container } = renderBasic({
      leftIcon: <span data-testid="left-icon" />,
      iconPosition: 'start',
    })
    expect(container.querySelector('[data-slot="accordion-trigger-left-icon"]')).toBeNull()
    expect(screen.queryByTestId('left-icon')).toBeNull()
  })

  it('places the indicator at the start of the trigger when iconPosition="start"', () => {
    const { container } = renderBasic({ iconPosition: 'start' })
    const trigger = container.querySelector('[data-slot="accordion-trigger"]')!
    const indicator = trigger.querySelector('[data-slot="accordion-trigger-indicator"]')
    const label = trigger.querySelector('[data-slot="accordion-trigger-label"]')
    expect(indicator).not.toBeNull()
    // Indicator precedes the label in DOM order.
    expect(indicator?.compareDocumentPosition(label!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('applies card variant classes by default (border + shadow + bg-card)', () => {
    const { container } = renderBasic()
    const item = container.querySelector('[data-slot="accordion-item"]')!
    expect(item).toHaveClass('border-border')
    expect(item).toHaveClass('bg-card')
    expect(item).toHaveClass('shadow-xs')
  })

  it('applies borderless variant classes when variant="borderless"', () => {
    const { container } = renderBasic({}, { variant: 'borderless' })
    const item = container.querySelector('[data-slot="accordion-item"]')!
    expect(item).toHaveClass('border-transparent')
    expect(item).toHaveClass('bg-transparent')
    expect(item).toHaveClass('shadow-none')
  })

  it('exposes --accordion-indent on the item with a Tailwind has-[] promoter for the leftIcon case', () => {
    const { container } = renderBasic({ leftIcon: <span /> })
    const item = container.querySelector('[data-slot="accordion-item"]')!
    // We can't assert the resolved CSS variable value in jsdom (no real CSS engine),
    // so we assert the Tailwind utility that flips the variable is on the item.
    expect(item.className).toContain('[--accordion-indent:14px]')
    expect(item.className).toContain('has-[[data-slot=accordion-trigger-left-icon]]:[--accordion-indent:44px]')
  })

  it('forwards refs to the underlying Radix Item / Trigger / Content nodes', () => {
    const itemRef = React.createRef<HTMLDivElement>()
    const triggerRef = React.createRef<HTMLButtonElement>()
    const contentRef = React.createRef<HTMLDivElement>()
    render(
      <Accordion type="single" collapsible defaultValue="one">
        <AccordionItem ref={itemRef} value="one">
          <AccordionTrigger ref={triggerRef}>Title</AccordionTrigger>
          <AccordionContent ref={contentRef}>Body</AccordionContent>
        </AccordionItem>
      </Accordion>,
    )
    expect(itemRef.current).not.toBeNull()
    expect(triggerRef.current?.tagName).toBe('BUTTON')
    expect(contentRef.current).not.toBeNull()
  })
})
