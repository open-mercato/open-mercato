/**
 * @jest-environment jsdom
 *
 * Step 1.12 (workflows UX Phase 2b): typed agent I/O. With the optional
 * agent_orchestrator peer installed, the picked agent's SAMPLE input fills the
 * input rows, its OUTCOME schema drives the output-mapping source suggestions,
 * and a source path the agent never returns is an author-time ERROR (runtime
 * stays warn-only). Without the peer the endpoint 404s and every row degrades
 * to the plain free-text editor it was.
 */
import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { AgentInvokeConfigField, type AgentInvokeConfigValue } from '../fields/AgentInvokeConfigField'
import type { LedgerEntry } from '../../lib/context-ledger'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
}))

const apiCallMock = apiCall as jest.Mock

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(() => {
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    writable: true,
    value: ResizeObserverMock,
  })
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined
})

const RISK_AGENT = {
  id: 'risk.scorer',
  label: 'Risk scorer',
  description: 'Scores risk',
  runtime: 'native',
  resultKind: 'proposal',
  sampleInput: { dealId: 'deal-1', retries: 2 },
  outcomeSchema: {
    type: 'object',
    properties: {
      score: { type: 'number' },
      rationale: { type: 'string' },
    },
  },
}

const ledgerEntries: LedgerEntry[] = [
  {
    path: 'customer.email',
    type: 'text',
    presence: 'always',
    source: { kind: 'contextSchema', label: 'contextSchema.input' },
  },
]

function value(overrides: Partial<AgentInvokeConfigValue> = {}): AgentInvokeConfigValue {
  return {
    agentId: 'risk.scorer',
    inputs: [{ key: 'dealId', value: '{{context.dealId}}' }],
    resultMode: 'autoApprove',
    autoApproveThreshold: '0.8',
    outputs: [{ key: 'riskScore', value: 'proposalPayload.score' }],
    subject: { subjectType: '', subjectId: '', subjectLabel: '' },
    ...overrides,
  }
}

function renderField(config: AgentInvokeConfigValue, setValue = jest.fn()) {
  renderWithProviders(
    <AgentInvokeConfigField
      id="agentConfig"
      value={config}
      setValue={setValue}
      ledgerEntries={ledgerEntries}
    />,
  )
  return setValue
}

function mockAgents(items: unknown[]) {
  apiCallMock.mockResolvedValue({ ok: true, status: 200, result: { items }, response: {}, cacheStatus: null })
}

beforeEach(() => {
  apiCallMock.mockReset()
})

describe('AgentInvokeConfigField typed I/O', () => {
  it('fills the input rows from the agent sample input', async () => {
    mockAgents([RISK_AGENT])
    const setValue = renderField(value())

    const insertSample = await screen.findByRole('button', { name: 'workflows.form.invokeAgent.insertSample' })
    fireEvent.click(insertSample)

    expect(setValue).toHaveBeenCalledWith(
      expect.objectContaining({
        inputs: [
          { key: 'dealId', value: 'deal-1' },
          { key: 'retries', value: '2' },
        ],
      }),
    )
  })

  it('flags a source path the agent never returns as an author-time error', async () => {
    mockAgents([RISK_AGENT])
    renderField(value({ outputs: [{ key: 'riskScore', value: 'proposalPayload.absent' }] }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('workflows.form.invokeAgent.errors.unknownSourcePath')
  })

  it('flags a template source path, the silent no-op the runtime only warns about', async () => {
    mockAgents([RISK_AGENT])
    renderField(value({ outputs: [{ key: 'riskScore', value: '{{proposalPayload.score}}' }] }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('workflows.form.invokeAgent.errors.templateSource')
  })

  it('accepts declared paths and paths descending into the outcome root', async () => {
    mockAgents([RISK_AGENT])
    renderField(value({ outputs: [{ key: 'riskScore', value: 'proposalPayload.score' }, { key: 'kindOut', value: 'kind' }] }))

    await screen.findByDisplayValue('proposalPayload.score')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('warns (never errors) on an input key the sample input does not use', async () => {
    mockAgents([RISK_AGENT])
    renderField(value({ inputs: [{ key: 'unknownKey', value: 'x' }] }))

    await waitFor(() => {
      expect(screen.getByText('workflows.form.invokeAgent.warnings.unknownInputKey')).toBeInTheDocument()
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('edits the subject descriptor as a structured mini-form', async () => {
    mockAgents([RISK_AGENT])
    const setValue = renderField(value())

    const subjectType = await screen.findByLabelText('workflows.form.invokeAgent.subjectType')
    fireEvent.change(subjectType, { target: { value: 'claim' } })

    expect(setValue).toHaveBeenCalledWith(
      expect.objectContaining({ subject: { subjectType: 'claim', subjectId: '', subjectLabel: '' } }),
    )
  })

  it('degrades to free text with no schema errors when the agent peer is absent', async () => {
    apiCallMock.mockResolvedValue({ ok: false, status: 404, result: { items: [] }, response: {}, cacheStatus: null })
    renderField(value({ outputs: [{ key: 'riskScore', value: 'proposalPayload.whatever' }] }))

    await waitFor(() => {
      expect(screen.getByDisplayValue('proposalPayload.whatever')).toBeInTheDocument()
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'workflows.form.invokeAgent.insertSample' }),
    ).not.toBeInTheDocument()
  })
})

/**
 * The threshold slider (spec §7.6) is a PRESENTATION change over the existing
 * `onResult.autoApproveThreshold` field. These tests pin the three things that
 * must not have moved with it: the 0-1 range, the 0.05 step and the 0.8
 * default — plus the fail-closed sentence the spec asks the control to spell
 * out. The comparison itself lives in the enterprise disposition service and is
 * not reachable from here.
 */
describe('AgentInvokeConfigField threshold control', () => {
  it('keeps the range, the step and the number input alongside the slider', async () => {
    mockAgents([RISK_AGENT])
    renderField(value())

    const slider = await screen.findByRole('slider')
    expect(slider).toHaveAttribute('aria-valuemin', '0')
    expect(slider).toHaveAttribute('aria-valuemax', '1')
    expect(slider).toHaveAttribute('aria-valuenow', '0.8')

    const numberInput = document.querySelector('input[type="number"]') as HTMLInputElement
    expect(numberInput).not.toBeNull()
    expect(numberInput.step).toBe('0.05')
    expect(numberInput.min).toBe('0')
    expect(numberInput.max).toBe('1')
    expect(numberInput.value).toBe('0.8')
  })

  it('states the fail-closed semantics', async () => {
    mockAgents([RISK_AGENT])
    renderField(value())

    expect(
      await screen.findByText('workflows.form.invokeAgent.thresholdFailClosed'),
    ).toBeInTheDocument()
  })

  it('an unparseable authored value shows the default rather than snapping to zero', async () => {
    mockAgents([RISK_AGENT])
    renderField(value({ autoApproveThreshold: '' }))

    const slider = await screen.findByRole('slider')
    expect(slider).toHaveAttribute('aria-valuenow', '0.8')
  })
})
