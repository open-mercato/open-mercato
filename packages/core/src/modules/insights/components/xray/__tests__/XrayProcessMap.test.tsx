/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, fireEvent, screen, within } from '@testing-library/react'
import type { Edge, Node } from '@xyflow/react'
import { deserialize, serialize } from 'node:v8'

if (typeof globalThis.structuredClone !== 'function') {
  Object.assign(globalThis, { structuredClone: <TValue,>(value: TValue): TValue => deserialize(serialize(value)) as TValue })
}

const mockApiFetch = jest.fn()

jest.mock('@xyflow/react/dist/style.css', () => ({}), { virtual: true })

jest.mock('@xyflow/react', () => {
  const ReactModule = jest.requireActual<typeof import('react')>('react')
  return {
  useNodesState: (initial: Node[]) => {
    const [nodes, setNodes] = ReactModule.useState(initial)
    return [nodes, setNodes, () => {}]
  },
  useEdgesState: (initial: Edge[]) => {
    const [edges, setEdges] = ReactModule.useState(initial)
    return [edges, setEdges, () => {}]
  },
  ReactFlow: ({ nodes, edges, nodeTypes, onSelectionChange, onNodesChange, onEdgesChange, deleteKeyCode, children }: {
    nodes: Node[]
    edges: Edge[]
    nodeTypes: Record<string, React.ComponentType<{ data: unknown; id: string }>>
    onSelectionChange?: (params: { nodes: Node[]; edges: Edge[] }) => void
    onNodesChange?: unknown
    onEdgesChange?: unknown
    deleteKeyCode?: unknown
    children?: React.ReactNode
  }) => (
    <div
      data-testid="react-flow"
      data-controlled-selection={typeof onNodesChange === 'function' && typeof onEdgesChange === 'function' ? 'true' : 'false'}
      data-delete-key={deleteKeyCode === null ? 'disabled' : 'enabled'}
    >
      {nodes.map((node) => {
        const Component = nodeTypes[node.type ?? '']
        return (
          <div key={node.id} data-testid={`flow-node-${node.id}`} aria-label={node.ariaLabel} data-width={String(node.width ?? '')} data-height={String(node.height ?? '')}>
            <Component id={node.id} data={node.data} />
            <button type="button" onClick={() => onSelectionChange?.({ nodes: [node], edges: [] })}>{`select ${node.id}`}</button>
          </div>
        )
      })}
      {edges.map((edge) => (
        <div
          key={edge.id}
          data-testid="flow-edge"
          data-source={edge.source}
          data-target={edge.target}
          data-dashed={edge.style?.strokeDasharray ? 'true' : 'false'}
          data-label={String(edge.label ?? '')}
          data-marker={JSON.stringify(edge.markerEnd ?? null)}
          aria-label={edge.ariaLabel}
        />
      ))}
      {children}
    </div>
  ),
  Background: () => null,
  BackgroundVariant: { Dots: 'dots' },
  Controls: () => null,
  Handle: () => null,
  MarkerType: { ArrowClosed: 'arrowclosed' },
  Position: { Left: 'left', Right: 'right', Top: 'top', Bottom: 'bottom' },
  }
})

jest.mock('next/dynamic', () => () => {
  const Canvas = jest.requireActual('../XrayProcessMapCanvas').default
  return Canvas
})

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  usePathname: () => '/backend/insights/process-xray/customers.deal',
  useSearchParams: () => new URLSearchParams(),
}))

jest.mock('@open-mercato/ui/backend/utils/api', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}))

import { XrayMapTab } from '../tabs/XrayMapTab'
import { EMPTY_XRAY_FILTERS } from '../../../lib/client/xray/api'
import { causes, envelope, fakeResponse, recordRequest, renderXray } from './xrayTestSupport'

function mapResponse() {
  return {
    ...envelope,
    suppressed: { cells: 2, minCases: 2, minActors: 0, complementary: 0 },
    events: { raw: 30, collapsed: 26, debounced: 3, corrected: 1 },
    casesStarted: 10,
    casesEnded: 6,
    truncatedCases: 0,
    nodes: [
      { activityKey: 'created', activityKind: 'lifecycle', raw: 10, collapsed: 10, cases: 10, causes: causes(10) },
      { activityKey: 'status:open', activityKind: 'stage', raw: 14, collapsed: 10, cases: 10, causes: causes(2, 8) },
      { activityKey: 'status:win', activityKind: 'stage', raw: 6, collapsed: 0, cases: 6, causes: causes(0) },
    ],
    edges: [
      { from: '__start__', to: 'created', raw: 10, collapsed: 10, cases: 10, causes: causes(10) },
      { from: 'created', to: 'status:open', raw: 14, collapsed: 10, cases: 10, causes: causes(2, 8) },
      { from: 'status:open', to: 'status:lost', raw: 7, collapsed: 7, cases: 7, causes: causes(7) },
      { from: 'status:open', to: 'status:win', raw: 6, collapsed: 0, cases: 6, causes: causes(6) },
    ],
    omitted: { nodes: 0, edges: 0 },
    activityLabels: { __start__: 'Start', __end__: 'End', created: 'Created', 'status:open': 'Status: In review', 'status:win': 'Status: Won' },
  }
}

