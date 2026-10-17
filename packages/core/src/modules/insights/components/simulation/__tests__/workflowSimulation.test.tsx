/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import insightsEn from '../../../i18n/en.json'
import workflowsEn from '../../../../workflows/i18n/en.json'

const mockApiCall = jest.fn()
const mockApiCallOrThrow = jest.fn()
const mockRunMutation = jest.fn((input: { operation: () => Promise<unknown> }) => input.operation().then((result) => ({ result })))
const mockFlash = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => mockApiCall(...args),
  apiCallOrThrow: (...args: unknown[]) => mockApiCallOrThrow(...args),
}))
jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: (input: { operation: () => Promise<unknown> }) => mockRunMutation(input),
    retryLastMutation: jest.fn(),
  }),
}))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: (...args: unknown[]) => mockFlash(...args) }))
jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: async () => true, ConfirmDialogElement: null }),
}))
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
  usePathname: () => '/backend/definitions/visual-editor',
  useSearchParams: () => new URLSearchParams(),
}))

import WorkflowSimulateWidget from '../../../widgets/injection/workflow-simulate/widget.client'
import WorkflowSimulationApplyWidget from '../../../widgets/injection/workflow-simulation-apply/widget.client'
import workflowSimulateModule from '../../../widgets/injection/workflow-simulate/widget'
import workflowSimulationApplyModule from '../../../widgets/injection/workflow-simulation-apply/widget'
import { SimulationRunPageClient } from '../SimulationRunPage.client'
import { readPendingSimulationDecision, rememberPendingSimulationRun, resetPendingSimulationRuns } from '../../../lib/client/simulation/pendingDecisions'
import { buildTriggerBacktestProposal, describeTriggerBacktestGroup, triggerBacktestProposalToEditorChange } from '../../../lib/client/simulation/triggerBacktest'

const DICT = { ...insightsEn, ...workflowsEn } as Record<string, string>
const RUN_ID = 'aaaaaaaa-0000-4000-8000-000000000002'
const DEFINITION_ID = 'bbbbbbbb-0000-4000-8000-000000000002'
const FORM_ID = `workflows.definition.editor:${DEFINITION_ID}`
const CELLS = ['would_start', 'would_not_start', 'debounced', 'cannot_tell']

const TRIGGER = { triggerId: 'deal_events', name: 'Deal events', eventPattern: 'customers.deal.*', enabled: true, priority: 0, config: { debounceMs: 3_600_000 } }
const QUIET = { triggerId: 'quiet', name: 'Quiet', eventPattern: 'customers.deal.deleted', enabled: true, priority: 0 }

const EDITOR_DATA = {
  workflowId: 'deal_followup',
  version: 2,
  enabled: true,
  triggers: [TRIGGER],
  startPreConditions: [],
}

function ok(result: unknown, status = 200) {
  return { ok: true, status, result, response: {} as Response, cacheStatus: null }
}

function failed(status: number, result: unknown) {
  return { ok: false, status, result, response: {} as Response, cacheStatus: null }
}

const CAPABILITIES = {
  canRun: true,
  kinds: [{ kind: 'workflows.trigger_backtest', artifactKind: 'workflows.definition', labelKey: 'workflows.simulation.kind.triggerBacktest', cellKeys: CELLS }],
  limits: { defaultWindowDays: 90, maxWindowDays: 365, maxRecords: 50000, maxDurationMs: 120000 },
}

function cell(key: string, count: number | null, extra: Record<string, unknown> = {}) {
  return { key, count, suppressed: null, samples: [], ...extra }
}

