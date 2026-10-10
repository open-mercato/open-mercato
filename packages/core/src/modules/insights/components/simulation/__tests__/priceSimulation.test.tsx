/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { createTranslator } from '@open-mercato/shared/lib/i18n/translate'
import insightsEn from '../../../i18n/en.json'
import authEn from '../../../../auth/i18n/en.json'
import catalogEn from '../../../../catalog/i18n/en.json'
import salesEn from '../../../../sales/i18n/en.json'

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
  usePathname: () => '/backend/catalog/prices/x/edit',
  useSearchParams: () => new URLSearchParams(),
}))

import PriceSimulateWidget from '../../../widgets/injection/price-simulate/widget.client'
import PriceSimulationApplyWidget from '../../../widgets/injection/price-simulation-apply/widget.client'
import priceSimulateModule from '../../../widgets/injection/price-simulate/widget'
import priceSimulationApplyModule from '../../../widgets/injection/price-simulation-apply/widget'
import { SimulationRunPageClient } from '../SimulationRunPage.client'
import { readPendingSimulationDecision, rememberPendingSimulationRun, resetPendingSimulationRuns } from '../../../lib/client/simulation/pendingDecisions'
import {
  buildPriceBacktestProposal,
  describePriceBacktestGroup,
  priceBacktestProposalToFormValues,
} from '../../../lib/client/simulation/priceBacktest'
import {
  formatSimulationMeasure,
  simulationCoverageLabel,
  simulationEmptyResult,
  simulationFidelityText,
  simulationGroupHeading,
  simulationGroupSuppressedLabel,
  simulationGroupTotalLabel,
  simulationResultHeading,
} from '../../../lib/client/simulation/format'

const DICT = { ...insightsEn, ...catalogEn, ...salesEn } as Record<string, string>
const RUN_ID = 'aaaaaaaa-0000-4000-8000-000000000007'
const PRICE_ID = 'bbbbbbbb-0000-4000-8000-000000000007'
const FORM_ID = 'catalog-price-form'
const CELLS = ['priced_from_row', 'manual_override', 'cannot_tell']

const FORM_DATA = {
  id: PRICE_ID,
  productId: 'cccccccc-0000-4000-8000-000000000007',
  priceKindId: 'dddddddd-0000-4000-8000-000000000007',
  currencyCode: 'EUR',
  unitPriceNet: '10.0000',
  unitPriceGross: '12.3000',
  taxRate: '23',
  updatedAt: '2026-09-15T08:00:00.000Z',
}

function ok(result: unknown, status = 200) {
  return { ok: true, status, result, response: {} as Response, cacheStatus: null }
}

function failed(status: number, result: unknown) {
  return { ok: false, status, result, response: {} as Response, cacheStatus: null }
}

const CAPABILITIES = {
  canRun: true,
  kinds: [{ kind: 'catalog.price_backtest', artifactKind: 'catalog.price', labelKey: 'catalog.simulation.kind.priceBacktest', cellKeys: CELLS }],
  limits: { defaultWindowDays: 90, maxWindowDays: 365, maxRecords: 50000, maxDurationMs: 120000 },
}

function cell(key: string, count: number | null, extra: Record<string, unknown> = {}) {
  return { key, count, suppressed: null, samples: [], ...extra }
}

const MEASURES = [
  { key: 'current_revenue', cell: 'priced_from_row', value: '300.00', currencyCode: 'EUR' },
  { key: 'simulated_revenue', cell: 'priced_from_row', value: '360.00', currencyCode: 'EUR' },
  { key: 'revenue_delta', cell: 'priced_from_row', value: '60.00', currencyCode: 'EUR' },
]

