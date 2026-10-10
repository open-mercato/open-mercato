/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import insightsEn from '../../../i18n/en.json'
import businessRulesEn from '../../../../business_rules/i18n/en.json'

const mockApiCall = jest.fn()
const mockApiCallOrThrow = jest.fn()
const mockRunMutation = jest.fn((input: { operation: () => Promise<unknown> }) => input.operation().then((result) => ({ result })))
const mockFlash = jest.fn()
const mockConfirm = jest.fn(async () => true)

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
  useConfirmDialog: () => ({ confirm: (...args: unknown[]) => mockConfirm(...(args as [])), ConfirmDialogElement: null }),
}))
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
  usePathname: () => '/backend/rules/rule-1',
  useSearchParams: () => new URLSearchParams(),
}))

import RuleSimulateWidget from '../../../widgets/injection/rule-simulate/widget.client'
import RuleSimulationApplyWidget from '../../../widgets/injection/rule-simulation-apply/widget.client'
import ruleSimulateModule from '../../../widgets/injection/rule-simulate/widget'
import ruleSimulationApplyModule from '../../../widgets/injection/rule-simulation-apply/widget'
import { SimulationRunPageClient } from '../SimulationRunPage.client'
import { readPendingSimulationDecision, rememberPendingSimulationRun, resetPendingSimulationRuns } from '../../../lib/client/simulation/pendingDecisions'

const DICT = { ...insightsEn, ...businessRulesEn } as Record<string, string>
const RUN_ID = 'aaaaaaaa-0000-4000-8000-000000000001'
const RULE_ID = 'bbbbbbbb-0000-4000-8000-000000000001'
const FORM_ID = 'rule-form'

function ok(result: unknown, status = 200) {
  return { ok: true, status, result, response: {} as Response, cacheStatus: null }
}

function failed(status: number, result: unknown) {
  return { ok: false, status, result, response: {} as Response, cacheStatus: null }
}

const CAPABILITIES = {
  canRun: true,
  kinds: [{ kind: 'business_rules.rule_backtest', artifactKind: 'business_rules.rule', labelKey: 'business_rules.simulation.kind.ruleBacktest', cellKeys: ['fires', 'does_not_fire', 'runs_failure_actions', 'cannot_tell'] }],
  limits: { defaultWindowDays: 90, maxWindowDays: 365, maxRecords: 50000, maxDurationMs: 120000 },
}

const FORM_VALUES = {
  ruleId: 'DEAL_WON',
  ruleName: 'Deal won',
  description: '',
  ruleType: 'ACTION',
  ruleCategory: '',
  entityType: 'customers.deal',
  eventType: 'updated',
  conditionExpression: { operator: 'AND', rules: [{ field: 'status', operator: '=', value: 'won' }] },
  successActions: [{ type: 'LOG', config: { message: 'won' } }],
  failureActions: [],
  enabled: true,
  priority: 100,
  version: 1,
  effectiveFrom: '',
  effectiveTo: '',
}

