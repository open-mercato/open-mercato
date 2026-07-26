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

  it('maps the error status to the error visual state instead of not_started', () => {
    const { container } = renderWithProviders(
      <WorkflowNodeCard title="Review Request" nodeType="userTask" status="error" />,
    )

    expect(container.querySelector('.bg-status-error-bg')).not.toBeNull()
    expect(container.querySelector('.text-status-error-text')).not.toBeNull()
  })
})
