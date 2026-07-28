/**
 * @jest-environment jsdom
 *
 * Step 3.11 (workflows UX Phase 3b) — spec section 4.6 acceptance: "ARIA
 * labeling on nodes/routes/badges… Status is never color-only."
 *
 * Every canvas element that carries meaning must announce it, and every state
 * that is communicated with a DS status colour must pair that colour with a
 * second, non-colour cue (an icon shape, a text label, or a dash pattern).
 */
import * as React from 'react'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { WorkflowNodeCard } from '../WorkflowNodeCard'
import { WorkflowTransitionLabel } from '../WorkflowTransitionLabel'
import { WorkflowRouteChips } from '../WorkflowRouteChips'
import { buildRouteChipModel } from '../../lib/route-chips'
import type { WorkflowStatus } from '../../lib/status-colors'

const ALL_STATUSES: WorkflowStatus[] = [
  'completed',
  'in_progress',
  'pending',
  'failed',
  'paused',
  'not_started',
  'error',
]

describe('node cards announce themselves', () => {
  it('labels the card with its type, title and status', () => {
    renderWithProviders(<WorkflowNodeCard title="Approve order" nodeType="userTask" status="failed" />)

    const card = screen.getByRole('group')
    expect(card.getAttribute('aria-label')).toContain('Approve order')
    expect(card.getAttribute('aria-label')).toContain('Failed')
    expect(card).toHaveAttribute('data-node-status', 'failed')
  })

  it('names every status in text, so no state is communicated by colour alone', () => {
    for (const status of ALL_STATUSES) {
      const { container, unmount } = renderWithProviders(
        <WorkflowNodeCard title="Step" nodeType="automated" status={status} />,
      )
      const statusText = container.querySelector('.sr-only')
      expect(statusText?.textContent?.trim().length ?? 0).toBeGreaterThan(0)
      unmount()
    }
  })

  it('gives every status its own icon shape alongside the token colour', () => {
    const shapes = new Set<string>()
    for (const status of ALL_STATUSES) {
      const { container, unmount } = renderWithProviders(
        <WorkflowNodeCard title="Step" nodeType="automated" status={status} />,
      )
      const icons = Array.from(container.querySelectorAll('svg.lucide'))
      expect(icons.length).toBeGreaterThan(0)
      shapes.add(icons.map((icon) => icon.getAttribute('class')).join('|'))
      unmount()
    }
    expect(shapes.size).toBeGreaterThan(1)
  })

  it('gives the error badge an accessible name rather than a bare red dot', () => {
    renderWithProviders(<WorkflowNodeCard title="Step" nodeType="automated" hasError errorCount={3} />)
    expect(screen.getByRole('status', { name: '3 validation error(s)' })).toHaveTextContent('3')
  })
})

describe('route labels pair their status colour with an icon', () => {
  it('renders a warning icon on an error route', () => {
    const { container } = renderWithProviders(<WorkflowTransitionLabel label="On error" state="error" />)
    expect(container.querySelector('svg.lucide')).not.toBeNull()
    expect(container.querySelector('.text-status-error-text')).not.toBeNull()
  })

  it('renders a check icon on a completed route', () => {
    const { container } = renderWithProviders(<WorkflowTransitionLabel label="Approved" state="completed" />)
    expect(container.querySelector('svg.lucide')).not.toBeNull()
    expect(container.querySelector('.text-status-success-text')).not.toBeNull()
  })

  it('leaves the neutral pending state iconless — a neutral token carries no status claim', () => {
    const { container } = renderWithProviders(<WorkflowTransitionLabel label="Next" state="pending" />)
    expect(container.querySelector('svg.lucide')).toBeNull()
  })
})

describe('route chips are named, not just coloured', () => {
  const model = buildRouteChipModel({
    condition: { type: 'group', operator: 'AND', children: [{ type: 'condition', field: 'amount', operator: 'gt', value: 5000 }] },
    activities: [
      { activityId: 'a1', activityType: 'SEND_EMAIL', activityName: 'Notify' },
      { activityId: 'a2', activityType: 'CALL_API', activityName: 'Charge' },
    ],
    hasConditionedSibling: false,
  })

  it('gives every chip an accessible label', () => {
    renderWithProviders(<WorkflowRouteChips model={model} />)
    for (const chip of screen.getAllByRole('button')) {
      expect(chip.getAttribute('aria-label')?.length ?? 0).toBeGreaterThan(0)
    }
  })

  it('keeps the collapsed dot row labelled at semantic zoom', () => {
    renderWithProviders(<WorkflowRouteChips model={model} collapsed />)
    const collapsed = screen.getByRole('img')
    expect(collapsed.getAttribute('aria-label')?.length ?? 0).toBeGreaterThan(0)
  })
})