function runDetail(overrides: Record<string, unknown> = {}) {
  return {
    id: RUN_ID,
    kind: 'business_rules.rule_backtest',
    kindLabelKey: 'business_rules.simulation.kind.ruleBacktest',
    status: 'completed',
    artifactKind: 'business_rules.rule',
    artifactId: RULE_ID,
    progressJobId: null,
    fidelity: 'mixed',
    errorCode: null,
    windowFrom: '2026-07-01T00:00:00.000Z',
    windowTo: '2026-10-01T00:00:00.000Z',
    createdAt: '2026-10-01T00:00:00.000Z',
    startedAt: '2026-10-01T00:00:01.000Z',
    completedAt: '2026-10-01T00:00:05.000Z',
    expiresAt: '2026-10-31T00:00:00.000Z',
    cellKeys: ['fires', 'does_not_fire', 'runs_failure_actions', 'cannot_tell'],
    proposal: { ...FORM_VALUES, eventType: 'updated', effectiveFrom: '2026-01-01T00:00:00.000Z', conditionExpression: { field: 'status', operator: '=', value: 'won' } },
    result: {
      k: 10,
      truncated: false,
      groups: [{
        key: 'customers.deal.updated',
        labelKey: null,
        sampleResourceKind: 'customers.deal',
        total: 60,
        suppressed: false,
        cells: [
          { key: 'fires', count: null, suppressed: 'below_k', samples: [] },
          { key: 'does_not_fire', count: 0, suppressed: null, samples: [] },
          { key: 'runs_failure_actions', count: null, suppressed: 'complementary', samples: [] },
          { key: 'cannot_tell', count: 50, suppressed: null, samples: [{ id: 'deal-safe', href: '/backend/customers/deals/deal-safe' }, { id: 'deal-unsafe', href: 'javascript:alert(1)' }] },
        ],
        warnings: ['business_rules.simulation.warnings.neverFires'],
        flags: ['rule_limit_exceeded'],
      }],
    },
    coverage: { observed_rows: 12, reconstructed_events: 48 },
    caveats: ['business_rules.simulation.caveats.firstOrder'],
    budgets: { maxRecords: 50000, maxDurationMs: 120000, recordsUsed: 60, elapsedMs: 900 },
    decisions: [],
    applyHref: `/backend/rules/${RULE_ID}?simulationRunId=${RUN_ID}`,
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
  window.history.replaceState(null, '', '/backend/rules')
})

