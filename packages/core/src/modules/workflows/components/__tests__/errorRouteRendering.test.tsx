/**
 * @jest-environment jsdom
 *
 * Step 2.8 (workflows UX Phase 3a): error routes on the canvas.
 * Covers the error output handle on activity-bearing nodes, the red dashed
 * error edge (DS status tokens + a non-color-only icon/label pairing), the
 * per-step directive picker round-trip, and the definition-level handler picker.
 */
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn(), refresh: jest.fn() }),
  useSearchParams: () => ({ get: () => null, toString: () => '' }),
  usePathname: () => '/backend/workflows/definitions/visual-editor',
}))

jest.mock('@xyflow/react', () => ({
  Handle: ({ id, 'aria-label': ariaLabel, ...rest }: Record<string, unknown>) => (
    <div data-handle-id={id as string} aria-label={ariaLabel as string} data-testid={rest['data-testid'] as string} />
  ),
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
  // Route chips (#4244) read the canvas zoom and the sibling routes from the
  // React Flow store; a default-zoom, single-edge store keeps this suite focused
  // on the error-route rendering it was written for.
  useStore: (selector: (store: { transform: [number, number, number]; edges: unknown[] }) => unknown) =>
    selector({ transform: [0, 0, 1], edges: [] }),
}))

import * as React from 'react'
import { screen } from '@testing-library/react'
import type { Node } from '@xyflow/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { AutomatedNode } from '../nodes/AutomatedNode'
import { WorkflowTransitionEdge } from '../WorkflowTransitionEdge'
import { DefinitionErrorHandlerField } from '../DefinitionErrorHandlerField'
import { EDGE_COLORS } from '../../lib/status-colors'
import { ERROR_SOURCE_HANDLE_ID } from '../../lib/error-routing'
import { nodeToFormValues, formValuesToNodeUpdates, type NodeFormValues } from '../../lib/nodeFormTransforms'
import { graphToDefinition, definitionToGraph } from '../../lib/graph-utils'

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(() => {
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    writable: true,
    value: ResizeObserverMock,
  })
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false
  if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => undefined
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined
})

function makeNode(data: Record<string, unknown> = {}): Node {
  return {
    id: 'charge_card',
    type: 'automated',
    position: { x: 0, y: 0 },
    data: { label: 'Charge card', ...data },
  } as unknown as Node
}

describe('error output handle', () => {
  test('an activity-bearing node exposes a labelled error source handle', () => {
    renderWithProviders(
      <AutomatedNode
        id="charge_card"
        data={{ label: 'Charge card' }}
        isConnectable
        selected={false}
        type="automated"
        dragging={false}
        zIndex={0}
        positionAbsoluteX={0}
        positionAbsoluteY={0}
      />
    )

    const errorHandle = screen.getByTestId('workflow-error-handle')
    expect(errorHandle).toHaveAttribute('data-handle-id', ERROR_SOURCE_HANDLE_ID)
    expect(errorHandle).toHaveAttribute('aria-label', 'On error')
  })
})

describe('error route edge rendering', () => {
  const edgeProps = {
    id: 'e_charge_card_refund',
    sourceX: 0,
    sourceY: 0,
    targetX: 10,
    targetY: 10,
    sourcePosition: 'right',
    targetPosition: 'left',
  } as unknown as Record<string, unknown>

  test('renders red dashed with a DS status token and an always-visible label', () => {
    renderWithProviders(<WorkflowTransitionEdge {...(edgeProps as never)} data={{ kind: 'error' }} />)

    const edge = screen.getByTestId('base-edge')
    expect(edge).toHaveAttribute('data-stroke', EDGE_COLORS.error.stroke)
    expect(EDGE_COLORS.error.stroke).toBe('var(--status-error-icon)')
    expect(edge).toHaveAttribute('data-dasharray', EDGE_COLORS.error.dashArray)
    expect(edge).toHaveAttribute('aria-label', 'On error')
    // Status is never color-only: the chip is visible without hovering.
    expect(screen.getByText('On error')).toBeInTheDocument()
  })

  test('a normal route keeps its pending styling and hover-only label', () => {
    renderWithProviders(
      <WorkflowTransitionEdge {...(edgeProps as never)} data={{ label: 'Approved' }} />
    )

    const edge = screen.getByTestId('base-edge')
    expect(edge).toHaveAttribute('data-stroke', EDGE_COLORS.pending.stroke)
    expect(screen.queryByText('Approved')).not.toBeInTheDocument()
  })
})