function runDetail(overrides: Record<string, unknown> = {}) {
  return {
    id: RUN_ID,
    kind: 'workflows.trigger_backtest',
    kindLabelKey: 'workflows.simulation.kind.triggerBacktest',
    status: 'completed',
    artifactKind: 'workflows.definition',
    artifactId: DEFINITION_ID,
    progressJobId: null,
    fidelity: 'reconstructed',
    errorCode: null,
    windowFrom: '2026-07-01T00:00:00.000Z',
    windowTo: '2026-10-01T00:00:00.000Z',
    createdAt: '2026-10-01T00:00:00.000Z',
    startedAt: '2026-10-01T00:00:01.000Z',
    completedAt: '2026-10-01T00:00:05.000Z',
    expiresAt: '2026-10-31T00:00:00.000Z',
    cellKeys: CELLS,
    proposal: { ...EDITOR_DATA, version: 3, enabled: false, triggers: [TRIGGER, QUIET] },
    result: {
      k: 10,
      truncated: false,
      groups: [
        {
          key: 'deal_events:customers.deal.created',
          labelKey: null,
          sampleResourceKind: 'customers.deal',
          total: 40,
          suppressed: false,
          cells: [cell('would_start', 30), cell('would_not_start', 0), cell('debounced', 10), cell('cannot_tell', 0)],
          warnings: [],
          flags: [],
        },
        {
          key: 'quiet',
          labelKey: null,
          sampleResourceKind: null,
          total: 0,
          suppressed: false,
          cells: CELLS.map((key) => cell(key, 0)),
          warnings: ['workflows.simulation.warnings.noEvents'],
          flags: [],
        },
      ],
    },
    coverage: { reconstructed_events: 40 },
    caveats: ['workflows.simulation.caveats.firstOrder', 'workflows.simulation.caveats.debounceProcess'],
    budgets: { maxRecords: 50000, maxDurationMs: 120000, recordsUsed: 40, elapsedMs: 900 },
    decisions: [],
    applyHref: `/backend/definitions/visual-editor?id=${DEFINITION_ID}&simulationRunId=${RUN_ID}`,
    canDecide: true,
    ...overrides,
  }
}

function routeReads(runs: Array<Record<string, unknown>>) {
  let index = 0
  mockApiCall.mockImplementation((input: unknown, init?: { method?: string }) => {
    const url = String(input)
    if (url.endsWith('/capabilities')) return Promise.resolve(ok(CAPABILITIES))
    if (url.endsWith('/decision') && init?.method === 'POST') return Promise.resolve(ok({ ok: true }, 201))
    if (url.includes(`/api/insights/simulations/${RUN_ID}`)) {
      const run = runs[Math.min(index, runs.length - 1)]
      index += 1
      return Promise.resolve(ok({ ok: true, result: run }))
    }
    return Promise.resolve(failed(404, { error: 'missing', code: 'run_not_found' }))
  })
}

function renderUi(ui: React.ReactElement) {
  return renderWithProviders(ui, { dict: DICT })
}

beforeEach(() => {
  jest.clearAllMocks()
  resetPendingSimulationRuns()
  window.history.replaceState(null, '', '/backend/definitions/visual-editor')
})

