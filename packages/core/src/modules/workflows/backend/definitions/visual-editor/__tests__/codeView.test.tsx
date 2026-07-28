/**
 * @jest-environment jsdom
 *
 * Step 3.12 (workflows UX Phase 3b): Code view, stage 1 — read-only definition
 * JSON, a copy action, a paste-subgraph action through the SHARED clipboard
 * format, and the JSON-schema validation display. Editing the JSON is Phase 5,
 * so the assertions here deliberately prove the panel never writes to the graph
 * except through the same subgraph paste the canvas uses.
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
  await click(screen.getByRole('button', { name: /Show the definition JSON/i }))
}

function codeViewJson(): string {
  return screen.getByTestId('workflow-code-view-json').textContent ?? ''
}

describe('visual editor Code view (spec section 2.2, stage 1)', () => {
  beforeEach(() => {
    stubMatchMedia()
    window.localStorage.clear()
  })

  test('renders the assembled definition JSON read-only', async () => {
    stubClipboard({ text: '' })
    renderWithProviders(<VisualEditorPage />)

    await addStep(/USER TASK/)
    await openCodeView()

    const parsed = JSON.parse(codeViewJson())
    expect(parsed.steps).toHaveLength(1)
    expect(parsed.steps[0].stepType).toBe('USER_TASK')
    expect(screen.getByTestId('workflow-code-view-json').tagName).toBe('PRE')
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
