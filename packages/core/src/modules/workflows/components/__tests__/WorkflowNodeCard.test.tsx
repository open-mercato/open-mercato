/**
 * @jest-environment jsdom
 *
 * Per-node validation error badges (#4232): WorkflowNodeCard renders an error
 * badge (and error border) only when the hasError prop is set, showing the
 * issue count when provided, and renders no badge otherwise so fixed issues
 * leave no stale markers.
 */
import * as React from 'react'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { WorkflowNodeCard } from '../WorkflowNodeCard'

describe('WorkflowNodeCard — validation error badge', () => {
  it('renders a counted error badge and error border when hasError is set', () => {
    const { container } = renderWithProviders(
      <WorkflowNodeCard title="Review Request" nodeType="userTask" hasError errorCount={2} />,
    )

    const badge = screen.getByRole('status', { name: '2 validation error(s)' })
    expect(badge).toHaveTextContent('2')
    expect(container.querySelector('.border-status-error-border')).not.toBeNull()
  })

  it('renders an icon badge when hasError is set without a count', () => {
    renderWithProviders(
      <WorkflowNodeCard title="Review Request" nodeType="userTask" hasError />,
    )

    expect(screen.getByRole('status', { name: '1 validation error(s)' })).toBeInTheDocument()
  })

  it('renders no badge and no error border without hasError', () => {
    const { container } = renderWithProviders(
      <WorkflowNodeCard title="Review Request" nodeType="userTask" />,
    )

    expect(screen.queryByRole('status')).toBeNull()
    expect(container.querySelector('.border-status-error-border')).toBeNull()
  })

  it('caps the card with its node-type accent on the DS border scale', () => {
    const { container } = renderWithProviders(
      <WorkflowNodeCard title="Review Request" nodeType="userTask" />,
    )

    const card = container.querySelector('[role="group"]')
    // `border-t-4`, never an arbitrary `border-t-[3px]`.
    expect(card?.className).toContain('border-t-4')
    expect(card?.className).toContain('border-t-chart-amber')
    expect(card?.className).not.toMatch(/border-t-\[/)
  })

  it('yields the accent to the status outline when the card is selected or failing', () => {
    const { container: selectedCard } = renderWithProviders(
      <WorkflowNodeCard title="Review Request" nodeType="userTask" selected />,
    )
    expect(selectedCard.querySelector('[role="group"]')?.className).not.toContain('border-t-chart-amber')

    const { container: erroredCard } = renderWithProviders(
      <WorkflowNodeCard title="Review Request" nodeType="userTask" hasError />,
    )
    expect(erroredCard.querySelector('[role="group"]')?.className).not.toContain('border-t-chart-amber')
  })

  it('renders a terminal as an auto-width pill with no accent cap or type row', () => {
    const { container } = renderWithProviders(
      <WorkflowNodeCard title="Start" nodeType="start" variant="pill" />,
    )

    const pill = container.querySelector('[data-node-variant="pill"]')
    expect(pill).not.toBeNull()
    expect(pill?.className).toContain('rounded-full')
    expect(pill?.className).not.toContain('border-t-4')
    // The type row is what a 190px-wide pill has no room for; the aria-label
    // still names the type, so nothing is lost to a screen reader.
    expect(container.textContent).not.toContain('START')
    expect(pill?.getAttribute('aria-label')).toContain('START')
  })

  it('keeps the delete affordance and the badge cluster on a pill', () => {
    renderWithProviders(
      <WorkflowNodeCard title="Start" nodeType="start" variant="pill" nodeId="start_1" editable hasError hasCompensation />,
    )

    expect(screen.getByRole('button', { name: 'Delete step' })).toBeInTheDocument()
    expect(screen.getByRole('status', { name: '1 validation error(s)' })).toBeInTheDocument()
    expect(screen.getByTestId('workflow-node-compensation-badge')).toBeInTheDocument()
  })

  it('maps the error status to the error visual state instead of not_started', () => {
    const { container } = renderWithProviders(
      <WorkflowNodeCard title="Review Request" nodeType="userTask" status="error" />,
    )

    expect(container.querySelector('.bg-status-error-bg')).not.toBeNull()
    expect(container.querySelector('.text-status-error-text')).not.toBeNull()
  })
})
