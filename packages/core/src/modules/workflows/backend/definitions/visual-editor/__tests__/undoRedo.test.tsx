/**
 * @jest-environment jsdom
 *
 * Step 3.6 (workflows UX Phase 3b): undo/redo across the whole editor document.
 *
 * The stack lives in the page, not in a dialog, so an inspector save must be
 * undoable after the dialog has closed. The canvas and the inspector are stubbed
 * — this exercises the page's own wiring (commit on save, Cmd+Z restore,
 * Cmd+Shift+Z redo, redo invalidation), not React Flow.
 */
import * as React from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import type { NodeTypeConversionDraft } from '../../../../components/NodeEditDialogCrudForm'

const mockConfirm = jest.fn()
jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  ...jest.requireActual('@open-mercato/ui/backend/confirm-dialog'),
  useConfirmDialog: () => ({ confirm: mockConfirm, ConfirmDialogElement: null }),
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn(), refresh: jest.fn() }),
  useSearchParams: () => ({ get: () => null, toString: () => '' }),
  usePathname: () => '/backend/workflows/definitions/visual-editor',
}))

jest.mock('@open-mercato/ui/backend/inputs/EventSelect', () => ({
  useAvailableEvents: () => ({ events: [], isLoading: false }),
  EventSelect: () => null,
}))

jest.mock('../../../../components/DefinitionTriggersEditor', () => ({
  DefinitionTriggersEditor: () => null,
}))
jest.mock('../../../../components/ContextSchemaEditor', () => ({
  ContextSchemaEditor: () => null,
}))
jest.mock('../../../../components/DefinitionErrorHandlerField', () => ({
  DefinitionErrorHandlerField: () => null,
}))
jest.mock('../../../../components/TemplateGalleryDialog', () => ({
  TemplateGalleryDialog: () => null,
}))

// Canvas stub: renders every node label so the test can read the document, and
// forwards a click as React Flow's node click so the inspector can be opened.
type StubNode = { id: string; type?: string; data: { label?: string } }
jest.mock('../../../../components/WorkflowGraph', () => ({
  WorkflowGraph: ({
    initialNodes,
    onNodeClick,
  }: {
    initialNodes?: StubNode[]
    onNodeClick?: (event: unknown, node: StubNode) => void
  }) => (
    <ul data-testid="canvas">
      {(initialNodes ?? []).map((node) => (
        <li key={node.id}>
          <button type="button" data-testid="canvas-node" data-node-type={node.type} onClick={() => onNodeClick?.({}, node)}>
            {String(node.data?.label ?? '')}
          </button>
        </li>
      ))}
    </ul>
  ),
  WorkflowGraphReadOnly: () => null,
}))

// Inspector stub: one button that saves a renamed step, exactly like the node
// dialog's submit, then closes itself.
jest.mock('../../../../components/NodeEditDialogCrudForm', () => ({
  NodeEditDialogCrudForm: ({
    node,
    isOpen,
    onSave,
    onClose,
    onConvertType,
  }: {
    node: { id: string } | null
    isOpen: boolean
    onSave: (nodeId: string, updates: Record<string, unknown>) => void
    onClose: () => void
    onConvertType: (nodeId: string, targetType: 'automated', draft: NodeTypeConversionDraft) => Promise<boolean | void>
  }) =>
    isOpen && node ? (
      <><button
        type="button"
        data-testid="inspector-save"
        onClick={() => {
          onSave(node.id, { label: 'Renamed step' })
          onClose()
        }}
      >
        save
      </button>
      <button type="button" data-testid="inspector-convert" onClick={() => {
        void onConvertType(node.id, 'automated', { updates: { label: 'Converted draft', stepName: 'Converted draft' } })
      }}>convert</button></>
    ) : null,
}))
jest.mock('../../../../components/NodeEditDialog', () => ({ NodeEditDialog: () => null }))
jest.mock('../../../../components/EdgeEditDialogCrudForm', () => ({ EdgeEditDialogCrudForm: () => null }))
jest.mock('../../../../components/EdgeEditDialog', () => ({ EdgeEditDialog: () => null }))

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

function pressUndo(shiftKey = false) {
  act(() => {
    fireEvent.keyDown(window, { key: 'z', metaKey: true, shiftKey })
  })
}

