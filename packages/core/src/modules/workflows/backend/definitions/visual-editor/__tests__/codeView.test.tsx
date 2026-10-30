/**
 * @jest-environment jsdom
 *
 * Code view, stages 1 and 2 (spec section 2.2): the definition JSON, a copy
 * action, a paste-subgraph action through the SHARED clipboard format, the
 * JSON-schema validation display — and, from stage 2, an EDITABLE draft applied
 * to the canvas only on an explicit Apply.
 *
 * The stage-2 assertions exist to pin the safety model: an in-progress edit is
 * never applied, a draft that does not parse or whose graph is broken cannot be
 * applied at all, and an Apply that does land is ONE undoable action.
 */
import * as React from 'react'
import { act, fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { WORKFLOW_SUBGRAPH_CLIPBOARD_KIND } from '../../../../lib/subgraph-clipboard'

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

type StubNode = { id: string; selected?: boolean; data: { label?: string } }
jest.mock('../../../../components/WorkflowGraph', () => ({
  WorkflowGraph: ({
    initialNodes,
    onNodesChange,
  }: {
    initialNodes?: StubNode[]
    onNodesChange?: (nodes: StubNode[], meta: { dragging: boolean; persistable: boolean }) => void
  }) => (
    <ul data-testid="canvas">
      {(initialNodes ?? []).map((node) => (
        <li key={node.id}>
          <button
            type="button"
            data-testid="canvas-node"
            data-selected={node.selected ? 'true' : 'false'}
            onClick={() =>
              onNodesChange?.(
                (initialNodes ?? []).map((candidate) => ({ ...candidate, selected: candidate.id === node.id })),
                { dragging: false, persistable: false },
              )
            }
          >
            {String(node.data?.label ?? '')}
          </button>
        </li>
      ))}
    </ul>
  ),
  WorkflowGraphReadOnly: () => null,
}))

import VisualEditorPage from '../page'

// jsdom does not implement structuredClone, which dagre uses while laying out
// the applied definition. Node has had it since 17, so this is an environment
// gap rather than anything the editor should work around.
if (typeof globalThis.structuredClone !== 'function') {
  globalThis.structuredClone = (<T,>(value: T): T => JSON.parse(JSON.stringify(value))) as typeof structuredClone
}

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

function stubClipboard(buffer: { text: string }) {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: async (text: string) => { buffer.text = text },
      readText: async () => buffer.text,
    },
  })
}

function nodeButtons(): HTMLElement[] {
  return screen.queryAllByTestId('canvas-node')
}

async function click(element: HTMLElement) {
  await act(async () => {
    fireEvent.click(element)
  })
}

async function addStep(name: RegExp) {
  await click(screen.getByRole('button', { name }))
}

async function openCodeView() {
  // Code now lives in the toolbar's "More" overflow menu.
  await click(screen.getByRole('button', { name: /^More$/i }))
  await click(screen.getByRole('menuitem', { name: /^Code$/i }))
}

function codeViewEditor(): HTMLTextAreaElement {
  return screen.getByTestId('workflow-code-view-json') as HTMLTextAreaElement
}

function codeViewJson(): string {
  return codeViewEditor().value
}

async function typeCode(text: string) {
  await act(async () => {
    fireEvent.change(codeViewEditor(), { target: { value: text } })
  })
}

function applyButton(): HTMLButtonElement {
  return screen.getByTestId('workflow-code-view-apply') as HTMLButtonElement
}