function runDetail(overrides: Record<string, unknown> = {}) {
  return {
    id: RUN_ID,
    kind: 'catalog.price_backtest',
    kindLabelKey: 'catalog.simulation.kind.priceBacktest',
    status: 'completed',
    artifactKind: 'catalog.price',
    artifactId: PRICE_ID,
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
    proposal: { priceId: PRICE_ID, currencyCode: 'EUR', unitPriceNet: 12 },
    result: {
      k: 5,
      truncated: false,
      groups: [
        {
          key: 'orders:EUR:net',
          labelKey: 'sales.simulation.priceBacktest.families.orders',
          sampleResourceKind: 'sales.order',
          total: 20,
          suppressed: false,
          cells: [cell('priced_from_row', 15), cell('manual_override', 5), cell('cannot_tell', 0)],
          warnings: [],
          flags: [],
          measures: MEASURES,
        },
        {
          key: 'quotes:EUR:net',
          labelKey: 'sales.simulation.priceBacktest.families.quotes',
          sampleResourceKind: 'sales.quote',
          total: 7,
          suppressed: false,
          cells: [cell('priced_from_row', null, { suppressed: 'below_k' }), cell('manual_override', null, { suppressed: 'complementary' }), cell('cannot_tell', 0)],
          warnings: [],
          flags: [],
          measures: [],
        },
      ],
    },
    coverage: { price_history_entries: 2, orders_lines_scanned: 20, orders_lines_without_price_link: 4, quotes_lines_scanned: 7 },
    caveats: ['catalog.simulation.caveats.priceIdBrowserOnly', 'catalog.simulation.caveats.basisNotProposed'],
    budgets: { maxRecords: 50000, maxDurationMs: 120000, recordsUsed: 27, elapsedMs: 400 },
    decisions: [],
    applyHref: `/backend/catalog/prices/${PRICE_ID}/edit?simulationRunId=${RUN_ID}`,
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
  window.history.replaceState(null, '', `/backend/catalog/prices/${PRICE_ID}/edit`)
})

describe('price simulate widget', () => {
  it('is gated on insights.simulator.run and the catalog module', () => {
    expect(priceSimulateModule.metadata.id).toBe('insights.injection.price-simulate')
    expect(priceSimulateModule.metadata.features).toEqual(['insights.simulator.run'])
    expect(priceSimulateModule.metadata.requiredModules).toEqual(['catalog'])
    expect(priceSimulationApplyModule.metadata.features).toEqual(['insights.simulator.run'])
    expect(typeof priceSimulationApplyModule.eventHandlers?.onAfterSave).toBe('function')
  })

  it('stays hidden without the price backtest capability and on the create form (no saved row)', async () => {
    mockApiCall.mockResolvedValue(ok({ ...CAPABILITIES, kinds: [] }))
    const view = renderUi(<PriceSimulateWidget context={{ formId: FORM_ID, recordId: PRICE_ID }} data={FORM_DATA} />)
    await waitFor(() => expect(mockApiCall).toHaveBeenCalled())
    expect(screen.queryByTestId('price-simulate-open')).toBeNull()
    view.unmount()
    mockApiCall.mockResolvedValue(ok(CAPABILITIES))
    renderUi(<PriceSimulateWidget context={{ formId: FORM_ID }} data={{ ...FORM_DATA, id: undefined, updatedAt: undefined }} />)
    await waitFor(() => expect(mockApiCall).toHaveBeenCalledTimes(2))
    expect(screen.queryByTestId('price-simulate-open')).toBeNull()
  })

  it('submits the unsaved amount the save will store, shows the revenue per family and currency, and remembers the run', async () => {
    jest.useFakeTimers()
    try {
      routeReads([runDetail({ status: 'running', result: null, completedAt: null, fidelity: null }), runDetail()])
      mockApiCallOrThrow.mockResolvedValue({ ok: true, runId: RUN_ID, progressJobId: null, status: 'queued', deduplicated: false })
      const view = renderUi(<PriceSimulateWidget context={{ formId: FORM_ID, recordId: PRICE_ID }} data={FORM_DATA} />)
      fireEvent.click(await screen.findByTestId('price-simulate-open'))
      expect(screen.getByText(DICT['insights.simulation.ui.priceSimulate.title'])).toBeTruthy()
      view.rerender(<PriceSimulateWidget context={{ formId: FORM_ID, recordId: PRICE_ID }} data={{ ...FORM_DATA, unitPriceNet: '12.00' }} />)
      fireEvent.keyDown(await screen.findByTestId('simulation-request-dialog'), { key: 'Enter', metaKey: true })
      await waitFor(() => expect(mockApiCallOrThrow).toHaveBeenCalled())
      const [url, init] = mockApiCallOrThrow.mock.calls[0] as [string, { body: string }]
      expect(url).toBe('/api/insights/simulations')
      expect(JSON.parse(init.body)).toEqual({
        kind: 'catalog.price_backtest',
        artifactId: PRICE_ID,
        window: { days: 90 },
        proposal: { priceId: PRICE_ID, currencyCode: 'EUR', unitPriceNet: '12.00' },
      })
      expect(await screen.findByText(DICT['insights.simulation.ui.run.running'])).toBeTruthy()
      await act(async () => {
        jest.advanceTimersByTime(2100)
      })
      const result = await screen.findByTestId('simulation-request-result')
      const headlines = within(result).getAllByTestId('simulation-group-headline')
      expect(within(headlines[0]).getByText('Orders · EUR')).toBeTruthy()
      expect(within(headlines[0]).getByTestId('simulation-group-total').textContent).toBe('20 lines')
      expect(within(headlines[0]).getByText(DICT['catalog.simulation.basis.net'])).toBeTruthy()
      expect(within(headlines[0]).getByText(DICT['catalog.simulation.cells.priced_from_row'])).toBeTruthy()
      const measures = within(headlines[0]).getByTestId('simulation-measures')
      expect(within(measures).getByText(DICT['catalog.simulation.measures.simulated_revenue'])).toBeTruthy()
      expect(measures.querySelector('[data-measure="revenue_delta"]')?.textContent).toContain('+')
      expect(measures.querySelector('[data-measure="current_revenue"]')?.textContent).toContain('300.00')
      expect(within(headlines[1]).getByText('Quotes · EUR')).toBeTruthy()
      expect(within(headlines[1]).getByTestId('simulation-measures-hidden')).toBeTruthy()
      expect(within(result).getByText(DICT['insights.simulation.ui.priceSimulate.decisionHint'])).toBeTruthy()
      expect(readPendingSimulationDecision(FORM_ID, PRICE_ID)).toEqual({ runId: RUN_ID, recordId: PRICE_ID, source: 'dialog' })
    } finally {
      jest.useRealTimers()
    }
  })

  it('shows translated proposal issues of an invalid amount', async () => {
    routeReads([runDetail()])
    mockApiCallOrThrow.mockRejectedValue(Object.assign(new Error('refused'), {
      status: 422,
      code: 'invalid_proposal',
      error: 'refused',
      issues: [{ path: 'unitPriceNet', message: 'catalog.simulation.validation.amountRequired' }],
    }))
    renderUi(<PriceSimulateWidget context={{ formId: FORM_ID, recordId: PRICE_ID }} data={{ ...FORM_DATA, unitPriceNet: '', unitPriceGross: '' }} />)
    fireEvent.click(await screen.findByTestId('price-simulate-open'))
    fireEvent.click(await screen.findByTestId('simulation-request-submit'))
    expect((await screen.findByTestId('simulation-request-issues')).textContent).toContain(DICT['catalog.simulation.validation.amountRequired'])
    expect(JSON.parse((mockApiCallOrThrow.mock.calls[0] as [string, { body: string }])[1].body).proposal).toEqual({ priceId: PRICE_ID, currencyCode: 'EUR' })
  })
})

