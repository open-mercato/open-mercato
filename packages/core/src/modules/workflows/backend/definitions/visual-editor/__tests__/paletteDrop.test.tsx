/**
 * @jest-environment jsdom
 *
 * Step 3.8 (workflows UX Phase 3b): drag-from-palette, insert-on-route and
 * drag-an-action-onto-a-route.
 *
 * jsdom cannot perform an HTML5 drag gesture, so the canvas is stubbed and the
 * page's `onCanvasDrop` contract is driven directly — the same payload
 * `WorkflowGraphImpl` builds from `screenToFlowPosition` plus the route under
 * the cursor. What is asserted here is the page wiring: which effect each drop
 * target triggers, that it is undoable, and that the click-append path still
 * works for keyboard users.
 */
import * as React from 'react'
import { act, fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { WORKFLOW_PALETTE_DRAG_MIME, type PaletteDragItem } from '../../../../lib/palette-drag'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn(), refresh: jest.fn() }),
  useSearchParams: () => ({ get: () => null, toString: () => '' }),
  usePathname: () => '/backend/workflows/definitions/visual-editor',
}))

jest.mock('@open-mercato/ui/backend/inputs/EventSelect', () => ({
  useAvailableEvents: () => ({ events: [], isLoading: false }),
  EventSelect: () => null,
}))

jest.mock('../../../../components/DefinitionTriggersEditor', () => ({ DefinitionTriggersEditor: () => null }))
jest.mock('../../../../components/ContextSchemaEditor', () => ({ ContextSchemaEditor: () => null }))
jest.mock('../../../../components/DefinitionErrorHandlerField', () => ({ DefinitionErrorHandlerField: () => null }))
jest.mock('../../../../components/TemplateGalleryDialog', () => ({ TemplateGalleryDialog: () => null }))
jest.mock('../../../../components/NodeEditDialogCrudForm', () => ({ NodeEditDialogCrudForm: () => null }))
jest.mock('../../../../components/NodeEditDialog', () => ({ NodeEditDialog: () => null }))
jest.mock('../../../../components/EdgeEditDialogCrudForm', () => ({ EdgeEditDialogCrudForm: () => null }))
jest.mock('../../../../components/EdgeEditDialog', () => ({ EdgeEditDialog: () => null }))

type StubNode = { id: string; data: { label?: string } }
type StubEdge = { id: string; source: string; target: string; data?: { activities?: unknown[] } }
type StubDropEvent = { dataTransfer: unknown; position: { x: number; y: number }; edgeId: string | null }

// Canvas stub: mirrors the graph as readable rows and exposes the two callbacks
// the drop path needs — `onConnect` to author a route to drop onto, and
// `onCanvasDrop` with the payload the real graph resolves from a drag event.
jest.mock('../../../../components/WorkflowGraph', () => ({
  WorkflowGraph: ({
    initialNodes,
    initialEdges,
    onConnect,
    onCanvasDrop,
  }: {
    initialNodes?: StubNode[]
    initialEdges?: StubEdge[]
    onConnect?: (connection: { source: string; target: string }) => void
    onCanvasDrop?: (event: StubDropEvent) => void
  }) => {
    const nodes = initialNodes ?? []
    const edges = initialEdges ?? []
    const drop = (item: PaletteDragItem, edgeId: string | null) => {
      const store: Record<string, string> = { [WORKFLOW_PALETTE_DRAG_MIME]: JSON.stringify(item) }
      onCanvasDrop?.({
        dataTransfer: { types: Object.keys(store), getData: (type: string) => store[type] ?? '' },
        position: { x: 320, y: 480 },
        edgeId,
      })
    }
    return (
      <div data-testid="canvas">
        {nodes.map((node) => (
          <span key={node.id} data-testid="canvas-node">{String(node.data?.label ?? '')}</span>
        ))}
        {edges.map((edge) => (
          <span
            key={edge.id}
            data-testid="canvas-edge"
            data-source={edge.source}
            data-target={edge.target}
            data-activities={String((edge.data?.activities ?? []).length)}
          />
        ))}
        <button type="button" data-testid="connect" onClick={() => onConnect?.({ source: nodes[0].id, target: nodes[1].id })}>
          connect
        </button>
        <button type="button" data-testid="drop-step-canvas" onClick={() => drop({ kind: 'step', nodeType: 'automated' }, null)}>
          drop step on canvas
        </button>
        <button type="button" data-testid="drop-step-route" onClick={() => drop({ kind: 'step', nodeType: 'automated' }, edges[0]?.id ?? null)}>
          drop step on route
        </button>
        <button type="button" data-testid="drop-action-route" onClick={() => drop({ kind: 'activity', activityType: 'SEND_EMAIL' }, edges[0]?.id ?? null)}>
          drop action on route
        </button>
        <button type="button" data-testid="drop-action-canvas" onClick={() => drop({ kind: 'activity', activityType: 'SEND_EMAIL' }, null)}>
          drop action on canvas
        </button>
      </div>
    )
  },
  WorkflowGraphReadOnly: () => null,
}))