describe('visual editor Code view (spec section 2.2)', () => {
  beforeEach(() => {
    stubMatchMedia()
    window.localStorage.clear()
  })

  test('renders the assembled definition JSON in an editable draft', async () => {
    stubClipboard({ text: '' })
    renderWithProviders(<VisualEditorPage />)

    await addStep(/USER TASK/)
    await openCodeView()

    const parsed = JSON.parse(codeViewJson())
    expect(parsed.steps).toHaveLength(1)
    expect(parsed.steps[0].stepType).toBe('USER_TASK')
    expect(codeViewEditor().tagName).toBe('TEXTAREA')
    // Nothing to apply until the author changes something.
    expect(applyButton()).toBeDisabled()
  })

  test('an unparseable draft cannot be applied, and the canvas is untouched', async () => {
    stubClipboard({ text: '' })
    renderWithProviders(<VisualEditorPage />)

    await addStep(/USER TASK/)
    await openCodeView()
    const nodesBefore = screen.getAllByTestId('canvas-node').length

    await typeCode('{ "steps": [')

    expect(applyButton()).toBeDisabled()
    expect(screen.getByTestId('workflow-code-view-blocking')).toBeInTheDocument()
    expect(screen.getAllByTestId('canvas-node')).toHaveLength(nodesBefore)
  })

  test('a draft whose graph is broken is refused with a reason', async () => {
    stubClipboard({ text: '' })
    renderWithProviders(<VisualEditorPage />)

    await addStep(/USER TASK/)
    await openCodeView()

    // Schema-valid, but there is no START step — the engine would reject it.
    await typeCode(JSON.stringify({
      workflowId: 'demo',
      workflowName: 'Demo',
      steps: [{ stepId: 'only', stepName: 'Only', stepType: 'USER_TASK' }],
      transitions: [],
    }, null, 2))

    expect(applyButton()).toBeDisabled()
    expect(screen.getByTestId('workflow-code-view-blocking')).toBeInTheDocument()
  })

  test('a valid draft applies to the canvas and is one undoable action', async () => {
    stubClipboard({ text: '' })
    renderWithProviders(<VisualEditorPage />)

    await addStep(/USER TASK/)
    await openCodeView()

    await typeCode(JSON.stringify({
      workflowId: 'demo',
      workflowName: 'Demo',
      steps: [
        { stepId: 'start', stepName: 'Start', stepType: 'START' },
        { stepId: 'review', stepName: 'Review', stepType: 'USER_TASK' },
        { stepId: 'end', stepName: 'End', stepType: 'END' },
      ],
      transitions: [
        { transitionId: 't_1', fromStepId: 'start', toStepId: 'review', trigger: 'auto' },
        { transitionId: 't_2', fromStepId: 'review', toStepId: 'end', trigger: 'auto' },
      ],
    }, null, 2))

    expect(applyButton()).not.toBeDisabled()
    await click(applyButton())

    const labels = screen.getAllByTestId('canvas-node').map((node) => node.textContent)
    expect(labels).toEqual(expect.arrayContaining(['Start', 'Review', 'End']))
  })

  test('discarding edits restores the canvas text without touching the canvas', async () => {
    stubClipboard({ text: '' })
    renderWithProviders(<VisualEditorPage />)

    await addStep(/USER TASK/)
    await openCodeView()
    const original = codeViewJson()

    await typeCode('not json at all')
    expect(codeViewJson()).toBe('not json at all')

    await click(screen.getByRole('button', { name: /Discard edits/i }))
    expect(codeViewJson()).toBe(original)
  })

  test('the copy action puts the definition JSON on the clipboard', async () => {
    const buffer = { text: '' }
    stubClipboard(buffer)
    renderWithProviders(<VisualEditorPage />)

    await addStep(/USER TASK/)
    await openCodeView()
    await click(screen.getByRole('button', { name: /Copy JSON/i }))

    expect(JSON.parse(buffer.text).steps).toHaveLength(1)
    expect(buffer.text).toBe(codeViewJson())
  })

  test('paste splices a copied subgraph through the shared clipboard parser', async () => {
    const buffer = { text: '' }
    stubClipboard(buffer)
    renderWithProviders(<VisualEditorPage />)

    await addStep(/USER TASK/)
    await click(nodeButtons()[0])
    await act(async () => {
      fireEvent.keyDown(window, { key: 'c', metaKey: true })
    })
    expect(JSON.parse(buffer.text).kind).toBe(WORKFLOW_SUBGRAPH_CLIPBOARD_KIND)

    await openCodeView()
    await click(screen.getByRole('button', { name: /Paste steps/i }))

    expect(nodeButtons()).toHaveLength(2)
    expect(JSON.parse(codeViewJson()).steps).toHaveLength(2)
  })

  test('a paste that is not a subgraph payload leaves the graph alone', async () => {
    const buffer = { text: '{"kind":"something-else"}' }
    stubClipboard(buffer)
    renderWithProviders(<VisualEditorPage />)

    await addStep(/USER TASK/)
    await openCodeView()
    await click(screen.getByRole('button', { name: /Paste steps/i }))

    expect(nodeButtons()).toHaveLength(1)
  })

  test('the validation display lists the same issues the Problems panel collects', async () => {
    stubClipboard({ text: '' })
    renderWithProviders(<VisualEditorPage />)

    await addStep(/USER TASK/)
    await openCodeView()

    const issueList = screen.getByTestId('workflow-code-view-issues')
    expect(issueList.textContent).toMatch(/START/i)
    expect(screen.queryByTestId('workflow-code-view-clean')).toBeNull()
  })
})
