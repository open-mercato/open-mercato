/**
 * @jest-environment jsdom
 *
 * Prompt-to-draft in the Studio (spec section 9).
 *
 * These assertions pin the trust model end to end on the surface an author
 * touches:
 *
 *  - a model failure leaves the canvas byte-identical and SAYS SO — this
 *    module's recurring bug class is a surface that silently does nothing;
 *  - a generated definition the shared gate rejects is surfaced, never applied;
 *  - one generation is ONE entry on the EXISTING undo stack, however many nodes
 *    it minted;
 *  - nothing is published: no definition POST or PUT is issued by any of it.
 *
 * The model is never reached — the page talks to `/api/workflows/definitions/
 * generate` and that endpoint is stubbed here.
 */
import * as React from 'react'
import { act, fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn(), refresh: jest.fn() }),
  useSearchParams: () => ({ get: () => null, toString: () => '' }),
  usePathname: () => '/backend/workflows/definitions/visual-editor',
}))

type ApiCallArgs = [string, RequestInit | undefined]
const apiCalls: ApiCallArgs[] = []
let generateResponse: { ok: boolean; status: number; result: unknown } = {
  ok: true,
  status: 200,
  result: null,
}

const apiCallMock = jest.fn(async (url: string, init?: RequestInit) => {
  apiCalls.push([url, init])
  if (url === '/api/workflows/definitions/generate') return generateResponse
  return { ok: true, status: 200, result: { data: null } }
})

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => {
  const actual = jest.requireActual('@open-mercato/ui/backend/utils/apiCall')
  return {
    ...actual,
    apiCall: (...args: unknown[]) => apiCallMock(...(args as ApiCallArgs)),
  }
})

const flashMock = jest.fn()
jest.mock('@open-mercato/ui/backend/FlashMessages', () => {
  const actual = jest.requireActual('@open-mercato/ui/backend/FlashMessages')
  return { ...actual, flash: (...args: unknown[]) => flashMock(...args) }
})

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
jest.mock('../../../../components/WorkflowGraph', () => ({
  WorkflowGraph: ({ initialNodes }: { initialNodes?: StubNode[] }) => (
    <ul data-testid="canvas">
      {(initialNodes ?? []).map((node) => (
        <li key={node.id} data-testid="canvas-node">
          {String(node.data?.label ?? '')}
        </li>
      ))}
    </ul>
  ),
  WorkflowGraphReadOnly: () => null,
}))

import VisualEditorPage from '../page'

// jsdom does not implement structuredClone, which dagre uses while laying out
// the applied definition.
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

const GENERATED_DEFINITION = {
  steps: [
    { stepId: 'start', stepName: 'Start', stepType: 'START' },
    { stepId: 'approve', stepName: 'Approve refund', stepType: 'USER_TASK' },
    { stepId: 'notify', stepName: 'Notify customer', stepType: 'AUTOMATED' },
    { stepId: 'end', stepName: 'End', stepType: 'END' },
  ],
  transitions: [
    { transitionId: 't_1', fromStepId: 'start', toStepId: 'approve', trigger: 'auto' },
    { transitionId: 't_2', fromStepId: 'approve', toStepId: 'notify', trigger: 'auto' },
    { transitionId: 't_3', fromStepId: 'notify', toStepId: 'end', trigger: 'auto' },
  ],
}

function okResponse(definition: unknown, extra: Record<string, unknown> = {}) {
  return {
    ok: true,
    status: 200,
    result: {
      ok: true,
      summary: 'Routes refunds over 500 through a manager approval.',
      definition,
      problems: [],
      errorCount: 0,
      warningCount: 0,
      ...extra,
    },
  }
}

async function click(element: HTMLElement) {
  await act(async () => {
    fireEvent.click(element)
  })
}

function nodeLabels(): string[] {
  return screen.queryAllByTestId('canvas-node').map((node) => node.textContent ?? '')
}

async function openAiDraft() {
  // AI draft now lives in the toolbar's "More" overflow menu.
  await click(screen.getByRole('button', { name: /^More$/i }))
  await click(screen.getByRole('menuitem', { name: /AI draft/i }))
}

async function typePrompt(text: string) {
  await act(async () => {
    fireEvent.change(screen.getByTestId('workflow-ai-draft-prompt'), { target: { value: text } })
  })
}

async function generate() {
  await click(screen.getByTestId('workflow-ai-draft-generate'))
}

async function apply() {
  await click(screen.getByTestId('workflow-ai-draft-apply'))
}

function definitionWrites(): ApiCallArgs[] {
  return apiCalls.filter(
    ([url, init]) =>
      url.startsWith('/api/workflows/definitions') &&
      url !== '/api/workflows/definitions/generate' &&
      (init?.method === 'POST' || init?.method === 'PUT'),
  )
}