describe('price simulation apply widget', () => {
  it('records the applied decision after the price row save, flashing the price wording on failure', async () => {
    rememberPendingSimulationRun(FORM_ID, { runId: RUN_ID, recordId: PRICE_ID, source: 'dialog' })
    renderUi(<PriceSimulationApplyWidget context={{ formId: FORM_ID, recordId: PRICE_ID }} data={FORM_DATA} />)
    const banner = await screen.findByTestId('price-simulation-apply')
    expect(banner.textContent).toContain(DICT['insights.simulation.ui.priceApply.description'])
    mockApiCall.mockResolvedValue(failed(500, { error: 'boom' }))
    await act(async () => {
      await priceSimulationApplyModule.eventHandlers!.onAfterSave!(FORM_DATA, { formId: FORM_ID, recordId: PRICE_ID })
    })
    expect(mockApiCall).toHaveBeenCalledWith(`/api/insights/simulations/${RUN_ID}/decision`, expect.objectContaining({ method: 'POST', body: JSON.stringify({ decision: 'applied' }) }))
    expect(mockFlash).toHaveBeenCalledWith(DICT['insights.simulation.ui.priceApply.decisionFailed'], 'warning')
    expect(readPendingSimulationDecision(FORM_ID, PRICE_ID)).toBeNull()
  })

  it('loads the simulated amounts of a linked run of this row into the form, and refuses another row', async () => {
    window.history.replaceState(null, '', `/backend/catalog/prices/${PRICE_ID}/edit?simulationRunId=${RUN_ID}`)
    routeReads([runDetail()])
    const onDataChange = jest.fn()
    const view = renderUi(<PriceSimulationApplyWidget context={{ formId: FORM_ID, recordId: PRICE_ID }} data={FORM_DATA} onDataChange={onDataChange} />)
    fireEvent.click(await screen.findByTestId('price-simulation-load-proposal'))
    await waitFor(() => expect(onDataChange).toHaveBeenCalled())
    expect(onDataChange.mock.calls[0][0]).toEqual({ ...FORM_DATA, unitPriceNet: '12', unitPriceGross: '' })
    expect(mockFlash).toHaveBeenCalledWith(DICT['insights.simulation.ui.priceApply.loaded'], 'success')
    view.unmount()
    resetPendingSimulationRuns()
    onDataChange.mockReset()
    routeReads([runDetail({ artifactId: 'eeeeeeee-0000-4000-8000-000000000007' })])
    renderUi(<PriceSimulationApplyWidget context={{ formId: FORM_ID, recordId: PRICE_ID }} data={FORM_DATA} onDataChange={onDataChange} />)
    fireEvent.click(await screen.findByTestId('price-simulation-load-proposal'))
    await waitFor(() => expect(mockFlash).toHaveBeenCalledWith(DICT['insights.simulation.ui.apply.loadFailed'], 'error'))
    expect(onDataChange).not.toHaveBeenCalled()
  })
})