function renderMapTab(overrides: Partial<React.ComponentProps<typeof XrayMapTab>> = {}) {
  const onClearActorFilters = jest.fn()
  const view = renderXray(
    <XrayMapTab
      processKey="customers.deal"
      window={{ kind: 'preset', key: '30d' }}
      filters={EMPTY_XRAY_FILTERS}
      onClearActorFilters={onClearActorFilters}
      {...overrides}
    />,
  )
  return { ...view, onClearActorFilters }
}

describe('XrayMapTab', () => {
  beforeEach(() => mockApiFetch.mockReset())

  it('renders steps hidden for privacy as placeholders with dashed transitions, plus n and the suppression notice', async () => {
    mockApiFetch.mockResolvedValue(fakeResponse(200, mapResponse()))
    renderMapTab()
    const flow = await screen.findByTestId('react-flow')
    expect(flow).toHaveAttribute('data-controlled-selection', 'true')
    expect(flow).toHaveAttribute('data-delete-key', 'disabled')
    const request = recordRequest(mockApiFetch.mock.calls[0][0], mockApiFetch.mock.calls[0][1])
    expect(request.url.pathname).toBe('/api/insights/xray/customers.deal/map')
    expect(request.url.searchParams.get('window')).toBe('30d')

    const hidden = screen.getByTestId('flow-node-node:status:lost')
    expect(within(hidden).getByText('Hidden (privacy)')).toBeInTheDocument()
    expect(within(hidden).getByText('Hidden step')).toBeInTheDocument()
    expect(hidden).toHaveAttribute('aria-label', 'Hidden step: counts hidden for privacy')
    const hiddenNode = within(hidden).getByTestId('xray-map-node-hidden')
    expect(hiddenNode).not.toHaveTextContent(/lost/i)
    expect(hiddenNode).not.toHaveAttribute('data-activity-key')
    const edges = screen.getAllByTestId('flow-edge')
    const dashed = edges.find((edge) => edge.getAttribute('data-target') === 'node:status:lost')
    expect(dashed).toHaveAttribute('data-dashed', 'true')
    expect(edges.find((edge) => edge.getAttribute('data-target') === 'node:status:open')).toHaveAttribute('data-dashed', 'false')

    expect(screen.getByTestId('xray-result-n')).toHaveTextContent('42 cases')
    expect(screen.getByTestId('xray-suppressed')).toHaveTextContent('2 hidden (privacy)')
    expect(screen.getByTestId('xray-map-hidden-note')).toHaveTextContent('1 steps are hidden (privacy)')
    expect(screen.getByTestId('xray-computed-through')).toBeInTheDocument()
  })

  it('shows the server labels on nodes and transitions, keeps the placeholder for hidden steps and sizes the map for readability', async () => {
    mockApiFetch.mockResolvedValue(fakeResponse(200, mapResponse()))
    renderMapTab()
    await screen.findByTestId('react-flow')
    const open = screen.getByTestId('flow-node-node:status:open')
    expect(within(open).getByText('Status: In review')).toBeInTheDocument()
    expect(open.getAttribute('aria-label')).toMatch(/^Status: In review: /)
    expect(Number(open.getAttribute('data-width'))).toBeGreaterThanOrEqual(176)
    expect(Number(open.getAttribute('data-height'))).toBeGreaterThan(0)
    for (const edge of screen.getAllByTestId('flow-edge')) {
      expect(JSON.parse(edge.getAttribute('data-marker') ?? 'null')).toEqual(expect.objectContaining({ markerUnits: 'userSpaceOnUse', width: 28, height: 28 }))
    }
    const intoHidden = screen.getAllByTestId('flow-edge').find((edge) => edge.getAttribute('data-target') === 'node:status:lost')
    expect(intoHidden?.getAttribute('aria-label')).toMatch(/^Status: In review to Hidden step: /)
    const map = screen.getByTestId('xray-process-map')
    const height = Number(map.getAttribute('data-map-height'))
    expect(height).toBeGreaterThanOrEqual(320)
    expect(height).toBeLessThanOrEqual(640)
    expect(map.style.height).toBe(`${height}px`)
    const table = screen.getByRole('table')
    expect(within(table).getAllByText('Status: In review').length).toBeGreaterThan(0)
    expect(within(table).getByText('Hidden step')).toBeInTheDocument()
    expect(within(table).queryByText(/status: lost/i)).toBeNull()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'select node:status:lost' }))
    })
    expect(screen.getByTestId('xray-map-selection')).toHaveTextContent('Hidden step')
    expect(screen.getByTestId('xray-map-selection')).not.toHaveTextContent(/lost/i)
  })

  it('switches between collapsed and raw counting', async () => {
    mockApiFetch.mockResolvedValue(fakeResponse(200, mapResponse()))
    renderMapTab()
    await screen.findByTestId('react-flow')
    expect(screen.queryByTestId('flow-node-node:status:win')).toBeNull()
    expect(screen.getAllByTestId('flow-edge').find((edge) => edge.getAttribute('data-target') === 'node:status:open')).toHaveAttribute('data-label', '10')

    await act(async () => {
      fireEvent.click(screen.getByRole('radio', { name: 'Raw' }))
    })
    expect(screen.getByTestId('flow-node-node:status:win')).toBeInTheDocument()
    expect(screen.getAllByTestId('flow-edge').find((edge) => edge.getAttribute('data-target') === 'node:status:open')).toHaveAttribute('data-label', '14')
    expect(mockApiFetch).toHaveBeenCalledTimes(1)
  })

  it('shows the selected step with a drill-down to its cases', async () => {
    mockApiFetch.mockResolvedValue(fakeResponse(200, mapResponse()))
    renderMapTab()
    await screen.findByTestId('react-flow')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'select node:status:open' }))
    })
    const details = screen.getByTestId('xray-map-selection')
    expect(details).toHaveTextContent('14 recorded, 10 after collapsing, in 10 cases')
    expect(within(details).getByRole('link', { name: 'View cases with this step' }))
      .toHaveAttribute('href', '/backend/insights/process-xray/customers.deal/cases?activity=status%3Aopen&w=30d')
  })

  it('offers no case drill-down for a step whose counts are hidden for privacy', async () => {
    mockApiFetch.mockResolvedValue(fakeResponse(200, mapResponse()))
    renderMapTab()
    await screen.findByTestId('react-flow')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'select node:status:lost' }))
    })
    const details = screen.getByTestId('xray-map-selection')
    expect(details).toHaveTextContent('The counts of this step are hidden for privacy.')
    expect(within(details).queryByRole('link')).toBeNull()
  })

  it('explains a role or team filter that is too narrow and offers to clear it', async () => {
    mockApiFetch.mockResolvedValue(fakeResponse(422, { error: 'translated', code: 'filter_too_narrow', hint: 'widen_actor_filter' }))
    const { onClearActorFilters } = renderMapTab({
      filters: { ...EMPTY_XRAY_FILTERS, actorRoleIds: ['aaaaaaaa-0000-4000-8000-000000000001'] },
    })
    const notice = await screen.findByTestId('xray-filter-too-narrow')
    expect(notice).toHaveTextContent('This filter would single out a small group')
    expect(notice).not.toHaveTextContent(/\d+ cases/)
    const request = recordRequest(mockApiFetch.mock.calls[0][0], mockApiFetch.mock.calls[0][1])
    expect(request.url.searchParams.get('actorRoleIds')).toBe('aaaaaaaa-0000-4000-8000-000000000001')
    fireEvent.click(within(notice).getByRole('button', { name: 'Clear role and team filters' }))
    expect(onClearActorFilters).toHaveBeenCalledTimes(1)
  })

  it('marks an incomplete projection instead of a computed-through time', async () => {
    mockApiFetch.mockResolvedValue(fakeResponse(200, { ...mapResponse(), incomplete: true, computedThrough: null, lowConfidence: true }))
    renderMapTab()
    expect(await screen.findByTestId('xray-incomplete')).toHaveTextContent('The data is still catching up')
    expect(screen.getByTestId('xray-low-confidence')).toHaveTextContent('Low confidence')
    expect(screen.queryByTestId('xray-computed-through')).toBeNull()
  })
})