function canvasLabels(): string[] {
  return screen.getAllByTestId('canvas-node').map((element) => element.textContent ?? '')
}

describe('visual editor undo/redo (spec section 4.5)', () => {
  beforeEach(() => {
    stubMatchMedia()
    window.localStorage.clear()
    mockConfirm.mockReset()
  })

  function addUserTaskStep() {
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /USER TASK/ }))
    })
  }

  function saveFromInspector() {
    act(() => {
      fireEvent.click(screen.getAllByTestId('canvas-node')[0])
    })
    act(() => {
      fireEvent.click(screen.getByTestId('inspector-save'))
    })
  }

  test('conversion commits submitted edits only after confirmation and undoes them together', async () => {
    let resolveConfirmation: (confirmed: boolean) => void = () => undefined
    mockConfirm.mockImplementation(() => new Promise<boolean>((resolve) => { resolveConfirmation = resolve }))
    renderWithProviders(<VisualEditorPage />)
    addUserTaskStep()
    fireEvent.click(screen.getAllByTestId('canvas-node')[0])
    fireEvent.click(screen.getByTestId('inspector-convert'))

    expect(canvasLabels()).toEqual(['New User Task'])
    expect(screen.getByTestId('canvas-node')).toHaveAttribute('data-node-type', 'userTask')
    expect(screen.queryByTestId('inspector-convert')).toBeNull()
    await act(async () => { resolveConfirmation(true) })

    await waitFor(() => expect(canvasLabels()).toEqual(['Converted draft']))
    expect(screen.getByTestId('canvas-node')).toHaveAttribute('data-node-type', 'automated')
    pressUndo()
    expect(canvasLabels()).toEqual(['New User Task'])
    expect(screen.getByTestId('canvas-node')).toHaveAttribute('data-node-type', 'userTask')
  })

  test('cancelled conversion reopens the inspector without changing the saved node', async () => {
    mockConfirm.mockResolvedValue(false)
    renderWithProviders(<VisualEditorPage />)
    addUserTaskStep()
    fireEvent.click(screen.getAllByTestId('canvas-node')[0])
    fireEvent.click(screen.getByTestId('inspector-convert'))

    await screen.findByTestId('inspector-convert')
    expect(canvasLabels()).toEqual(['New User Task'])
    expect(screen.getByTestId('canvas-node')).toHaveAttribute('data-node-type', 'userTask')
  })

  test('an inspector save is undoable after the dialog closed, and redoable', () => {
    renderWithProviders(<VisualEditorPage />)

    addUserTaskStep()
    expect(canvasLabels()).toEqual(['New User Task'])

    saveFromInspector()
    expect(canvasLabels()).toEqual(['Renamed step'])
    expect(screen.queryByTestId('inspector-save')).toBeNull()

    pressUndo()
    expect(canvasLabels()).toEqual(['New User Task'])

    pressUndo(true)
    expect(canvasLabels()).toEqual(['Renamed step'])
  })

  test('undo walks back past the step that was added, and a new edit invalidates redo', () => {
    renderWithProviders(<VisualEditorPage />)

    addUserTaskStep()
    saveFromInspector()

    pressUndo()
    pressUndo()
    expect(screen.queryAllByTestId('canvas-node')).toHaveLength(0)

    addUserTaskStep()
    pressUndo(true)
    expect(canvasLabels()).toEqual(['New User Task'])
  })

  test('a keystroke inside a text field never triggers undo', () => {
    renderWithProviders(<VisualEditorPage />)

    addUserTaskStep()
    saveFromInspector()

    // The definition fields live in the details drawer. Cmd+Z is suppressed
    // both because a field has focus and because a modal overlay is up — the
    // guarantee under test is that neither path reaches the canvas history.
    // Settings (the details drawer trigger) now lives in the "More" overflow menu.
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /^More$/i }))
    })
    act(() => {
      fireEvent.click(screen.getByRole('menuitem', { name: /^Settings$/i }))
    })
    const nameInput = document.getElementById('workflowName') as HTMLInputElement
    act(() => {
      nameInput.focus()
      fireEvent.keyDown(window, { key: 'z', metaKey: true })
    })
    expect(canvasLabels()).toEqual(['Renamed step'])
  })
})