describe('rule simulate widget', () => {
  it('is gated on insights.simulator.run on the rule editor spots', () => {
    expect(ruleSimulateModule.metadata.features).toEqual(['insights.simulator.run'])
    expect(ruleSimulationApplyModule.metadata.features).toEqual(['insights.simulator.run'])
    expect(typeof ruleSimulationApplyModule.eventHandlers?.onAfterSave).toBe('function')
  })

  it('stays hidden when the viewer may not run the rule backtest', async () => {
    mockApiCall.mockResolvedValue(ok({ ...CAPABILITIES, canRun: false, kinds: [] }))
    renderUi(<RuleSimulateWidget context={{ formId: FORM_ID, recordId: RULE_ID }} data={FORM_VALUES} />)
    await waitFor(() => expect(mockApiCall).toHaveBeenCalled())
    expect(screen.queryByTestId('rule-simulate-open')).toBeNull()
  })

  it('submits the current unsaved rule with Cmd+Enter, follows the run and remembers it for the save', async () => {
    jest.useFakeTimers()
    try {
      routeReads([runDetail({ status: 'queued', result: null, completedAt: null, fidelity: null }), runDetail()])
      mockApiCallOrThrow.mockResolvedValue({ ok: true, runId: RUN_ID, progressJobId: null, status: 'queued', deduplicated: false })
      renderUi(<RuleSimulateWidget context={{ formId: FORM_ID, recordId: RULE_ID }} data={FORM_VALUES} />)
      fireEvent.click(await screen.findByTestId('rule-simulate-open'))
      const dialog = await screen.findByTestId('simulation-request-dialog')
      fireEvent.keyDown(dialog, { key: 'Enter', metaKey: true })
      await waitFor(() => expect(mockApiCallOrThrow).toHaveBeenCalled())
      const [url, init] = mockApiCallOrThrow.mock.calls[0] as [string, { method: string; body: string }]
      expect(url).toBe('/api/insights/simulations')
      const body = JSON.parse(init.body)
      expect(body).toEqual({
        kind: 'business_rules.rule_backtest',
        artifactId: RULE_ID,
        window: { days: 90 },
        proposal: expect.objectContaining({ ruleId: 'DEAL_WON', eventType: 'updated', description: null, ruleCategory: null, effectiveFrom: null, failureActions: [] }),
      })
      expect(await screen.findByText('Waiting for a worker…')).toBeTruthy()
      await act(async () => {
        jest.advanceTimersByTime(2100)
      })
      const result = await screen.findByTestId('simulation-request-result')
      expect(within(result).getAllByText('Fewer than 10').length).toBeGreaterThan(0)
      expect(within(result).getByText('As configured, this rule would never fire on these events.')).toBeTruthy()
      expect(readPendingSimulationDecision(FORM_ID, RULE_ID)).toEqual({ runId: RUN_ID, recordId: RULE_ID, source: 'dialog' })
    } finally {
      jest.useRealTimers()
    }
  })

  it('shows the proposal issues of a 422 invalid_proposal', async () => {
    routeReads([runDetail()])
    mockApiCallOrThrow.mockRejectedValue(Object.assign(new Error('invalid'), { status: 422, code: 'invalid_proposal', error: 'invalid', issues: [{ path: 'ruleId', message: 'Too small' }] }))
    renderUi(<RuleSimulateWidget context={{ formId: FORM_ID, recordId: null }} data={{ ...FORM_VALUES, ruleId: '' }} />)
    fireEvent.click(await screen.findByTestId('rule-simulate-open'))
    fireEvent.click(await screen.findByTestId('simulation-request-submit'))
    const issues = await screen.findByTestId('simulation-request-issues')
    expect(within(issues).getByText('ruleId: Too small')).toBeTruthy()
    expect(JSON.parse((mockApiCallOrThrow.mock.calls[0] as [string, { body: string }])[1].body).artifactId).toBeNull()
  })

  it('keeps following the run after the dialog is closed and remembers it once it completes', async () => {
    jest.useFakeTimers()
    try {
      routeReads([runDetail({ status: 'running', result: null, completedAt: null, fidelity: null }), runDetail()])
      mockApiCallOrThrow.mockResolvedValue({ ok: true, runId: RUN_ID, progressJobId: null, status: 'queued', deduplicated: false })
      renderUi(<RuleSimulateWidget context={{ formId: FORM_ID, recordId: RULE_ID }} data={FORM_VALUES} />)
      fireEvent.click(await screen.findByTestId('rule-simulate-open'))
      fireEvent.click(await screen.findByTestId('simulation-request-submit'))
      expect(await screen.findByTestId('simulation-request-cancel')).toBeTruthy()
      fireEvent.keyDown(screen.getByTestId('simulation-request-dialog'), { key: 'Escape' })
      await waitFor(() => expect(screen.queryByTestId('simulation-request-dialog')).toBeNull())
      expect(readPendingSimulationDecision(FORM_ID, RULE_ID)).toBeNull()
      await act(async () => {
        jest.advanceTimersByTime(2100)
      })
      await waitFor(() => expect(readPendingSimulationDecision(FORM_ID, RULE_ID)).toEqual({ runId: RUN_ID, recordId: RULE_ID, source: 'dialog' }))
      fireEvent.click(screen.getByTestId('rule-simulate-open'))
      expect(await screen.findByTestId('simulation-request-result')).toBeTruthy()
    } finally {
      jest.useRealTimers()
    }
  })

  it('keeps polling after a failed poll and shows the error with a retry', async () => {
    jest.useFakeTimers()
    try {
      let reads = 0
      mockApiCall.mockImplementation((input: unknown) => {
        const url = String(input)
        if (url.endsWith('/capabilities')) return Promise.resolve(ok(CAPABILITIES))
        reads += 1
        if (reads === 1) return Promise.resolve(ok({ ok: true, result: runDetail({ status: 'running', result: null, completedAt: null, fidelity: null }) }))
        if (reads === 2) return Promise.resolve(failed(503, { error: 'unavailable' }))
        return Promise.resolve(ok({ ok: true, result: runDetail() }))
      })
      mockApiCallOrThrow.mockResolvedValue({ ok: true, runId: RUN_ID, progressJobId: null, status: 'queued', deduplicated: false })
      renderUi(<RuleSimulateWidget context={{ formId: FORM_ID, recordId: RULE_ID }} data={FORM_VALUES} />)
      fireEvent.click(await screen.findByTestId('rule-simulate-open'))
      fireEvent.click(await screen.findByTestId('simulation-request-submit'))
      expect(await screen.findByTestId('simulation-request-cancel')).toBeTruthy()
      await act(async () => {
        jest.advanceTimersByTime(2100)
      })
      expect(await screen.findByTestId('simulation-request-retry')).toBeTruthy()
      await act(async () => {
        jest.advanceTimersByTime(2100)
      })
      expect(await screen.findByTestId('simulation-request-result')).toBeTruthy()
      expect(screen.queryByTestId('simulation-request-retry')).toBeNull()
    } finally {
      jest.useRealTimers()
    }
  })

  it('closes on Escape without requesting anything', async () => {
    routeReads([runDetail()])
    renderUi(<RuleSimulateWidget context={{ formId: FORM_ID, recordId: RULE_ID }} data={FORM_VALUES} />)
    fireEvent.click(await screen.findByTestId('rule-simulate-open'))
    const dialog = await screen.findByTestId('simulation-request-dialog')
    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByTestId('simulation-request-dialog')).toBeNull())
    expect(mockApiCallOrThrow).not.toHaveBeenCalled()
  })
})