describe('price backtest result page', () => {
  it('heads groups by family and currency, shows revenues of visible cells only, composed coverage labels and the apply link', async () => {
    routeReads([runDetail()])
    renderUi(<SimulationRunPageClient runId={RUN_ID} />)
    const groups = await screen.findAllByTestId('simulation-group')
    expect(screen.getByText(DICT['catalog.simulation.result.title'])).toBeTruthy()
    expect(screen.getByTestId('simulation-fidelity').textContent).toContain(DICT['catalog.simulation.fidelity.reconstructed'])
    expect(within(groups[0]).getByText('Orders · EUR')).toBeTruthy()
    expect(within(groups[0]).getByTestId('simulation-measures')).toBeTruthy()
    expect(within(groups[1]).getByText('Quotes · EUR')).toBeTruthy()
    expect(within(groups[1]).getByTestId('simulation-measures-hidden')).toBeTruthy()
    const coverage = screen.getByTestId('simulation-coverage')
    expect(coverage.querySelector('[data-coverage="price_history_entries"]')?.textContent).toContain(DICT['catalog.simulation.coverage.price_history_entries'])
    expect(coverage.querySelector('[data-coverage="orders_lines_without_price_link"]')?.textContent).toContain(`Orders: ${DICT['catalog.simulation.coverage.lines_without_price_link']}`)
    expect(coverage.querySelector('[data-coverage="quotes_lines_scanned"]')?.textContent).toContain(`Quotes: ${DICT['catalog.simulation.coverage.lines_scanned']}`)
    expect(screen.getByTestId('simulation-caveats').textContent).toContain(DICT['catalog.simulation.caveats.priceIdBrowserOnly'])
    expect(screen.getByTestId('simulation-apply').getAttribute('href')).toBe(`/backend/catalog/prices/${PRICE_ID}/edit?simulationRunId=${RUN_ID}`)
  })
})