import VisualEditorPage from '../page'

function stubMatchMedia() {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  })
}

function click(testId: string) {
  act(() => {
    fireEvent.click(screen.getByTestId(testId))
  })
}

function clickPalette(name: RegExp) {
  act(() => {
    fireEvent.click(screen.getByRole('button', { name }))
  })
}

function nodes() {
  return screen.queryAllByTestId('canvas-node')
}

function edges() {
  return screen.queryAllByTestId('canvas-edge')
}

function undo() {
  act(() => {
    fireEvent.keyDown(window, { key: 'z', metaKey: true })
  })
}

function buildRoute() {
  clickPalette(/START/)
  clickPalette(/^END/)
  click('connect')
}

describe('visual editor palette drops (spec sections 4.2 and 4.4)', () => {
  beforeEach(() => {
    stubMatchMedia()
    window.localStorage.clear()
  })

  test('a step dropped on empty canvas is added, and the click path still appends', () => {
    renderWithProviders(<VisualEditorPage />)

    clickPalette(/USER TASK/)
    expect(nodes()).toHaveLength(1)

    click('drop-step-canvas')
    expect(nodes()).toHaveLength(2)

    undo()
    expect(nodes()).toHaveLength(1)
  })

  test('a step dropped on a route is spliced between its endpoints, undoably', () => {
    renderWithProviders(<VisualEditorPage />)

    buildRoute()
    expect(edges()).toHaveLength(1)
    const originalTarget = edges()[0].getAttribute('data-target')

    click('drop-step-route')
    expect(nodes()).toHaveLength(3)
    expect(edges()).toHaveLength(2)

    const [first, second] = edges()
    expect(first.getAttribute('data-target')).not.toBe(originalTarget)
    expect(second.getAttribute('data-source')).toBe(first.getAttribute('data-target'))
    expect(second.getAttribute('data-target')).toBe(originalTarget)

    undo()
    expect(nodes()).toHaveLength(2)
    expect(edges()).toHaveLength(1)
    expect(edges()[0].getAttribute('data-target')).toBe(originalTarget)
  })

  test('an action dropped on a route is appended to that route, undoably', () => {
    renderWithProviders(<VisualEditorPage />)

    buildRoute()
    expect(edges()[0].getAttribute('data-activities')).toBe('0')

    click('drop-action-route')
    expect(edges()[0].getAttribute('data-activities')).toBe('1')

    undo()
    expect(edges()[0].getAttribute('data-activities')).toBe('0')
  })

  test('an action dropped on empty canvas changes nothing — it needs a route', () => {
    renderWithProviders(<VisualEditorPage />)

    buildRoute()

    click('drop-action-canvas')
    expect(nodes()).toHaveLength(2)
    expect(edges()).toHaveLength(1)
    expect(edges()[0].getAttribute('data-activities')).toBe('0')
  })
})
