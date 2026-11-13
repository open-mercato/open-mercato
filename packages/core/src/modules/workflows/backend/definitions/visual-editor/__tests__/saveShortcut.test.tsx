/**
 * @jest-environment jsdom
 *
 * Step 3.11 follow-up: the command palette advertises Cmd+S for Save, so the
 * shortcut has to exist and has to behave like the toolbar button.
 *
 * These assert that the editor CLAIMS the keystroke (preventDefault, so the
 * browser's own Save dialog never opens) under exactly the conditions where it
 * should, and releases it otherwise. What the save then does is the save path's
 * own concern with its own tests; wiring a runnable graph through this stubbed
 * canvas would exercise React Flow, not the binding.
 */
import * as React from 'react'
import { act, fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn(), refresh: jest.fn() }),
  useSearchParams: () => ({ get: () => null, toString: () => '' }),
  usePathname: () => '/backend/workflows/definitions/visual-editor',
}))

const apiCallMock = jest.fn(async () => ({ data: { id: 'wf-1' } }))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => {
  const actual = jest.requireActual('@open-mercato/ui/backend/utils/apiCall')
  return {
    ...actual,
    apiCall: (...args: unknown[]) => apiCallMock(...(args as [])),
  }
})

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

type StubNode = { id: string; data: { label?: string } }
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
          <button type="button" data-testid="canvas-node" onClick={() => onNodeClick?.({}, node)}>
            {String(node.data?.label ?? '')}
          </button>
        </li>
      ))}
    </ul>
  ),
  WorkflowGraphReadOnly: () => null,
}))

jest.mock('../../../../components/NodeEditDialogCrudForm', () => ({
  NodeEditDialogCrudForm: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="node-dialog" /> : null,
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

// fireEvent returns false when a handler cancelled the event, true when nothing
// claimed it — which is exactly the distinction under test.
function pressSaveWasClaimed(overrides: Partial<KeyboardEventInit> = {}): boolean {
  let notCancelled = true
  act(() => {
    notCancelled = fireEvent.keyDown(window, { key: 's', metaKey: true, ...overrides })
  })
  return !notCancelled
}

// The identity fields live in the details drawer now, so filling them means
// opening it. Closed again afterwards, because the canvas bindings under test
// are suppressed while a modal overlay is up.
function openDetails() {
  // Settings (the details drawer trigger) now lives in the "More" overflow menu.
  act(() => {
    fireEvent.click(screen.getByRole('button', { name: /^More$/i }))
  })
  act(() => {
    fireEvent.click(screen.getByRole('menuitem', { name: /^Settings$/i }))
  })
}

function closeDetails() {
  act(() => {
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
  })
}

function fillIdentity({ keepOpen = false }: { keepOpen?: boolean } = {}) {
  openDetails()
  const id = document.getElementById('workflowId') as HTMLInputElement
  const name = document.getElementById('workflowName') as HTMLInputElement
  act(() => {
    fireEvent.change(id, { target: { value: 'shortcut_test' } })
    fireEvent.change(name, { target: { value: 'Shortcut test' } })
  })
  if (!keepOpen) closeDetails()
}

function addUserTaskStep() {
  act(() => {
    fireEvent.click(screen.getByRole('button', { name: /USER TASK/ }))
  })
}

describe('visual editor Cmd+S save shortcut', () => {
  beforeEach(() => {
    stubMatchMedia()
    window.localStorage.clear()
    apiCallMock.mockClear()
  })

  test('the editor claims Cmd+S so the browser save dialog never opens', () => {
    renderWithProviders(<VisualEditorPage />)
    fillIdentity()
    addUserTaskStep()

    expect(pressSaveWasClaimed()).toBe(true)
  })

  test('Cmd+Shift+S is left to the browser', () => {
    renderWithProviders(<VisualEditorPage />)
    fillIdentity()
    addUserTaskStep()

    expect(pressSaveWasClaimed({ shiftKey: true })).toBe(false)
  })

  test('an open dialog releases the shortcut so the dialog keeps its own submit', () => {
    renderWithProviders(<VisualEditorPage />)
    fillIdentity()
    addUserTaskStep()
    act(() => {
      fireEvent.click(screen.getAllByTestId('canvas-node')[0])
    })
    expect(screen.getByTestId('node-dialog')).toBeTruthy()

    expect(pressSaveWasClaimed()).toBe(false)
  })

  test('Cmd+S is claimed even while a text field has focus', () => {
    renderWithProviders(<VisualEditorPage />)
    fillIdentity()
    addUserTaskStep()
    // Re-open the drawer: its name field is the text input under test, and the
    // drawer is deliberately NOT one of the surfaces that release Cmd+S.
    openDetails()

    const nameInput = document.getElementById('workflowName') as HTMLInputElement
    act(() => {
      nameInput.focus()
    })

    expect(pressSaveWasClaimed()).toBe(true)
  })
})
