/**
 * @jest-environment jsdom
 *
 * Fidelity gap #7 — the inspector docks beside the canvas instead of covering it.
 *
 * The assertion that matters is structural, not cosmetic: on a wide viewport the
 * inspector must be a SIBLING of the canvas inside the editor's layout row, so
 * the graph narrows and stays visible. A panel rendered anywhere else is a modal
 * however it is styled, which is the thing being replaced.
 */
import * as React from 'react'
import { act, fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn(), refresh: jest.fn() }),
  useSearchParams: () => ({ get: () => null, toString: () => '' }),
  usePathname: () => '/backend/workflows/definitions/visual-editor',
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => {
  const actual = jest.requireActual('@open-mercato/ui/backend/utils/apiCall')
  return { ...actual, apiCall: jest.fn(async () => ({ data: { id: 'wf-1' } })) }
})

jest.mock('@open-mercato/ui/backend/inputs/EventSelect', () => ({
  useAvailableEvents: () => ({ events: [], isLoading: false }),
  EventSelect: () => null,
}))
jest.mock('../../../../components/DefinitionTriggersEditor', () => ({ DefinitionTriggersEditor: () => null }))
jest.mock('../../../../components/ContextSchemaEditor', () => ({ ContextSchemaEditor: () => null }))
jest.mock('../../../../components/DefinitionErrorHandlerField', () => ({ DefinitionErrorHandlerField: () => null }))
jest.mock('../../../../components/TemplateGalleryDialog', () => ({ TemplateGalleryDialog: () => null }))

type StubNode = { id: string; data: { label?: string } }
type StubEdge = { id: string }

jest.mock('../../../../components/WorkflowGraph', () => ({
  WorkflowGraph: ({
    initialNodes,
    onNodeClick,
    onEdgeClick,
  }: {
    initialNodes?: StubNode[]
    onNodeClick?: (event: unknown, node: StubNode) => void
    onEdgeClick?: (event: unknown, edge: StubEdge) => void
  }) => (
    <div data-testid="canvas">
      {(initialNodes ?? []).map((node) => (
        <button key={node.id} type="button" data-testid="canvas-node" onClick={() => onNodeClick?.({}, node)}>
          {String(node.data?.label ?? '')}
        </button>
      ))}
      <button type="button" data-testid="canvas-edge" onClick={() => onEdgeClick?.({}, { id: 'edge-1' })}>
        route
      </button>
    </div>
  ),
  WorkflowGraphReadOnly: () => null,
}))

jest.mock('../../../../components/NodeEditDialogCrudForm', () => ({
  NodeEditDialogCrudForm: ({ isOpen, variant }: { isOpen: boolean; variant?: string }) =>
    isOpen ? <div data-testid="node-inspector" data-variant={variant} /> : null,
}))
jest.mock('../../../../components/EdgeEditDialogCrudForm', () => ({
  EdgeEditDialogCrudForm: ({ isOpen, variant }: { isOpen: boolean; variant?: string }) =>
    isOpen ? <div data-testid="edge-inspector" data-variant={variant} /> : null,
}))
jest.mock('../../../../components/NodeEditDialog', () => ({ NodeEditDialog: () => null }))
jest.mock('../../../../components/EdgeEditDialog', () => ({ EdgeEditDialog: () => null }))

import VisualEditorPage from '../page'

/**
 * `useIsMobile` and the editor's own compact check both read `matchMedia`, and
 * they read DIFFERENT breakpoints — so the stub has to answer per query or the
 * two viewport cases cannot be told apart.
 */
function stubViewport(widthPx: number) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => {
      const max = /max-width:\s*(\d+)px/.exec(query)
      return {
        matches: max ? widthPx <= Number(max[1]) : false,
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      }
    },
  })
}

// The editor starts with an empty canvas, so a step has to exist before one can
// be inspected.
function addStep() {
  act(() => {
    fireEvent.click(screen.getByRole('button', { name: /USER TASK/ }))
  })
}

function openStepInspector() {
  act(() => {
    fireEvent.click(screen.getAllByTestId('canvas-node')[0])
  })
}

describe('visual editor — docked inspector', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    window.localStorage.clear()
  })

  test('a wide viewport renders the step inspector inside the canvas row', () => {
    stubViewport(1600)
    renderWithProviders(<VisualEditorPage />)
    addStep()

    openStepInspector()

    const panel = screen.getByTestId('node-inspector')
    expect(panel).toHaveAttribute('data-variant', 'docked')
    // Sibling of the canvas, not a portal over it.
    expect(screen.getByTestId('workflow-editor-row').contains(panel)).toBe(true)
    expect(screen.getByTestId('canvas')).toBeInTheDocument()
  })

  test('a compact viewport keeps the modal shape', () => {
    stubViewport(1100)
    renderWithProviders(<VisualEditorPage />)
    addStep()

    openStepInspector()

    // The compact viewport renders its own single-column layout, which has no
    // row to dock into at all — so the inspector asks for the modal shape.
    expect(screen.getByTestId('node-inspector')).toHaveAttribute('data-variant', 'overlay')
    expect(screen.queryByTestId('workflow-editor-row')).toBeNull()
  })

  test('only one rail is open at a time once the canvas stays clickable', () => {
    stubViewport(1600)
    renderWithProviders(<VisualEditorPage />)
    addStep()

    act(() => {
      fireEvent.click(screen.getByTestId('canvas-edge'))
    })
    expect(screen.getByTestId('edge-inspector')).toBeInTheDocument()

    // With a modal this was unreachable; with a rail the canvas is live, so the
    // step click must close the route rail rather than stack a second one.
    openStepInspector()
    expect(screen.getByTestId('node-inspector')).toBeInTheDocument()
    expect(screen.queryByTestId('edge-inspector')).toBeNull()

    act(() => {
      fireEvent.click(screen.getByTestId('canvas-edge'))
    })
    expect(screen.getByTestId('edge-inspector')).toBeInTheDocument()
    expect(screen.queryByTestId('node-inspector')).toBeNull()
  })

  test('Escape from the canvas closes a docked rail', () => {
    stubViewport(1600)
    renderWithProviders(<VisualEditorPage />)
    addStep()

    openStepInspector()
    expect(screen.getByTestId('node-inspector')).toBeInTheDocument()

    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' })
    })
    expect(screen.queryByTestId('node-inspector')).toBeNull()
  })
})
