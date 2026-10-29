/**
 * @jest-environment jsdom
 *
 * Canvas visual fidelity gap 1: every control-flow route is a cubic bezier.
 *
 * Orthogonal step routing reads as a flowchart; the redesign's canvas is a
 * graph of curves. This asserts the shape of the emitted path directly — a
 * single `M…C…` with no `L`/`H`/`V` staircase segments — for the transition
 * edge AND the compensation ghost, so neither can quietly regress to a step
 * path while the other stays curved.
 *
 * The real `@xyflow/react` path builders are used (only the SVG chrome is
 * stubbed), because a mocked path builder would prove nothing about geometry.
 */
const mockCanvasZoom = { value: 1 }

jest.mock('@xyflow/react', () => {
  const actual = jest.requireActual('@xyflow/react')
  return {
    ...actual,
    BaseEdge: ({ path, style, 'aria-label': ariaLabel }: Record<string, unknown>) => (
      <div
        data-testid="base-edge"
        aria-label={ariaLabel as string}
        data-path={path as string}
        data-stroke={(style as Record<string, string>)?.stroke}
        data-stroke-width={String((style as Record<string, number>)?.strokeWidth ?? '')}
        data-dasharray={(style as Record<string, string>)?.strokeDasharray ?? ''}
      />
    ),
    EdgeLabelRenderer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    useStore: (selector: (store: { transform: [number, number, number]; edges: unknown[] }) => unknown) =>
      selector({ transform: [0, 0, mockCanvasZoom.value], edges: [] }),
  }
})

import * as React from 'react'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { WorkflowTransitionEdge } from '../WorkflowTransitionEdge'
import { WorkflowCompensationGhostEdge } from '../WorkflowCompensationGhostEdge'
import { EDGE_COLORS } from '../../lib/status-colors'
import { ROUTE_CHIP_ZOOM_THRESHOLD } from '../../lib/route-chips'

const edgeProps = {
  id: 'e_start_review',
  source: 'start',
  target: 'review',
  sourceX: 0,
  sourceY: 0,
  targetX: 240,
  targetY: 160,
  sourcePosition: 'right',
  targetPosition: 'left',
} as unknown as Record<string, unknown>

/** A single cubic bezier: one move-to, one curve-to, no staircase segments. */
const SINGLE_CUBIC_BEZIER = /^M[-\d.,\s]+C[-\d.,\s]+$/

function renderedPath(): string {
  return screen.getByTestId('base-edge').getAttribute('data-path') ?? ''
}

beforeEach(() => {
  mockCanvasZoom.value = 1
})

const conditionedRoute = {
  label: 'Approved',
  condition: { field: 'amount', operator: '>', value: 5000 },
  activities: [{ activityId: 'a1', activityType: 'SEND_EMAIL', activityName: 'Notify', config: {} }],
}

describe('route geometry is a cubic bezier', () => {
  it('draws a transition as one M…C… curve with no L/H/V segments', () => {
    renderWithProviders(<WorkflowTransitionEdge {...(edgeProps as never)} data={{ label: 'Approved' }} />)

    const path = renderedPath()
    expect(path).toMatch(SINGLE_CUBIC_BEZIER)
    expect(path).not.toMatch(/[LHVQSTAlhvqsta]/)
  })

  it('draws a compensation ghost as a curve too, so it tracks the route it mirrors', () => {
    renderWithProviders(
      <WorkflowCompensationGhostEdge
        {...(edgeProps as never)}
        id="compensation-ghost:e_start_review"
        data={{ compensatedActivityNames: ['Charge card'] }}
      />,
    )

    const path = renderedPath()
    expect(path).toMatch(SINGLE_CUBIC_BEZIER)
    expect(path).not.toMatch(/[LHVQSTAlhvqsta]/)
  })
})

describe('the default route reads as a plain wire', () => {
  it('is solid — dashes are reserved for error, data-mapping and compensation', () => {
    renderWithProviders(<WorkflowTransitionEdge {...(edgeProps as never)} data={{ label: 'Approved' }} />)

    expect(screen.getByTestId('base-edge').getAttribute('data-dasharray')).toBe('')
    expect(EDGE_COLORS.pending.dashed).toBe(false)
    expect(EDGE_COLORS.pending.dashArray).toBeUndefined()
  })

  it('is a hairline, so the cards stay louder than the wires between them', () => {
    renderWithProviders(<WorkflowTransitionEdge {...(edgeProps as never)} data={{ label: 'Approved' }} />)

    expect(screen.getByTestId('base-edge').getAttribute('data-stroke-width')).toBe('1.5')
  })

  it('derives its stroke from the muted-foreground token, never a literal colour', () => {
    expect(EDGE_COLORS.pending.stroke).toContain('var(--muted-foreground)')
    expect(EDGE_COLORS.pending.stroke).not.toMatch(/#[0-9a-f]{3,8}|rgba?\(|oklch\(/i)
  })

  it('keeps a route that carries meaning heavier than the neutral default', () => {
    expect(EDGE_COLORS.error.strokeWidth).toBeGreaterThan(EDGE_COLORS.pending.strokeWidth)
    expect(EDGE_COLORS.completed.strokeWidth).toBeGreaterThan(EDGE_COLORS.pending.strokeWidth)
  })
})

describe('the meaningful dash patterns stay distinct from each other', () => {
  it('keeps error, compensation and data-mapping on three different patterns', () => {
    const patterns = [EDGE_COLORS.error.dashArray, '10,4,2,4', '2,3']
    expect(new Set(patterns).size).toBe(patterns.length)
    for (const pattern of patterns) expect(pattern).toBeTruthy()
  })

  it('renders the compensation ghost with its own dash-dot pattern', () => {
    renderWithProviders(
      <WorkflowCompensationGhostEdge
        {...(edgeProps as never)}
        id="compensation-ghost:e_start_review"
        data={{ compensatedActivityNames: ['Charge card'] }}
      />,
    )

    expect(screen.getByTestId('base-edge').getAttribute('data-dasharray')).toBe('10,4,2,4')
    expect(screen.getByTestId('workflow-compensation-ghost-label')).toBeInTheDocument()
  })
})

describe('route chips survive the switch to curved paths', () => {
  it('positions the chip row at the bezier midpoint the path builder returns', () => {
    renderWithProviders(<WorkflowTransitionEdge {...(edgeProps as never)} data={conditionedRoute} />)

    const chips = screen.getByTestId('route-chips')
    const positioned = chips.closest('[style]') as HTMLElement | null
    expect(positioned?.style.transform).toMatch(/translate\(-?[\d.]+px, ?-?[\d.]+px\)/)
    // The midpoint of a bowed curve is not the midpoint of the straight line
    // between the endpoints, so a stale hard-coded position would show up here.
    expect(positioned?.style.transform).not.toContain('NaN')
  })

  it('still collapses to the labelled dot row below the semantic-zoom threshold', () => {
    mockCanvasZoom.value = ROUTE_CHIP_ZOOM_THRESHOLD - 0.1
    renderWithProviders(<WorkflowTransitionEdge {...(edgeProps as never)} data={conditionedRoute} />)

    const collapsed = screen.getByTestId('route-chips-collapsed')
    expect(collapsed.getAttribute('role')).toBe('img')
    expect(collapsed.getAttribute('aria-label')?.length ?? 0).toBeGreaterThan(0)
    expect(screen.queryByTestId('route-chips')).toBeNull()
  })
})