describe('rule simulation apply widget', () => {
  it('renders nothing without a pending run', () => {
    renderUi(<RuleSimulationApplyWidget context={{ formId: FORM_ID, recordId: RULE_ID }} data={FORM_VALUES} />)
    expect(screen.queryByTestId('rule-simulation-apply')).toBeNull()
  })

  it('records the applied decision after the save and swallows a duplicate', async () => {
    rememberPendingSimulationRun(FORM_ID, { runId: RUN_ID, recordId: RULE_ID, source: 'dialog' })
    renderUi(<RuleSimulationApplyWidget context={{ formId: FORM_ID, recordId: RULE_ID }} data={FORM_VALUES} />)
    expect(await screen.findByTestId('rule-simulation-apply')).toBeTruthy()
    expect(screen.queryByTestId('rule-simulation-load-proposal')).toBeNull()
    mockApiCall.mockResolvedValue(failed(409, { error: 'exists', code: 'decision_exists' }))
    await act(async () => {
      await ruleSimulationApplyModule.eventHandlers!.onAfterSave!(FORM_VALUES, { formId: FORM_ID, recordId: RULE_ID })
    })
    expect(mockApiCall).toHaveBeenCalledWith(`/api/insights/simulations/${RUN_ID}/decision`, expect.objectContaining({ method: 'POST', body: JSON.stringify({ decision: 'applied' }) }))
    expect(readPendingSimulationDecision(FORM_ID, RULE_ID)).toBeNull()
    expect(mockFlash).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByTestId('rule-simulation-apply')).toBeNull())
    mockApiCall.mockClear()
    await ruleSimulationApplyModule.eventHandlers!.onAfterSave!(FORM_VALUES, { formId: FORM_ID, recordId: RULE_ID })
    expect(mockApiCall).not.toHaveBeenCalled()
  })

  it('flashes a failed decision write (other than a duplicate) without failing the save', async () => {
    rememberPendingSimulationRun(FORM_ID, { runId: RUN_ID, recordId: RULE_ID, source: 'dialog' })
    renderUi(<RuleSimulationApplyWidget context={{ formId: FORM_ID, recordId: RULE_ID }} data={FORM_VALUES} />)
    expect(await screen.findByTestId('rule-simulation-apply')).toBeTruthy()
    mockApiCall.mockResolvedValue(failed(500, { error: 'boom' }))
    await act(async () => {
      await ruleSimulationApplyModule.eventHandlers!.onAfterSave!(FORM_VALUES, { formId: FORM_ID, recordId: RULE_ID })
    })
    expect(mockFlash).toHaveBeenCalledWith(DICT['insights.simulation.ui.apply.decisionFailed'], 'warning')
  })

  it('loads the simulated proposal of a linked run into the form', async () => {
    window.history.replaceState(null, '', `/backend/rules/${RULE_ID}?simulationRunId=${RUN_ID}`)
    routeReads([runDetail()])
    const onDataChange = jest.fn()
    renderUi(<RuleSimulationApplyWidget context={{ formId: FORM_ID, recordId: RULE_ID }} data={{ ...FORM_VALUES, id: RULE_ID }} onDataChange={onDataChange} />)
    fireEvent.click(await screen.findByTestId('rule-simulation-load-proposal'))
    await waitFor(() => expect(onDataChange).toHaveBeenCalled())
    expect(onDataChange.mock.calls[0][0]).toEqual(expect.objectContaining({
      id: RULE_ID,
      ruleId: 'DEAL_WON',
      effectiveFrom: '2026-01-01',
      conditionExpression: { operator: 'AND', rules: [{ field: 'status', operator: '=', value: 'won' }] },
    }))
    expect(readPendingSimulationDecision(FORM_ID, RULE_ID)).toEqual({ runId: RUN_ID, recordId: RULE_ID, source: 'link' })
  })

  it('ignores a malformed run id in the URL', async () => {
    window.history.replaceState(null, '', '/backend/rules/x?simulationRunId=not-a-uuid')
    renderUi(<RuleSimulationApplyWidget context={{ formId: FORM_ID, recordId: RULE_ID }} data={FORM_VALUES} />)
    await act(async () => undefined)
    expect(screen.queryByTestId('rule-simulation-apply')).toBeNull()
  })
})