describe('error route graph round trip', () => {
  const nodes = [
    { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: { label: 'Start' } },
    { id: 'charge_card', type: 'automated', position: { x: 1, y: 0 }, data: { label: 'Charge card' } },
    { id: 'refund', type: 'automated', position: { x: 2, y: 0 }, data: { label: 'Refund' } },
  ] as unknown as Node[]

  test('an edge drawn from the error handle compiles to a kind:error transition and back', () => {
    const edges = [
      { id: 'e_start_charge_card', source: 'start', target: 'charge_card', data: { trigger: 'auto' } },
      {
        id: 'e_charge_card_refund',
        source: 'charge_card',
        target: 'refund',
        sourceHandle: ERROR_SOURCE_HANDLE_ID,
        data: { trigger: 'auto', kind: 'error' },
      },
    ] as never

    const definition = graphToDefinition(nodes, edges, { includePositions: true })
    const errorTransition = definition.transitions.find((t) => t.transitionId === 'e_charge_card_refund')
    expect(errorTransition.kind).toBe('error')
    // The recovery route never inherits the activity of the step that just failed.
    expect(errorTransition.activities).toBeUndefined()
    expect(definition.transitions.find((t) => t.transitionId === 'e_start_charge_card').kind).toBeUndefined()

    const graph = definitionToGraph(definition as never)
    const restored = graph.edges.find((edge) => edge.id === 'e_charge_card_refund')
    expect(restored?.sourceHandle).toBe(ERROR_SOURCE_HANDLE_ID)
    expect((restored?.data as Record<string, unknown>).kind).toBe('error')
    const normal = graph.edges.find((edge) => edge.id === 'e_start_charge_card')
    expect(normal?.sourceHandle).toBeUndefined()
    expect((normal?.data as Record<string, unknown>).kind).toBeUndefined()
  })

  test('a step error directive round-trips through the graph', () => {
    const directedNodes = [
      ...nodes.slice(0, 1),
      {
        ...nodes[1],
        data: { ...nodes[1].data, errorDirective: { mode: 'continueWithFallback', fallbackValue: { ok: false } } },
      },
      nodes[2],
    ] as unknown as Node[]
    const edges = [
      { id: 'e_start_charge_card', source: 'start', target: 'charge_card', data: { trigger: 'auto' } },
    ] as never

    const definition = graphToDefinition(directedNodes, edges, { includePositions: true })
    expect(definition.steps.find((s) => s.stepId === 'charge_card').errorDirective).toEqual({
      mode: 'continueWithFallback',
      fallbackValue: { ok: false },
    })
    expect(definition.steps.find((s) => s.stepId === 'refund').errorDirective).toBeUndefined()

    const graph = definitionToGraph(definition as never)
    expect((graph.nodes.find((n) => n.id === 'charge_card')!.data as Record<string, unknown>).errorDirective).toEqual({
      mode: 'continueWithFallback',
      fallbackValue: { ok: false },
    })
  })
})

describe('error directive picker', () => {
  test('reads the directive off node data and writes it back', () => {
    const values = nodeToFormValues(
      makeNode({ errorDirective: { mode: 'continueWithFallback', fallbackValue: { ok: false } } })
    )
    expect(values.errorDirectiveMode).toBe('continueWithFallback')
    expect(JSON.parse(values.errorDirectiveFallbackValue as string)).toEqual({ ok: false })

    const updates = formValuesToNodeUpdates(values as NodeFormValues, makeNode())
    expect(updates.errorDirective).toEqual({ mode: 'continueWithFallback', fallbackValue: { ok: false } })
  })

  test('defaults to fail and writes nothing when untouched', () => {
    const values = nodeToFormValues(makeNode())
    expect(values.errorDirectiveMode).toBe('fail')

    const updates = formValuesToNodeUpdates(values as NodeFormValues, makeNode())
    expect(updates.errorDirective).toBeUndefined()
  })

  test('parks without a fallback value for the failure-queue directive', () => {
    const updates = formValuesToNodeUpdates(
      { stepName: 'Charge card', errorDirectiveMode: 'failureQueue', errorDirectiveFallbackValue: '' } as NodeFormValues,
      makeNode()
    )
    expect(updates.errorDirective).toEqual({ mode: 'failureQueue' })
  })

  test('fails closed on an unparseable fallback value', () => {
    expect(() =>
      formValuesToNodeUpdates(
        {
          stepName: 'Charge card',
          errorDirectiveMode: 'continueWithFallback',
          errorDirectiveFallbackValue: '{ not json',
        } as NodeFormValues,
        makeNode()
      )
    ).toThrow('workflows.validation.errorDirectiveFallbackInvalid')
  })
})

describe('definition-level error handler picker', () => {
  test('offers the three forms and clears back to none', () => {
    const onChange = jest.fn()
    renderWithProviders(
      <DefinitionErrorHandlerField
        value={{ stepId: 'handle_failure' }}
        onChange={onChange}
        stepOptions={[{ stepId: 'handle_failure', label: 'Handle failure' }]}
      />
    )

    expect(screen.getByLabelText('On unhandled failure')).toBeInTheDocument()
    expect(screen.getByLabelText('Handler step')).toBeInTheDocument()
  })

  test('renders the workflow form when a handler workflow is declared', () => {
    renderWithProviders(
      <DefinitionErrorHandlerField
        value={{ workflowId: 'order-failure-handler' }}
        onChange={() => {}}
        stepOptions={[]}
      />
    )

    expect(screen.getByLabelText('Handler workflow id')).toHaveValue('order-failure-handler')
    expect(screen.queryByLabelText('Handler step')).not.toBeInTheDocument()
  })
})
