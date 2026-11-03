/**
 * @jest-environment jsdom
 *
 * Step 3.14 (workflows UX Phase 3b): the compensation toggle on the canvas.
 *
 * React Flow itself is stubbed so the assertions land on what the canvas OWNS:
 * with the toggle on it hands React Flow the ghosts and the badged nodes, with
 * it off it hands over exactly the committed graph — and either way the ghosts
 * never touch the edge state the editor saves.
 */
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import type { Edge, Node } from '@xyflow/react'

jest.mock('@xyflow/react/dist/style.css', () => ({}), { virtual: true })

jest.mock('@xyflow/react', () => {
  const ReactModule = jest.requireActual<typeof import('react')>('react')
  return {
    ReactFlow: ({ nodes, edges, children }: { nodes: Node[]; edges: Edge[]; children?: React.ReactNode }) => (
      <div data-testid="react-flow">
        <div data-testid="rendered-edges">{edges.map((edge) => edge.id).join('|')}</div>
        <div data-testid="badged-nodes">
          {nodes
            .filter((node) => (node.data as { hasCompensation?: boolean }).hasCompensation)
            .map((node) => node.id)
            .join('|')}
        </div>
        {children}
      </div>
    ),
    Controls: () => null,
    Background: () => null,
    BackgroundVariant: { Dots: 'dots' },
    MiniMap: () => null,
    Panel: () => null,
    useNodesState: (initial: Node[]) => {
      const [nodes, setNodes] = ReactModule.useState(initial)
      return [nodes, setNodes, () => {}]
    },
    useEdgesState: (initial: Edge[]) => {
      const [edges, setEdges] = ReactModule.useState(initial)
      return [edges, setEdges, () => {}]
    },
    addEdge: (connection: unknown, edges: Edge[]) => edges,
    applyNodeChanges: (_changes: unknown, nodes: Node[]) => nodes,
    applyEdgeChanges: (_changes: unknown, edges: Edge[]) => edges,
    ConnectionMode: { Loose: 'loose' },
    MarkerType: { ArrowClosed: 'arrowclosed' },
    Handle: () => null,
    Position: { Left: 'left', Right: 'right', Top: 'top', Bottom: 'bottom' },
    BaseEdge: () => null,
    EdgeLabelRenderer: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    getBezierPath: () => ['M0,0 C0,0 0,0 0,0', 0, 0],
    ConnectionLineType: { Bezier: 'bezier' },
    useStore: (selector: (store: { transform: [number, number, number]; edges: unknown[] }) => unknown) =>
      selector({ transform: [0, 0, 1], edges: [] }),
    NodeResizer: () => null,
  }
})

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback?: string) => fallback ?? _key,
}))

import WorkflowGraphImpl from '../WorkflowGraphImpl'

const nodes: Node[] = [
  { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: { label: 'Start' } },
  { id: 'charge', type: 'automated', position: { x: 100, y: 0 }, data: { label: 'Charge' } },
  { id: 'end', type: 'end', position: { x: 200, y: 0 }, data: { label: 'End' } },
]

const edges: Edge[] = [
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
  { id: 't2', source: 'charge', target: 'end', data: { activities: [] } },
]

describe('compensation toggle on the canvas', () => {
  test('off by default: no ghosts and no badges', () => {
    render(<WorkflowGraphImpl initialNodes={nodes} initialEdges={edges} />)

    expect(screen.getByTestId('rendered-edges').textContent).toBe('t1|t2')
    expect(screen.getByTestId('badged-nodes').textContent).toBe('')
  })

  test('on: one dashed reverse ghost per compensating route, plus its node badge', () => {
    render(<WorkflowGraphImpl initialNodes={nodes} initialEdges={edges} showCompensation />)

    expect(screen.getByTestId('rendered-edges').textContent).toBe('t1|t2|compensation-ghost:t1')
    expect(screen.getByTestId('badged-nodes').textContent).toBe('start')
  })

  test('a graph without compensation renders identically with the toggle on', () => {
    const plainEdges: Edge[] = [{ id: 't2', source: 'charge', target: 'end', data: { activities: [] } }]

    render(<WorkflowGraphImpl initialNodes={nodes} initialEdges={plainEdges} showCompensation />)

    expect(screen.getByTestId('rendered-edges').textContent).toBe('t2')
    expect(screen.getByTestId('badged-nodes').textContent).toBe('')
  })

  test('ghosts are never reported to the page as edge changes', () => {
    const onEdgesChange = jest.fn()
    render(
      <WorkflowGraphImpl
        initialNodes={nodes}
        initialEdges={edges}
        showCompensation
        onEdgesChange={onEdgesChange}
      />,
    )

    expect(onEdgesChange).not.toHaveBeenCalled()
  })
})