describe('workflow simulate widget', () => {
  it('is gated on insights.simulator.run on the workflow editor spots', () => {
    expect(workflowSimulateModule.metadata.features).toEqual(['insights.simulator.run'])
    expect(workflowSimulateModule.metadata.requiredModules).toEqual(['workflows'])
    expect(workflowSimulationApplyModule.metadata.features).toEqual(['insights.simulator.run'])
    expect(typeof workflowSimulationApplyModule.eventHandlers?.onAfterSave).toBe('function')
  })

  it('stays hidden when the viewer may not run the trigger backtest', async () => {
    mockApiCall.mockResolvedValue(ok({ ...CAPABILITIES, kinds: [{ ...CAPABILITIES.kinds[0], kind: 'business_rules.rule_backtest' }] }))
    renderUi(<WorkflowSimulateWidget context={{ formId: FORM_ID, recordId: DEFINITION_ID }} data={EDITOR_DATA} />)
    await waitFor(() => expect(mockApiCall).toHaveBeenCalled())
    expect(screen.queryByTestId('workflow-simulate-open')).toBeNull()
  })

  it('submits the CURRENT unsaved triggers with Cmd+Enter, shows trigger headings and remembers the run for the save', async () => {
    jest.useFakeTimers()
    try {
      routeReads([runDetail({ status: 'queued', result: null, completedAt: null, fidelity: null }), runDetail()])
      mockApiCallOrThrow.mockResolvedValue({ ok: true, runId: RUN_ID, progressJobId: null, status: 'queued', deduplicated: false })
      const view = renderUi(<WorkflowSimulateWidget context={{ formId: FORM_ID, recordId: DEFINITION_ID }} data={EDITOR_DATA} />)
      fireEvent.click(await screen.findByTestId('workflow-simulate-open'))
      expect(screen.getByText(DICT['insights.simulation.ui.workflowSimulate.title'])).toBeTruthy()
      view.rerender(<WorkflowSimulateWidget context={{ formId: FORM_ID, recordId: DEFINITION_ID }} data={{ ...EDITOR_DATA, enabled: false, triggers: [TRIGGER, QUIET] }} />)
      fireEvent.keyDown(await screen.findByTestId('simulation-request-dialog'), { key: 'Enter', metaKey: true })
      await waitFor(() => expect(mockApiCallOrThrow).toHaveBeenCalled())
      const [url, init] = mockApiCallOrThrow.mock.calls[0] as [string, { body: string }]
      expect(url).toBe('/api/insights/simulations')
      expect(JSON.parse(init.body)).toEqual({
        kind: 'workflows.trigger_backtest',
        artifactId: DEFINITION_ID,
        window: { days: 90 },
        proposal: { workflowId: 'deal_followup', version: 2, enabled: false, triggers: [TRIGGER, QUIET], startPreConditions: [] },
      })
      expect(await screen.findByText(DICT['insights.simulation.ui.run.queued'])).toBeTruthy()
      await act(async () => {
        jest.advanceTimersByTime(2100)
      })
      const result = await screen.findByTestId('simulation-request-result')
      const headlines = within(result).getAllByTestId('simulation-group-headline')
      expect(within(headlines[0]).getByText('customers.deal.created')).toBeTruthy()
      expect(within(headlines[0]).getByText('Trigger “Deal events” · customers.deal.*')).toBeTruthy()
      expect(within(headlines[0]).getByText(DICT['workflows.simulation.cells.would_start'])).toBeTruthy()
      expect(within(headlines[0]).getByText(DICT['workflows.simulation.cells.debounced'])).toBeTruthy()
      expect(within(headlines[1]).getByText('Trigger “Quiet”')).toBeTruthy()
      expect(within(headlines[1]).getByText(DICT['workflows.simulation.warnings.noEvents'])).toBeTruthy()
      expect(within(result).getByText(DICT['insights.simulation.ui.workflowSimulate.decisionHint'])).toBeTruthy()
      expect(readPendingSimulationDecision(FORM_ID, DEFINITION_ID)).toEqual({ runId: RUN_ID, recordId: DEFINITION_ID, source: 'dialog' })
    } finally {
      jest.useRealTimers()
    }
  })

  it('shows the not_customized refusal of a code-defined workflow', async () => {
    routeReads([runDetail()])
    mockApiCallOrThrow.mockRejectedValue(Object.assign(new Error('refused'), { status: 422, code: 'not_customized', error: 'refused' }))
    renderUi(<WorkflowSimulateWidget context={{ formId: 'workflows.definition.editor:code:flow', recordId: 'code:flow' }} data={EDITOR_DATA} />)
    fireEvent.click(await screen.findByTestId('workflow-simulate-open'))
    fireEvent.click(await screen.findByTestId('simulation-request-submit'))
    expect((await screen.findByTestId('simulation-request-error')).textContent).toContain(DICT['insights.simulation.errors.not_customized'])
    expect(JSON.parse((mockApiCallOrThrow.mock.calls[0] as [string, { body: string }])[1].body).artifactId).toBe('code:flow')
  })
})

