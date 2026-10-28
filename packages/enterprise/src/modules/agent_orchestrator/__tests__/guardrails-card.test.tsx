/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import en from '../i18n/en.json'
import { GuardrailsCard } from '../components/trace/GuardrailsCard'
import { ProposalOptionList } from '../components/ProposalOptionList'
import { mapGuardrailCheck, type GuardrailCheckView } from '../components/types'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({ apiCall: jest.fn() }))

const mockedApiCall = apiCall as jest.MockedFunction<typeof apiCall>
const dict = en as Record<string, string>
const RUN_ID = '22222222-2222-4222-8222-222222222222'

function check(row: Record<string, unknown>): GuardrailCheckView {
  const view = mapGuardrailCheck({ phase: 'output', capability: 'claims.triage', guardrail_set_version: 'i1-abc', ...row })
  if (!view) throw new Error('[internal] fixture row must map')
  return view
}

const QUOTE_CHECK = check({
  id: 'check-quote',
  kind: 'evidence_quote',
  result: 'warn',
  evidence: {
    ruleId: 'quotes',
    dropped: 1,
    repaired: 2,
    holdsAutoApproval: true,
    rawOutput: { key: 'raw-key-1', status: 'stored' },
  },
})
const SCHEMA_CHECK = check({ id: 'check-schema', kind: 'schema', result: 'pass', evidence: null })

function renderCard(props: Partial<React.ComponentProps<typeof GuardrailsCard>> = {}) {
  return renderWithProviders(
    <GuardrailsCard checks={[QUOTE_CHECK, SCHEMA_CHECK]} runId={RUN_ID} {...props} />,
    { dict },
  )
}

beforeEach(() => {
  mockedApiCall.mockReset()
})

describe('GuardrailsCard', () => {
  it('renders i18n kind labels, the integrity rule id and the holds-approval badge', () => {
    renderCard({ integrityOutcome: 'flagged' })
    expect(screen.getByText(dict['agent_orchestrator.traces.detail.guardrailKind.evidence_quote'])).toBeTruthy()
    expect(screen.getByText(dict['agent_orchestrator.traces.detail.guardrailKind.schema'])).toBeTruthy()
    expect(screen.queryByText('evidence_quote')).toBeNull()
    expect(screen.getByText('quotes')).toBeTruthy()
    expect(screen.getAllByText(dict['agent_orchestrator.traces.detail.integrity.holdsApproval'])).toHaveLength(1)
    expect(screen.getByText(dict['agent_orchestrator.traces.detail.integrity.outcomeLabel'])).toBeTruthy()
    expect(screen.getByText(dict['agent_orchestrator.traces.detail.integrity.outcome.flagged'])).toBeTruthy()
  })

  it('falls back to the raw kind for a kind without a label and omits the outcome row when null', () => {
    renderCard({ checks: [check({ id: 'check-x', kind: 'future_kind', result: 'pass' })] })
    expect(screen.getByText('future_kind')).toBeTruthy()
    expect(screen.queryByText(dict['agent_orchestrator.traces.detail.integrity.outcomeLabel'])).toBeNull()
  })

  it('shows drop/repair counts in the expanded evidence', () => {
    renderCard()
    fireEvent.click(screen.getByText('quotes').closest('button') as HTMLButtonElement)
    expect(screen.getByText('1 dropped · 2 repaired')).toBeTruthy()
  })

  it('hides the model-vs-returned section when there is no raw output key', () => {
    renderCard({ rawOutputKey: null })
    expect(screen.queryByText(dict['agent_orchestrator.traces.detail.integrity.rawVsFinal'])).toBeNull()
    expect(screen.queryByText(dict['agent_orchestrator.traces.detail.integrity.rawUnavailable'])).toBeNull()
    expect(mockedApiCall).not.toHaveBeenCalled()
  })

  it('says so when the raw output could not be stored', () => {
    const unavailable = check({
      id: 'check-ref',
      kind: 'reference_exists',
      result: 'pass',
      evidence: { ruleId: 'refs', dropped: 1, rawOutput: { status: 'storage_unavailable' } },
    })
    renderCard({ checks: [unavailable], rawOutputKey: null })
    expect(screen.getByText(dict['agent_orchestrator.traces.detail.integrity.rawUnavailable'])).toBeTruthy()
  })

  it('fetches the raw output lazily on expand and renders a structural diff', async () => {
    mockedApiCall.mockResolvedValue({
      ok: true,
      status: 200,
      result: { payload: { findings: [{ quote: 'alpha' }, { quote: 'beta' }], summary: 'draft' } },
      response: {} as Response,
      cacheStatus: null,
    } as Awaited<ReturnType<typeof apiCall>>)
    renderCard({
      rawOutputKey: 'raw-key-1',
      returnedOutput: { findings: [{ quote: 'alpha' }], summary: 'final' },
    })
    expect(mockedApiCall).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /Model output vs returned output/ }))
    await waitFor(() => expect(screen.getByText('findings[1]')).toBeTruthy())
    const url = String(mockedApiCall.mock.calls[0][0])
    expect(url).toContain(`/api/agent_orchestrator/runs/${RUN_ID}/artifact?kind=raw_output&key=raw-key-1`)
    const diff = screen.getByRole('list', { name: dict['agent_orchestrator.traces.detail.integrity.rawVsFinal'] })
    expect(within(diff).getByText(dict['agent_orchestrator.traces.detail.integrity.change.removed'])).toBeTruthy()
    expect(within(diff).getByText('summary')).toBeTruthy()
    expect(within(diff).getByText('"draft" → "final"')).toBeTruthy()
  })

  it('renders an error message when the raw output cannot be loaded', async () => {
    mockedApiCall.mockResolvedValue({
      ok: false,
      status: 502,
      result: { payload: undefined },
      response: {} as Response,
      cacheStatus: null,
    } as Awaited<ReturnType<typeof apiCall>>)
    renderCard({ rawOutputKey: 'raw-key-1', returnedOutput: {} })
    fireEvent.click(screen.getByRole('button', { name: /Model output vs returned output/ }))
    await waitFor(() =>
      expect(screen.getByText(dict['agent_orchestrator.traces.detail.integrity.rawError'])).toBeTruthy(),
    )
  })
})

describe('ProposalOptionList guardrail hold details', () => {
  const payload = {
    options: [{ id: 'only', label: 'Only option', confidence: 0.9, actions: [{ type: 'set_stage', payload: { stage: 'won' } }] }],
  }

  it('lists the integrity rule ids under a guardrail hold', () => {
    renderWithProviders(
      <ProposalOptionList payload={payload} autoDispositionBlock="guardrail" heldRuleIds={['quotes', 'refs']} />,
      { dict },
    )
    expect(screen.getByText(dict['agent_orchestrator.proposal.options.autoBlock.guardrail'])).toBeTruthy()
    expect(screen.getByText('Integrity rules holding it: quotes, refs')).toBeTruthy()
  })

  it('omits the details line for other holds or when no rule held it', () => {
    const { rerender } = renderWithProviders(
      <ProposalOptionList payload={payload} autoDispositionBlock="risk" heldRuleIds={['quotes']} />,
      { dict },
    )
    expect(screen.queryByText(/Integrity rules holding it/)).toBeNull()
    rerender(<ProposalOptionList payload={payload} autoDispositionBlock="guardrail" heldRuleIds={[]} />)
    expect(screen.queryByText(/Integrity rules holding it/)).toBeNull()
  })
})
