/**
 * @jest-environment jsdom
 *
 * Step 3.14 (workflows UX Phase 3b): compensation ghosts on the canvas
 * (spec section 4.4 "dashed reverse, behind a toggle"; section 4.3's badge
 * cluster). The ghost has to read as its own thing next to a real route — its
 * own dash pattern AND a permanent icon + label, because status is never
 * colour-only (spec section 4.6).
 */
jest.mock('@xyflow/react', () => ({
  Handle: ({ id }: Record<string, unknown>) => <div data-handle-id={id as string} />,
  Position: { Left: 'left', Right: 'right', Top: 'top', Bottom: 'bottom' },
  BaseEdge: ({ style, 'aria-label': ariaLabel }: Record<string, unknown>) => (
    <div
      data-testid="base-edge"
      aria-label={ariaLabel as string}
      data-stroke={(style as Record<string, string>)?.stroke}
      data-dasharray={(style as Record<string, string>)?.strokeDasharray}
    />
  ),
  EdgeLabelRenderer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  getBezierPath: () => ['M0,0 C0,0 0,0 0,0', 10, 10],
}))

import * as React from 'react'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { WorkflowCompensationGhostEdge } from '../WorkflowCompensationGhostEdge'
import { WorkflowNodeCard } from '../WorkflowNodeCard'
import { buildCompensationGhostEdges } from '../../lib/compensation-ghosts'

const ghostEdgeProps = {
  id: 'compensation-ghost:t1',
  source: 'charge',
  target: 'start',
  sourceX: 0,
  sourceY: 0,
  targetX: 10,
  targetY: 10,
  sourcePosition: 'left',
  targetPosition: 'right',
}

describe('compensation ghost rendering', () => {
  test('the ghost pairs its own dash pattern with a named icon+label chip', () => {
    const [ghost] = buildCompensationGhostEdges([
      {
        id: 't1',
        source: 'start',
        target: 'charge',
        data: {
          activities: [
            { activityId: 'charge_card', activityName: 'Charge card', compensation: { activityId: 'refund_card' } },
          ],
        },
      },
    ])

    renderWithProviders(
      <WorkflowCompensationGhostEdge
        {...(ghostEdgeProps as unknown as React.ComponentProps<typeof WorkflowCompensationGhostEdge>)}
        data={ghost.data}
      />,
    )

    const edge = screen.getByTestId('base-edge')
    expect(edge.getAttribute('data-stroke')).toBe('var(--status-warning-icon)')
    // Distinct from the pending (5,5), error (8,4) and data-mapping (2,3) patterns.
    expect(edge.getAttribute('data-dasharray')).toBe('10,4,2,4')
    expect(edge.getAttribute('aria-label')).toContain('Charge card')

    const label = screen.getByTestId('workflow-compensation-ghost-label')
    expect(label.textContent).toContain('Compensation')
    expect(label.querySelector('svg')).toBeTruthy()
  })

  test('the node badge appears only when the canvas marks the step compensable', () => {
    const { unmount } = renderWithProviders(
      <WorkflowNodeCard title="Charge card" nodeType="automated" hasCompensation />,
    )
    const badge = screen.getByTestId('workflow-node-compensation-badge')
    expect(badge.getAttribute('aria-label')).toBe('Leaving this step schedules compensation')
    expect(badge.querySelector('svg')).toBeTruthy()
    unmount()

    renderWithProviders(<WorkflowNodeCard title="Charge card" nodeType="automated" />)
    expect(screen.queryByTestId('workflow-node-compensation-badge')).toBeNull()
  })
})
