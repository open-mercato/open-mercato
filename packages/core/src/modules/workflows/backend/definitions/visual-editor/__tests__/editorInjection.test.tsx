/**
 * @jest-environment jsdom
 *
 * The editor publishes `workflows.definition.editor:toolbar` and `:banner` (lib/editor-injection.ts):
 * both spots see the current, unsaved trigger-relevant fields, banner widgets receive `onAfterSave`
 * after an explicit Save, and a banner widget's `onDataChange` may replace triggers, enabled and
 * version only.
 */
import * as React from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'

const mockSearch: { id: string | null } = { id: null }
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn(), refresh: jest.fn() }),
  useSearchParams: () => ({ get: (key: string) => (key === 'id' ? mockSearch.id : null), toString: () => '' }),
  usePathname: () => '/backend/workflows/definitions/visual-editor',
}))

const SAVED_DEFINITION = {
  id: 'wf-1',
  workflowId: 'deal_followup',
  workflowName: 'Deal follow-up',
  version: 2,
  enabled: true,
  source: 'user',
  updatedAt: '2026-10-09T10:00:00.000Z',
  definition: {
    steps: [
      { stepId: 'start', stepName: 'Start', stepType: 'START', preConditions: [{ ruleId: 'deal_check', required: true }] },
      { stepId: 'end', stepName: 'End', stepType: 'END' },
    ],
    transitions: [{ transitionId: 'start_to_end', fromStepId: 'start', toStepId: 'end', trigger: 'auto', priority: 0 }],
    triggers: [{ triggerId: 'deal_events', name: 'Deal events', eventPattern: 'customers.deal.*', enabled: true, priority: 0 }],
  },
}

const apiCallMock = jest.fn(async (url: string, init?: { method?: string }) => {
  if (url === '/api/workflows/definitions/wf-1' && init?.method === 'PUT') {
    return { ok: true, status: 200, result: { data: { ...SAVED_DEFINITION, updatedAt: '2026-10-10T10:00:00.000Z' } } }
  }
  if (url === '/api/workflows/definitions/wf-1' && !init?.method) {
    return { ok: true, status: 200, result: { data: SAVED_DEFINITION } }
  }
  if (url.endsWith('/draft')) return { ok: false, status: 404, result: null }
  return { ok: true, status: 200, result: { data: [] } }
})
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => {
  const actual = jest.requireActual('@open-mercato/ui/backend/utils/apiCall')
  return {
    ...actual,
    apiCall: (...args: unknown[]) => apiCallMock(...(args as [string, { method?: string }])),
  }
})

type SpotProps = { spotId: string; context: unknown; data?: unknown; onDataChange?: (data: unknown) => void; disabled?: boolean }
const spotProps = new Map<string, SpotProps>()
const triggerEventMock = jest.fn(async () => ({ ok: true }))
jest.mock('@open-mercato/ui/backend/injection/InjectionSpot', () => ({
  InjectionSpot: (props: SpotProps) => {
    spotProps.set(props.spotId, props)
    return <div data-testid={`spot:${props.spotId}`} />
  },
  useInjectionSpotEvents: (spotId: string) => ({
    triggerEvent: (...args: unknown[]) => (triggerEventMock as unknown as (...rest: unknown[]) => Promise<unknown>)(spotId, ...args),
    widgets: [],
  }),
}))

jest.mock('@open-mercato/ui/backend/inputs/EventSelect', () => ({
  useAvailableEvents: () => ({ events: [], isLoading: false }),
  EventSelect: () => null,
}))
jest.mock('../../../../components/DefinitionTriggersEditor', () => ({ DefinitionTriggersEditor: () => null }))
jest.mock('../../../../components/ContextSchemaEditor', () => ({ ContextSchemaEditor: () => null }))
jest.mock('../../../../components/DefinitionErrorHandlerField', () => ({ DefinitionErrorHandlerField: () => null }))
jest.mock('../../../../components/TemplateGalleryDialog', () => ({ TemplateGalleryDialog: () => null }))
jest.mock('../../../../components/WorkflowGraph', () => ({
  WorkflowGraph: () => <div data-testid="canvas" />,
  WorkflowGraphReadOnly: () => null,
}))
jest.mock('../../../../components/NodeEditDialogCrudForm', () => ({ NodeEditDialogCrudForm: () => null }))
jest.mock('../../../../components/NodeEditDialog', () => ({ NodeEditDialog: () => null }))
jest.mock('../../../../components/EdgeEditDialogCrudForm', () => ({ EdgeEditDialogCrudForm: () => null }))
jest.mock('../../../../components/EdgeEditDialog', () => ({ EdgeEditDialog: () => null }))

