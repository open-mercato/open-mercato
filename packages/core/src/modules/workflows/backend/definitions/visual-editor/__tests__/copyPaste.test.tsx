/**
 * @jest-environment jsdom
 *
 * Step 3.7 (workflows UX Phase 3b): copy / paste / duplicate of a selected
 * subgraph. jsdom cannot perform a real clipboard gesture, so this drives the
 * page's own keyboard path with a stubbed `navigator.clipboard` and asserts what
 * the page owns: the payload it writes, the splice it performs, that a paste is
 * exactly one undo entry, and that a denied clipboard degrades visibly instead
 * of doing nothing.
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

// Canvas stub: lists the nodes and exposes React Flow's selection change, which
// is the only way the page learns what is selected.
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

function stubClipboard(buffer: { text: string }, options: { deny?: boolean } = {}) {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: async (text: string) => {
        if (options.deny) throw new Error('[internal] clipboard denied')
        buffer.text = text
      },
      readText: async () => {
        if (options.deny) throw new Error('[internal] clipboard denied')
        return buffer.text
      },
    },
  })
}

async function press(key: string) {
  await act(async () => {
    fireEvent.keyDown(window, { key, metaKey: true })
  })
}

function nodeButtons(): HTMLElement[] {
  return screen.queryAllByTestId('canvas-node')
}

async function addAndSelectUserTask() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /USER TASK/ }))
  })
  await act(async () => {
    fireEvent.click(nodeButtons()[0])
  })
}

describe('visual editor copy/paste/duplicate (spec section 4.5)', () => {
  beforeEach(() => {
    stubMatchMedia()
    window.localStorage.clear()
  })

  test('copy writes the portable payload and paste splices one undoable copy', async () => {
    const buffer = { text: '' }
    stubClipboard(buffer)
    renderWithProviders(<VisualEditorPage />)

    await addAndSelectUserTask()
    await press('c')

    const payload = JSON.parse(buffer.text)
    expect(payload.kind).toBe(WORKFLOW_SUBGRAPH_CLIPBOARD_KIND)
    expect(payload.steps).toHaveLength(1)
    expect(payload.steps[0].stepType).toBe('USER_TASK')

    await press('v')
    expect(nodeButtons()).toHaveLength(2)

    await press('z')
    expect(nodeButtons()).toHaveLength(1)
  })

  test('duplicate copies the selection in place without touching the clipboard', async () => {
    const buffer = { text: 'untouched' }
    stubClipboard(buffer)
    renderWithProviders(<VisualEditorPage />)

    await addAndSelectUserTask()
    await press('d')

    expect(nodeButtons()).toHaveLength(2)
    expect(buffer.text).toBe('untouched')

    await press('z')
    expect(nodeButtons()).toHaveLength(1)
  })

  test('a denied clipboard still copies within the editor and pastes from that buffer', async () => {
    const buffer = { text: '' }
    stubClipboard(buffer, { deny: true })
    renderWithProviders(<VisualEditorPage />)

    await addAndSelectUserTask()
    await press('c')
    expect(buffer.text).toBe('')

    await press('v')
    expect(nodeButtons()).toHaveLength(2)
  })

  test('copying nothing leaves the graph and the clipboard alone', async () => {
    const buffer = { text: 'untouched' }
    stubClipboard(buffer)
    renderWithProviders(<VisualEditorPage />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /USER TASK/ }))
    })
    await press('c')
    expect(buffer.text).toBe('untouched')

    await press('v')
    expect(nodeButtons()).toHaveLength(1)
  })
})
