/**
 * @jest-environment jsdom
 *
 * Issue #5988 (b) — the step inspector's "Input data" panel.
 *
 * The panel lists the edited step's incoming context ledger. A step the author
 * has just dropped on the canvas has no incoming route yet, so the fixpoint
 * gives it an EMPTY ledger and the panel opened on nothing: 0 rows, and a search
 * box that could not match anything typed into it. Such a step now borrows the
 * context the run starts with (trigger payload / mapping and contextSchema
 * inputs), while a wired step keeps its own — richer — incoming view.
 */
import * as React from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'

if (typeof globalThis.structuredClone !== 'function') {
  globalThis.structuredClone = ((value: unknown) => JSON.parse(JSON.stringify(value))) as typeof structuredClone
}

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
;(window as unknown as { ResizeObserver: unknown }).ResizeObserver = MockResizeObserver

if (typeof window !== 'undefined') {
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false
  if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => undefined
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined
}

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn(), refresh: jest.fn() }),
  useSearchParams: () => ({
    get: (key: string) => (key === 'template' ? 'lead-to-install' : null),
    toString: () => 'template=lead-to-install',
  }),
  usePathname: () => '/backend/definitions/visual-editor',
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => {
  const actual = jest.requireActual('@open-mercato/ui/backend/utils/apiCall')
  return {
    ...actual,
    apiCall: jest.fn(async (url: string) => {
      if (String(url).includes('/api/workflows/templates')) {
        return {
          ok: true,
          status: 200,
          result: { items: [jest.requireActual('../../../../examples/templates/lead-to-install.json')] },
          response: {},
          cacheStatus: null,
        }
      }
      return { ok: true, status: 200, result: {}, response: {}, cacheStatus: null }
    }),
  }
})

jest.mock('@open-mercato/ui/backend/inputs/EventSelect', () => ({
  useAvailableEvents: () => ({ events: [], isLoading: false }),
  EventSelect: () => null,
}))
jest.mock('../../../../components/DefinitionTriggersEditor', () => ({ DefinitionTriggersEditor: () => null }))
jest.mock('../../../../components/ContextSchemaEditor', () => ({ ContextSchemaEditor: () => null }))
jest.mock('../../../../components/DefinitionErrorHandlerField', () => ({ DefinitionErrorHandlerField: () => null }))
jest.mock('../../../../components/TemplateGalleryDialog', () => ({ TemplateGalleryDialog: () => null }))

type StubNode = { id: string; type?: string; data: { label?: string } }

jest.mock('../../../../components/WorkflowGraph', () => ({
  WorkflowGraph: ({
    initialNodes,
    onNodeClick,
  }: {
    initialNodes?: StubNode[]
    onNodeClick?: (event: unknown, node: StubNode) => void
  }) => (
    <div data-testid="canvas">
      {(initialNodes ?? []).map((node) => (
        <button
          key={node.id}
          type="button"
          data-testid={`canvas-node-${node.id}`}
          onClick={() => onNodeClick?.({}, node)}
        >
          {node.id}
        </button>
      ))}
    </div>
  ),
  WorkflowGraphReadOnly: () => null,
}))

import VisualEditorPage from '../page'

const TEMPLATE_STEP_IDS = [
  'start',
  'enrich_lead',
  'first_call',
  'wait_contract_signed',
  'confirm_installation',
  'end',
]

function stubWideViewport() {
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

async function renderEditorWithTemplate() {
  stubWideViewport()
  renderWithProviders(<VisualEditorPage />)
  await waitFor(() => expect(screen.queryByTestId('canvas-node-first_call')).toBeTruthy(), { timeout: 5000 })
}

function openStep(stepId: string) {
  act(() => {
    fireEvent.click(screen.getByTestId(`canvas-node-${stepId}`))
  })
}

function inputDataPanel() {
  return screen.getByLabelText('workflows.inputDataPanel.title')
}

describe('visual editor — step inspector input data', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('lists the incoming context of a wired step', async () => {
    await renderEditorWithTemplate()
    openStep('first_call')

    await waitFor(() => expect(screen.queryByLabelText('workflows.inputDataPanel.title')).toBeTruthy())
    // `pipelineStage` is written by the route that leads INTO this step, so it
    // only ever appears in the step's own incoming view.
    expect(inputDataPanel()).toHaveTextContent('pipelineStage')
    expect(inputDataPanel()).toHaveTextContent('dealId')
  })

  it('offers the run-entry context on a step that is not wired yet, and searches it', async () => {
    await renderEditorWithTemplate()

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /USER TASK/ }))
    })
    const addedStep = screen
      .getAllByTestId(/^canvas-node-/)
      .map((element) => element.getAttribute('data-testid') ?? '')
      .find((testId) => !TEMPLATE_STEP_IDS.includes(testId.replace('canvas-node-', '')))
    expect(addedStep).toBeTruthy()

    act(() => {
      fireEvent.click(screen.getByTestId(addedStep as string))
    })
    await waitFor(() => expect(screen.queryByLabelText('workflows.inputDataPanel.title')).toBeTruthy())

    expect(inputDataPanel()).toHaveTextContent('dealId')
    expect(inputDataPanel()).toHaveTextContent('__trigger.eventName')

    act(() => {
      fireEvent.change(screen.getByLabelText('workflows.variablePicker.searchPlaceholder'), {
        target: { value: 'deal' },
      })
    })

    expect(inputDataPanel()).toHaveTextContent('dealId')
    expect(inputDataPanel()).not.toHaveTextContent('__trigger.eventName')
  })
})