describe('visual editor AI draft (spec section 9)', () => {
  beforeEach(() => {
    stubMatchMedia()
    window.localStorage.clear()
    apiCalls.length = 0
    apiCallMock.mockClear()
    flashMock.mockClear()
    generateResponse = { ok: true, status: 200, result: null }
  })

  test('a generated draft applies to the canvas and never publishes anything', async () => {
    generateResponse = okResponse(GENERATED_DEFINITION)
    renderWithProviders(<VisualEditorPage />)

    await openAiDraft()
    await typePrompt('Approve refunds over 500')
    await generate()

    // Reviewed before applied: the draft is summarized with its Problems pass
    // and the canvas has not changed yet.
    expect(screen.getByTestId('workflow-ai-draft-review')).toBeInTheDocument()
    expect(nodeLabels()).toHaveLength(0)

    await apply()

    expect(nodeLabels()).toEqual(
      expect.arrayContaining(['Start', 'Approve refund', 'Notify customer', 'End']),
    )
    expect(definitionWrites()).toHaveLength(0)
  })

  test('one generation is ONE entry on the existing undo stack', async () => {
    generateResponse = okResponse(GENERATED_DEFINITION)
    renderWithProviders(<VisualEditorPage />)

    await openAiDraft()
    await typePrompt('Approve refunds over 500')
    await generate()
    await apply()
    expect(nodeLabels().length).toBe(4)

    // A single undo restores the prior (empty) document, not one node at a time.
    await act(async () => {
      fireEvent.keyDown(window, { key: 'z', metaKey: true })
    })

    expect(nodeLabels()).toHaveLength(0)
  })

  test('the checkpoint is NAMED after the prompt', async () => {
    generateResponse = okResponse(GENERATED_DEFINITION)
    renderWithProviders(<VisualEditorPage />)

    await openAiDraft()
    await typePrompt('Approve refunds over 500')
    await generate()
    await apply()

    await act(async () => {
      fireEvent.keyDown(window, { key: 'z', metaKey: true })
    })

    // The undo announcement names the checkpoint it just reverted, which is
    // what makes an AI edit a NAMED entry rather than an anonymous one.
    const messages = flashMock.mock.calls.map(([message]) => String(message))
    expect(messages.some((message) => /AI draft: Approve refunds over 500/.test(message))).toBe(true)
  })

  test('an unavailable model leaves the canvas untouched and says so', async () => {
    generateResponse = { ok: true, status: 200, result: { ok: false, reason: 'unavailable' } }
    renderWithProviders(<VisualEditorPage />)

    await openAiDraft()
    await typePrompt('Approve refunds over 500')
    await generate()

    const refusal = screen.getByTestId('workflow-ai-draft-refusal')
    expect(refusal).toHaveTextContent(/No AI provider is configured/i)
    expect(nodeLabels()).toHaveLength(0)
    expect(screen.queryByTestId('workflow-ai-draft-review')).not.toBeInTheDocument()
    expect(screen.getByTestId('workflow-ai-draft-apply')).toBeDisabled()
  })

  test('a failed model call leaves the canvas untouched and reports the reason', async () => {
    generateResponse = {
      ok: true,
      status: 200,
      result: { ok: false, reason: 'failed', message: 'rate limited' },
    }
    renderWithProviders(<VisualEditorPage />)

    await openAiDraft()
    await typePrompt('Approve refunds over 500')
    await generate()

    expect(screen.getByTestId('workflow-ai-draft-refusal')).toHaveTextContent(/rate limited/i)
    expect(nodeLabels()).toHaveLength(0)
    expect(definitionWrites()).toHaveLength(0)
  })

  test('a 403 is reported as a permission problem, not as silence', async () => {
    generateResponse = { ok: false, status: 403, result: { error: 'Insufficient permissions' } }
    renderWithProviders(<VisualEditorPage />)

    await openAiDraft()
    await typePrompt('Approve refunds over 500')
    await generate()

    expect(screen.getByTestId('workflow-ai-draft-refusal')).toHaveTextContent(
      /permission to create workflow definitions/i,
    )
    expect(nodeLabels()).toHaveLength(0)
  })

  test('a draft whose GRAPH the shared gate rejects is surfaced, not applied', async () => {
    // Schema-valid, but there is no START step — the engine would reject it,
    // and `evaluateCodeViewDraft` refuses it exactly as it refuses a pasted one.
    generateResponse = okResponse({
      steps: [
        { stepId: 'approve', stepName: 'Approve refund', stepType: 'USER_TASK' },
        { stepId: 'end', stepName: 'End', stepType: 'END' },
      ],
      transitions: [
        { transitionId: 't_1', fromStepId: 'approve', toStepId: 'end', trigger: 'auto' },
      ],
    })
    renderWithProviders(<VisualEditorPage />)

    await openAiDraft()
    await typePrompt('Approve refunds over 500')
    await generate()
    await apply()

    expect(screen.getByTestId('workflow-ai-draft-refusal')).toBeInTheDocument()
    expect(nodeLabels()).toHaveLength(0)
    expect(definitionWrites()).toHaveLength(0)
  })

  test('the prompt reaches the server and nothing else is written on the way', async () => {
    generateResponse = okResponse(GENERATED_DEFINITION)
    renderWithProviders(<VisualEditorPage />)

    await openAiDraft()
    await typePrompt('  Approve refunds over 500  ')
    await generate()

    const call = apiCalls.find(([url]) => url === '/api/workflows/definitions/generate')
    expect(call).toBeDefined()
    expect(JSON.parse(String(call![1]?.body))).toEqual({ prompt: 'Approve refunds over 500' })
    expect(definitionWrites()).toHaveLength(0)
  })
})