if (typeof globalThis.structuredClone !== 'function') {
  globalThis.structuredClone = (<T,>(value: T): T => JSON.parse(JSON.stringify(value))) as typeof structuredClone
}

import VisualEditorPage from '../page'
import {
  WORKFLOW_DEFINITION_EDITOR_BANNER_SPOT_ID,
  WORKFLOW_DEFINITION_EDITOR_TOOLBAR_SPOT_ID,
  readStartPreConditions,
  readWorkflowDefinitionEditorDataChange,
  workflowDefinitionEditorFormId,
} from '../../../../lib/editor-injection'

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

function fillIdentity() {
  act(() => {
    fireEvent.click(screen.getByRole('button', { name: /^More$/i }))
  })
  act(() => {
    fireEvent.click(screen.getByRole('menuitem', { name: /^Settings$/i }))
  })
  act(() => {
    fireEvent.change(document.getElementById('workflowId') as HTMLInputElement, { target: { value: 'deal_followup' } })
    fireEvent.change(document.getElementById('workflowName') as HTMLInputElement, { target: { value: 'Deal follow-up' } })
  })
  act(() => {
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
  })
}

const TRIGGER = { triggerId: 'deal_events', name: 'Deal events', eventPattern: 'customers.deal.*', enabled: true, priority: 0 }