describe('simulation result page', () => {
  it('shows k-suppressed cells, warnings, flags, coverage, caveats and only safe links', async () => {
    routeReads([runDetail()])
    renderUi(<SimulationRunPageClient runId={RUN_ID} />)
    const group = await screen.findByTestId('simulation-group')
    expect(within(group).getByTestId('simulation-cell-below-k').textContent).toContain('Fewer than 10')
    expect(within(group).getByTestId('simulation-cell-complementary').textContent).toContain('Hidden to protect small groups')
    expect(within(group).getByText('As configured, this rule would never fire on these events.')).toBeTruthy()
    expect(within(group).getByText('More than 100 rules')).toBeTruthy()
    expect(within(group).getByTestId('simulation-sample-link').getAttribute('href')).toBe('/backend/customers/deals/deal-safe')
    expect(within(group).getByTestId('simulation-sample-id').textContent).not.toContain('javascript')
    expect(screen.getByTestId('simulation-coverage').textContent).toContain('Rule execution log rows read')
    expect(screen.getByTestId('simulation-caveats').textContent).toContain('First-order estimate')
    expect(screen.getByTestId('simulation-apply').getAttribute('href')).toBe(`/backend/rules/${RULE_ID}?simulationRunId=${RUN_ID}`)
  })

  it('labels verified and differing decisions and discards through a confirmed guarded mutation', async () => {
    routeReads([runDetail({
      decisions: [
        { decision: 'applied', verified: false, artifactId: RULE_ID, artifactUpdatedAtAfter: '2026-10-02T00:00:00.000Z', createdAt: '2026-10-02T00:00:00.000Z' },
      ],
    })])
    mockApiCallOrThrow.mockResolvedValue({ ok: true, decision: { decision: 'discarded' } })
    renderUi(<SimulationRunPageClient runId={RUN_ID} />)
    expect((await screen.findByTestId('simulation-decision')).textContent).toContain('Applied — differs from the simulation')
    fireEvent.click(screen.getByTestId('simulation-discard'))
    await waitFor(() => expect(mockApiCallOrThrow).toHaveBeenCalledWith(`/api/insights/simulations/${RUN_ID}/decision`, expect.objectContaining({ body: JSON.stringify({ decision: 'discarded' }) })))
    expect(mockConfirm).toHaveBeenCalled()
    expect(mockRunMutation).toHaveBeenCalled()
  })

  it('lets the requester cancel a running run and never links an unsafe apply href', async () => {
    routeReads([runDetail({ status: 'running', result: null, completedAt: null, canDecide: false, applyHref: 'https://evil.example' })])
    mockApiCallOrThrow.mockResolvedValue({ ok: true, runId: RUN_ID, status: 'cancelled' })
    renderUi(<SimulationRunPageClient runId={RUN_ID} />)
    fireEvent.click(await screen.findByTestId('simulation-cancel'))
    await waitFor(() => expect(mockApiCallOrThrow).toHaveBeenCalledWith(`/api/insights/simulations/${RUN_ID}/cancel`, expect.objectContaining({ method: 'POST' })))
    expect(screen.queryByTestId('simulation-apply')).toBeNull()
  })

  it('shows the not-found state for a run that is not visible', async () => {
    mockApiCall.mockResolvedValue(failed(404, { error: 'Simulation not found.', code: 'run_not_found' }))
    renderUi(<SimulationRunPageClient runId={RUN_ID} />)
    expect(await screen.findByText('Simulation not found.')).toBeTruthy()
  })
})