describe('workflow simulation apply widget', () => {
  it('records the applied decision after the editor save, flashing the workflow wording on failure', async () => {
    rememberPendingSimulationRun(FORM_ID, { runId: RUN_ID, recordId: DEFINITION_ID, source: 'dialog' })
    renderUi(<WorkflowSimulationApplyWidget context={{ formId: FORM_ID, recordId: DEFINITION_ID }} data={EDITOR_DATA} />)
    const banner = await screen.findByTestId('workflow-simulation-apply')
    expect(banner.textContent).toContain(DICT['insights.simulation.ui.workflowApply.description'])
    expect(screen.queryByTestId('workflow-simulation-load-proposal')).toBeNull()
    mockApiCall.mockResolvedValue(failed(500, { error: 'boom' }))
    await act(async () => {
      await workflowSimulationApplyModule.eventHandlers!.onAfterSave!(EDITOR_DATA, { formId: FORM_ID, recordId: DEFINITION_ID })
    })
    expect(mockApiCall).toHaveBeenCalledWith(`/api/insights/simulations/${RUN_ID}/decision`, expect.objectContaining({ method: 'POST', body: JSON.stringify({ decision: 'applied' }) }))
    expect(mockFlash).toHaveBeenCalledWith(DICT['insights.simulation.ui.workflowApply.decisionFailed'], 'warning')
    expect(readPendingSimulationDecision(FORM_ID, DEFINITION_ID)).toBeNull()
  })

  it('loads the simulated triggers, enabled flag and version of a linked run into the editor', async () => {
    window.history.replaceState(null, '', `/backend/definitions/visual-editor?id=${DEFINITION_ID}&simulationRunId=${RUN_ID}`)
    routeReads([runDetail()])
    const onDataChange = jest.fn()
    renderUi(<WorkflowSimulationApplyWidget context={{ formId: FORM_ID, recordId: DEFINITION_ID }} data={EDITOR_DATA} onDataChange={onDataChange} />)
    fireEvent.click(await screen.findByTestId('workflow-simulation-load-proposal'))
    await waitFor(() => expect(onDataChange).toHaveBeenCalled())
    expect(onDataChange.mock.calls[0][0]).toEqual({ ...EDITOR_DATA, version: 3, enabled: false, triggers: [TRIGGER, QUIET] })
    expect(mockFlash).toHaveBeenCalledWith(DICT['insights.simulation.ui.workflowApply.loaded'], 'success')
    expect(readPendingSimulationDecision(FORM_ID, DEFINITION_ID)).toEqual({ runId: RUN_ID, recordId: DEFINITION_ID, source: 'link' })
  })
})

describe('workflow simulation apply widget — linked runs of another definition', () => {
  it('refuses to load the proposal of a run that simulated a different definition', async () => {
    window.history.replaceState(null, '', `/backend/definitions/visual-editor?id=${DEFINITION_ID}&simulationRunId=${RUN_ID}`)
    routeReads([runDetail({ artifactId: 'cccccccc-0000-4000-8000-000000000002' })])
    const onDataChange = jest.fn()
    renderUi(<WorkflowSimulationApplyWidget context={{ formId: FORM_ID, recordId: DEFINITION_ID }} data={EDITOR_DATA} onDataChange={onDataChange} />)
    fireEvent.click(await screen.findByTestId('workflow-simulation-load-proposal'))
    await waitFor(() => expect(mockFlash).toHaveBeenCalledWith(DICT['insights.simulation.ui.apply.loadFailed'], 'error'))
    expect(onDataChange).not.toHaveBeenCalled()
  })
})

describe('trigger backtest result page', () => {
  it('heads each group with the event and the trigger, and links back to the workflow editor', async () => {
    routeReads([runDetail()])
    renderUi(<SimulationRunPageClient runId={RUN_ID} />)
    const groups = await screen.findAllByTestId('simulation-group')
    expect(within(groups[0]).getByText('customers.deal.created')).toBeTruthy()
    expect(within(groups[0]).getByText('Trigger “Deal events” · customers.deal.*')).toBeTruthy()
    expect(within(groups[1]).getByText('Trigger “Quiet”')).toBeTruthy()
    expect(within(groups[1]).getByText('customers.deal.deleted')).toBeTruthy()
    expect(screen.getByTestId('simulation-caveats').textContent).toContain(DICT['workflows.simulation.caveats.debounceProcess'])
    expect(screen.getByTestId('simulation-apply').getAttribute('href')).toBe(`/backend/definitions/visual-editor?id=${DEFINITION_ID}&simulationRunId=${RUN_ID}`)
  })
})

describe('trigger backtest client helpers', () => {
  it('build the proposal from editor data and read it back', () => {
    expect(buildTriggerBacktestProposal({ workflowId: 'w', version: 1, enabled: true })).toEqual({ workflowId: 'w', version: 1, enabled: true, triggers: [], startPreConditions: [] })
    expect(triggerBacktestProposalToEditorChange({ workflowId: 'w', version: 1, enabled: true, triggers: [TRIGGER] })).toEqual({ version: 1, enabled: true, triggers: [TRIGGER] })
    expect(triggerBacktestProposalToEditorChange({ ruleId: 'x' })).toBeNull()
    expect(describeTriggerBacktestGroup('deal_events:customers.deal.created', { triggers: [TRIGGER] })).toEqual({ triggerId: 'deal_events', eventId: 'customers.deal.created', name: 'Deal events', eventPattern: 'customers.deal.*' })
    expect(describeTriggerBacktestGroup('gone', null)).toEqual({ triggerId: 'gone', eventId: null, name: null, eventPattern: null })
  })
})