describe('price backtest client helpers', () => {
  const t = createTranslator(DICT)

  it('propose the amount the row save will store: net when filled in, else gross', () => {
    expect(buildPriceBacktestProposal({ ...FORM_DATA, unitPriceNet: '12' }, PRICE_ID)).toEqual({ priceId: PRICE_ID, currencyCode: 'EUR', unitPriceNet: '12' })
    expect(buildPriceBacktestProposal({ ...FORM_DATA, unitPriceGross: '15' }, PRICE_ID)).toEqual({ priceId: PRICE_ID, currencyCode: 'EUR', unitPriceNet: '10.0000' })
    expect(buildPriceBacktestProposal({ ...FORM_DATA, unitPriceNet: '', unitPriceGross: '15' }, PRICE_ID)).toEqual({ priceId: PRICE_ID, currencyCode: 'EUR', unitPriceGross: '15' })
    expect(buildPriceBacktestProposal({ ...FORM_DATA, unitPriceNet: ' ', unitPriceGross: '' }, PRICE_ID)).toEqual({ priceId: PRICE_ID, currencyCode: 'EUR' })
    expect(buildPriceBacktestProposal({ ...FORM_DATA, currencyCode: 'usd' }, null)).toEqual({ priceId: PRICE_ID, currencyCode: 'USD', unitPriceNet: '10.0000' })
  })

  it('read proposals and group keys back', () => {
    expect(priceBacktestProposalToFormValues({ priceId: PRICE_ID, currencyCode: 'EUR', unitPriceNet: 12, unitPriceGross: '14.76' })).toEqual({ unitPriceNet: '12', unitPriceGross: '14.76' })
    expect(priceBacktestProposalToFormValues({ priceId: PRICE_ID, currencyCode: 'EUR', unitPriceGross: 15 })).toEqual({ unitPriceNet: '', unitPriceGross: '15' })
    expect(priceBacktestProposalToFormValues({ priceId: PRICE_ID, currencyCode: 'EUR' })).toBeNull()
    expect(priceBacktestProposalToFormValues({ ruleId: 'x' })).toBeNull()
    expect(describePriceBacktestGroup('orders:EUR:gross')).toEqual({ family: 'orders', currencyCode: 'EUR', basis: 'gross' })
    expect(describePriceBacktestGroup('quotes')).toEqual({ family: 'quotes', currencyCode: null, basis: null })
    expect(simulationGroupHeading('catalog.price_backtest', { key: 'quotes', labelKey: 'sales.simulation.priceBacktest.families.quotes' }, null, t)).toEqual({ title: 'Quotes', subtitle: null })
  })

  it('label coverage from the kind module, the generic table, or composed with the group family; format measures per currency', () => {
    const groups = [{ key: 'orders:EUR:net', labelKey: 'sales.simulation.priceBacktest.families.orders' }]
    expect(simulationCoverageLabel('orders_lines_scanned', t, { kind: 'catalog.price_backtest', groups })).toBe(`Orders: ${DICT['catalog.simulation.coverage.lines_scanned']}`)
    expect(simulationCoverageLabel('reconstructed_events', t, { kind: 'catalog.price_backtest', groups })).toBe(DICT['insights.simulation.coverage.reconstructed_events'])
    expect(simulationCoverageLabel('quotes_lines_scanned', t, { kind: 'catalog.price_backtest', groups })).toBe('quotes_lines_scanned')
    expect(simulationCoverageLabel('observed_events', t)).toBe(DICT['insights.simulation.coverage.observed_events'])
    expect(simulationCoverageLabel('unknown_key', t)).toBe('unknown_key')
    expect(simulationGroupTotalLabel('catalog.price_backtest', '7', t)).toBe('7 lines')
    expect(simulationGroupTotalLabel('business_rules.rule_backtest', '7', t)).toBe(t('insights.simulation.ui.result.eventsTotal', { count: '7' }))
    expect(formatSimulationMeasure({ key: 'revenue_delta', value: '-12.5', currencyCode: 'EUR' }, 'en')).toBe('-€12.50')
    expect(formatSimulationMeasure({ key: 'revenue_delta', value: '0.00', currencyCode: 'USD' }, 'en')).toBe('$0.00')
    expect(formatSimulationMeasure({ key: 'current_revenue', value: '1234.5678', currencyCode: null }, 'en')).toBe('1,234.5678')
    expect(formatSimulationMeasure({ key: 'current_revenue', value: '1', currencyCode: 'ZZZ1' }, 'en')).toBe('1')
  })

  it('word totals, hidden groups, headings and fidelity per kind through one module override: lines, users and API keys, else events', () => {
    const tAll = createTranslator({ ...DICT, ...authEn } as Record<string, string>)
    const generic = (key: string, params?: Record<string, string>) => tAll(`insights.simulation.ui.${key}`, params ?? {})
    expect(simulationGroupSuppressedLabel('catalog.price_backtest', '5', tAll)).toBe('Fewer than 5 lines — hidden to protect small groups')
    expect(simulationGroupSuppressedLabel('auth.role_acl_preview', '5', tAll)).toBe(tAll('auth.simulation.groupSuppressed', { k: '5' }))
    expect(simulationGroupSuppressedLabel('workflows.trigger_backtest', '5', tAll)).toBe(generic('result.groupSuppressed', { k: '5' }))
    expect(simulationGroupTotalLabel('auth.role_acl_preview', '7', tAll)).toBe(tAll('auth.simulation.groupTotal', { count: '7' }))
    expect(simulationResultHeading('catalog.price_backtest', '5', tAll)).toEqual({ title: DICT['catalog.simulation.result.title'], privacyNote: generic('result.privacyNote', { k: '5' }) })
    expect(simulationResultHeading('auth.role_acl_preview', '5', tAll)).toEqual({ title: authEn['auth.simulation.result.title'], privacyNote: tAll('auth.simulation.result.privacyNote', { k: '5' }) })
    expect(simulationResultHeading('business_rules.rule_backtest', '5', tAll).title).toBe(generic('result.title'))
    expect(simulationEmptyResult('catalog.price_backtest', tAll)).toEqual({ title: generic('result.emptyTitle'), description: DICT['catalog.simulation.result.emptyDescription'] })
    expect(simulationEmptyResult('business_rules.rule_backtest', tAll).description).toBe(generic('result.emptyDescription'))
    expect(simulationFidelityText('catalog.price_backtest', 'none', tAll)).toBe(DICT['catalog.simulation.fidelity.none'])
    expect(simulationFidelityText('catalog.price_backtest', 'observed', tAll)).toBe(generic('fidelity.observed'))
    expect(simulationFidelityText('business_rules.rule_backtest', 'none', tAll)).toBe(generic('fidelity.none'))
  })
})
