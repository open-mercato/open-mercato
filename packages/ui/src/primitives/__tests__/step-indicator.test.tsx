/** @jest-environment jsdom */

import * as React from 'react'
import { render as rtlRender, fireEvent } from '@testing-library/react'
import { StepIndicator, type StepIndicatorStep } from '../step-indicator'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'

// StepIndicator uses useT() for the "Go to step: {label}" aria-label.
// Wrap every render in an empty-dict I18nProvider so the primitive
// falls back to its English fallback without real translations.
const render: typeof rtlRender = (ui: React.ReactElement, options?: Parameters<typeof rtlRender>[1]) =>
  rtlRender(
    <I18nProvider locale="en" dict={{}}>
      {ui}
    </I18nProvider>,
    options,
  )

const baseSteps: StepIndicatorStep[] = [
  { id: 'account', label: 'Account', status: 'complete' },
  { id: 'profile', label: 'Profile', status: 'current' },
  { id: 'review', label: 'Review', status: 'pending' },
]

describe('StepIndicator', () => {
  it('renders an ordered list with one item per step', () => {
    const { container, getByText } = render(<StepIndicator steps={baseSteps} />)
    const root = container.querySelector('[data-slot="step-indicator"]') as HTMLElement
    expect(root.tagName).toBe('OL')
    expect(root.getAttribute('aria-orientation')).toBe('horizontal')
    const items = container.querySelectorAll('[data-slot="step-indicator-item"]')
    expect(items.length).toBe(3)
    expect(getByText('Account')).toBeInTheDocument()
    expect(getByText('Profile')).toBeInTheDocument()
    expect(getByText('Review')).toBeInTheDocument()
  })

  it('marks each step item with its status via data-status', () => {
    const { container } = render(<StepIndicator steps={baseSteps} />)
    const items = container.querySelectorAll('[data-slot="step-indicator-item"]')
    expect(items[0].getAttribute('data-status')).toBe('complete')
    expect(items[1].getAttribute('data-status')).toBe('current')
    expect(items[2].getAttribute('data-status')).toBe('pending')
  })

  it('horizontal: places a ChevronRight connector between each pair of items', () => {
    const { container } = render(<StepIndicator steps={baseSteps} />)
    const connectors = container.querySelectorAll('[data-slot="step-indicator-connector"]')
    // 3 items → 2 connectors (no trailing chevron after the last item)
    expect(connectors.length).toBe(2)
  })

  it('horizontal: does NOT render a chevron after the last item', () => {
    const { container } = render(
      <StepIndicator
        steps={[
          { id: 'a', label: 'A', status: 'complete' },
          { id: 'b', label: 'B', status: 'current' },
        ]}
      />,
    )
    expect(container.querySelectorAll('[data-slot="step-indicator-connector"]').length).toBe(1)
  })

  it('renders the complete dot with a Check icon (svg child)', () => {
    const { container } = render(<StepIndicator steps={baseSteps} />)
    const completeDot = container.querySelector(
      '[data-slot="step-indicator-dot"][data-status="complete"]',
    ) as HTMLElement
    expect(completeDot.querySelector('svg')).not.toBeNull()
  })

  it('renders the current dot as a solid coloured circle (no inner glyph)', () => {
    const { container } = render(<StepIndicator steps={baseSteps} />)
    const currentDot = container.querySelector(
      '[data-slot="step-indicator-dot"][data-status="current"]',
    ) as HTMLElement
    // No Check / X icon for current — just the coloured dot
    expect(currentDot.querySelector('svg')).toBeNull()
    expect(currentDot.className).toContain('bg-accent-indigo')
  })

  it('renders the pending dot as an outlined circle (no glyph, transparent bg)', () => {
    const { container } = render(<StepIndicator steps={baseSteps} />)
    const pendingDot = container.querySelector(
      '[data-slot="step-indicator-dot"][data-status="pending"]',
    ) as HTMLElement
    expect(pendingDot.querySelector('svg')).toBeNull()
    expect(pendingDot.className).toContain('border')
    expect(pendingDot.className).toContain('bg-background')
  })

  it('renders the error dot with an X icon and status-error bg', () => {
    const { container } = render(
      <StepIndicator
        steps={[
          { id: 'a', label: 'A', status: 'complete' },
          { id: 'b', label: 'B', status: 'error' },
          { id: 'c', label: 'C', status: 'pending' },
        ]}
      />,
    )
    const errorDot = container.querySelector(
      '[data-slot="step-indicator-dot"][data-status="error"]',
    ) as HTMLElement
    expect(errorDot.querySelector('svg')).not.toBeNull()
    expect(errorDot.className).toContain('bg-status-error-icon')
  })

  it('marks the current step with aria-current="step"', () => {
    const { container } = render(<StepIndicator steps={baseSteps} />)
    const currentDot = container.querySelector(
      '[data-slot="step-indicator-dot"][data-status="current"]',
    ) as HTMLElement
    expect(currentDot.getAttribute('aria-current')).toBe('step')
    const pendingDot = container.querySelector(
      '[data-slot="step-indicator-dot"][data-status="pending"]',
    ) as HTMLElement
    expect(pendingDot.getAttribute('aria-current')).toBeNull()
  })

  describe('vertical orientation', () => {
    it('switches aria-orientation + flex-col on the root', () => {
      const { container } = render(<StepIndicator steps={baseSteps} orientation="vertical" />)
      const root = container.querySelector('[data-slot="step-indicator"]') as HTMLElement
      expect(root.getAttribute('aria-orientation')).toBe('vertical')
      expect(root.className).toContain('flex-col')
    })

    it('does NOT render chevron connectors between items (vertical = pill per item)', () => {
      const { container } = render(<StepIndicator steps={baseSteps} orientation="vertical" />)
      expect(container.querySelectorAll('[data-slot="step-indicator-connector"]').length).toBe(0)
    })

    it('renders the optional description below the label', () => {
      const { getByText } = render(
        <StepIndicator
          steps={[{ id: 'a', label: 'Step A', description: 'Sub-text', status: 'current' }]}
          orientation="vertical"
        />,
      )
      expect(getByText('Step A')).toBeInTheDocument()
      expect(getByText('Sub-text')).toBeInTheDocument()
    })
  })

  describe('interactive mode', () => {
    it('renders buttons for complete + current steps when onStepClick is provided', () => {
      const onStepClick = jest.fn()
      const { container } = render(
        <StepIndicator steps={baseSteps} onStepClick={onStepClick} />,
      )
      const buttons = container.querySelectorAll('button')
      // complete (1) + current (1) by default — pending is NOT clickable
      expect(buttons.length).toBe(2)
    })

    it('fires onStepClick with the step id', () => {
      const onStepClick = jest.fn()
      const { container } = render(
        <StepIndicator steps={baseSteps} onStepClick={onStepClick} />,
      )
      const buttons = container.querySelectorAll('button')
      fireEvent.click(buttons[0])
      expect(onStepClick).toHaveBeenCalledWith('account')
    })

    it('honors clickableStatuses to widen the click target', () => {
      const onStepClick = jest.fn()
      const { container } = render(
        <StepIndicator
          steps={baseSteps}
          onStepClick={onStepClick}
          clickableStatuses={['complete', 'current', 'pending']}
        />,
      )
      expect(container.querySelectorAll('button').length).toBe(3)
    })

    it('does NOT render buttons when onStepClick is omitted', () => {
      const { container } = render(<StepIndicator steps={baseSteps} />)
      expect(container.querySelectorAll('button').length).toBe(0)
    })
  })

  describe('size variants', () => {
    it('default size applies size-5 to the dot', () => {
      const { container } = render(<StepIndicator steps={baseSteps} />)
      const dot = container.querySelector('[data-slot="step-indicator-dot"]') as HTMLElement
      expect(dot.className).toContain('size-5')
    })

    it('sm size applies size-4', () => {
      const { container } = render(<StepIndicator steps={baseSteps} size="sm" />)
      const dot = container.querySelector('[data-slot="step-indicator-dot"]') as HTMLElement
      expect(dot.className).toContain('size-4')
    })
  })

  it('forwards ref to the root <ol> element', () => {
    const ref = React.createRef<HTMLOListElement>()
    render(<StepIndicator ref={ref} steps={baseSteps} />)
    expect(ref.current?.getAttribute('data-slot')).toBe('step-indicator')
  })
})