describe('workflow definition editor injection spots', () => {
  beforeEach(() => {
    stubMatchMedia()
    window.localStorage.clear()
    spotProps.clear()
    apiCallMock.mockClear()
    triggerEventMock.mockClear()
    mockSearch.id = null
  })

  it('publishes the toolbar and banner spots with the unsaved trigger fields', () => {
    renderWithProviders(<VisualEditorPage />)
    fillIdentity()
    const toolbar = spotProps.get(WORKFLOW_DEFINITION_EDITOR_TOOLBAR_SPOT_ID)
    const banner = spotProps.get(WORKFLOW_DEFINITION_EDITOR_BANNER_SPOT_ID)
    expect(toolbar?.context).toEqual({ formId: 'workflows.definition.editor:new', recordId: null, codeOnly: false })
    expect(toolbar?.data).toEqual({ workflowId: 'deal_followup', version: 1, enabled: true, triggers: [], startPreConditions: [] })
    expect(banner?.context).toEqual(toolbar?.context)
    expect(typeof banner?.onDataChange).toBe('function')
  })

  it('lets a banner widget replace triggers, enabled and version only', () => {
    renderWithProviders(<VisualEditorPage />)
    fillIdentity()
    act(() => {
      spotProps.get(WORKFLOW_DEFINITION_EDITOR_BANNER_SPOT_ID)?.onDataChange?.({ workflowId: 'hijacked', version: 3, enabled: false, triggers: [TRIGGER] })
    })
    expect(spotProps.get(WORKFLOW_DEFINITION_EDITOR_TOOLBAR_SPOT_ID)?.data).toEqual({
      workflowId: 'deal_followup',
      version: 3,
      enabled: false,
      triggers: [expect.objectContaining({ triggerId: 'deal_events', eventPattern: 'customers.deal.*' })],
      startPreConditions: [],
    })
    act(() => {
      spotProps.get(WORKFLOW_DEFINITION_EDITOR_BANNER_SPOT_ID)?.onDataChange?.({ triggers: [{ triggerId: 'BAD ID' }] })
    })
    expect((spotProps.get(WORKFLOW_DEFINITION_EDITOR_TOOLBAR_SPOT_ID)?.data as { triggers: unknown[] }).triggers).toHaveLength(1)
  })

  it('dispatches onAfterSave to the banner spot after a successful explicit save of a loaded definition', async () => {
    mockSearch.id = 'wf-1'
    renderWithProviders(<VisualEditorPage />)
    await waitFor(() => expect((spotProps.get(WORKFLOW_DEFINITION_EDITOR_TOOLBAR_SPOT_ID)?.data as { startPreConditions?: unknown[] } | undefined)?.startPreConditions).toHaveLength(1))
    expect(spotProps.get(WORKFLOW_DEFINITION_EDITOR_TOOLBAR_SPOT_ID)?.data).toEqual({
      workflowId: 'deal_followup',
      version: 2,
      enabled: true,
      triggers: SAVED_DEFINITION.definition.triggers,
      startPreConditions: [{ ruleId: 'deal_check', required: true }],
    })
    expect(triggerEventMock).not.toHaveBeenCalled()
    act(() => {
      fireEvent.keyDown(window, { key: 's', metaKey: true })
    })
    await waitFor(() => expect(apiCallMock).toHaveBeenCalledWith('/api/workflows/definitions/wf-1', expect.objectContaining({ method: 'PUT' })))
    await waitFor(() => expect(triggerEventMock).toHaveBeenCalled())
    expect(triggerEventMock).toHaveBeenCalledWith(
      WORKFLOW_DEFINITION_EDITOR_BANNER_SPOT_ID,
      'onAfterSave',
      { workflowId: 'deal_followup', version: 2, enabled: true, triggers: SAVED_DEFINITION.definition.triggers, startPreConditions: [{ ruleId: 'deal_check', required: true }] },
      { formId: 'workflows.definition.editor:wf-1', recordId: 'wf-1', codeOnly: false },
    )
  })

  it('does not dispatch onAfterSave when the save fails', async () => {
    mockSearch.id = 'wf-1'
    apiCallMock.mockImplementationOnce(async () => ({ ok: true, status: 200, result: { data: SAVED_DEFINITION } }))
    apiCallMock.mockImplementationOnce(async () => ({ ok: false, status: 404, result: null }))
    apiCallMock.mockImplementationOnce(async () => ({ ok: false, status: 409, result: { error: 'conflict', code: 'record_conflict' } }))
    renderWithProviders(<VisualEditorPage />)
    await waitFor(() => expect((spotProps.get(WORKFLOW_DEFINITION_EDITOR_TOOLBAR_SPOT_ID)?.data as { startPreConditions?: unknown[] } | undefined)?.startPreConditions).toHaveLength(1))
    act(() => {
      fireEvent.keyDown(window, { key: 's', metaKey: true })
    })
    await waitFor(() => expect(apiCallMock).toHaveBeenCalledWith('/api/workflows/definitions/wf-1', expect.objectContaining({ method: 'PUT' })))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(triggerEventMock).not.toHaveBeenCalled()
  })
})

describe('editor injection helpers', () => {
  it('derive a stable form id and the START node pre-conditions', () => {
    expect(workflowDefinitionEditorFormId('abc')).toBe('workflows.definition.editor:abc')
    expect(workflowDefinitionEditorFormId(null)).toBe('workflows.definition.editor:new')
    expect(readStartPreConditions([{ type: 'end', data: {} }, { type: 'start', data: { preConditions: [{ ruleId: 'deal_check' }] } }])).toEqual([{ ruleId: 'deal_check', required: true }])
    expect(readStartPreConditions([{ type: 'start', data: { preConditions: [{ ruleId: '' }] } }])).toEqual([])
    expect(readStartPreConditions([])).toEqual([])
  })

  it('accept only valid triggers, enabled and version from a widget', () => {
    expect(readWorkflowDefinitionEditorDataChange({ version: 2, extra: 'ignored' })).toEqual({ version: 2 })
    expect(readWorkflowDefinitionEditorDataChange({ version: 0 })).toBeNull()
    expect(readWorkflowDefinitionEditorDataChange({ triggers: [{ ...TRIGGER, eventPattern: 'bad pattern' }] })).toBeNull()
    expect(readWorkflowDefinitionEditorDataChange(null)).toBeNull()
    expect(readWorkflowDefinitionEditorDataChange({})).toBeNull()
  })
})
