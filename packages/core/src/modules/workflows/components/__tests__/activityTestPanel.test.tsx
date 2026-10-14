/**
 * @jest-environment jsdom
 *
 * Step 4.4 (workflows UX Phase 2a): the per-activity Test-step panel.
 * Clicking "Test step" builds the sample context via resolveStepSample
 * (pin > last test output > ledger placeholder) and POSTs to the mock-first
 * test-step API; a simulated response renders formatted JSON output with a
 * "simulated" badge and a working "Pin as sample" callback, a structured
 * refusal renders an i18n'd warning notice, an unsaved definition disables
 * the button with an i18n'd hint, and an existing pin exposes an unpin
 * affordance with its pinnedAt timestamp.
 */
import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { ActivityTestPanel } from '../fields/ActivityTestPanel'
import type { LedgerEntry } from '../../lib/context-ledger'
import type { PinnedSampleEnvelope } from '../../lib/sample-resolver'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
}))

const apiCallMock = apiCall as jest.Mock

const RUN_KEY = 'workflows.testStep.run'
const HINT_KEY = 'workflows.testStep.hint'
const UNSAVED_HINT_KEY = 'workflows.testStep.unsavedHint'
const SIMULATED_BADGE_KEY = 'workflows.testStep.simulatedBadge'
const PIN_KEY = 'workflows.testStep.pin'
const NO_REDACTION_KEY = 'workflows.testStep.noRedactionWarning'
const UNPIN_KEY = 'workflows.testStep.unpin'
const PINNED_AT_KEY = 'workflows.testStep.pinnedAt'
const REFUSED_REFUSED_KEY = 'workflows.testStep.refused.refused'
const REFUSED_NO_MOCK_KEY = 'workflows.testStep.refused.noMock'

const ledgerEntries: LedgerEntry[] = [
  {
    path: 'customerEmail',
    type: 'text',
    presence: 'always',
    source: { kind: 'contextSchema', label: 'contextSchema.input' },
  },
]

function baseProps(overrides: Partial<React.ComponentProps<typeof ActivityTestPanel>> = {}) {
  return {
    definitionId: 'def-1',
    stepId: 'notify',
    activityType: 'SEND_EMAIL',
    config: { to: '{{context.customerEmail}}' },
    ledgerEntries,
    onPinSample: jest.fn(),
    onUnpinSample: jest.fn(),
    ...overrides,
  }
}

beforeEach(() => {
  apiCallMock.mockReset()
})

describe('ActivityTestPanel', () => {
  it('runs a simulated test, renders the output with a simulated badge, and pins the output', async () => {
    const output = { sent: false, simulated: true, wouldSendTo: 'jane@example.com' }
    apiCallMock.mockResolvedValue({
      ok: true,
      status: 200,
      result: {
        simulated: true,
        activityType: 'SEND_EMAIL',
        output,
        interpolatedConfig: { to: 'jane@example.com' },
      },
      response: {},
      cacheStatus: null,
    })
    const props = baseProps()
    renderWithProviders(<ActivityTestPanel {...props} />)

    fireEvent.click(screen.getByRole('button', { name: new RegExp(RUN_KEY) }))

    await waitFor(() => {
      expect(screen.getByText(SIMULATED_BADGE_KEY)).toBeTruthy()
    })
    expect(apiCallMock).toHaveBeenCalledWith(
      '/api/workflows/definitions/def-1/test-step',
      expect.objectContaining({ method: 'POST' }),
    )
    const requestBody = JSON.parse(apiCallMock.mock.calls[0][1].body as string) as Record<string, unknown>
    expect(requestBody.stepId).toBe('notify')
    expect(requestBody.activityType).toBe('SEND_EMAIL')
    expect(requestBody.context).toEqual({ customerEmail: 'text' })
    expect(screen.getByText(/wouldSendTo/)).toBeTruthy()
    expect(screen.getByText(NO_REDACTION_KEY)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: new RegExp(PIN_KEY) }))
    expect(props.onPinSample).toHaveBeenCalledWith(output)
  })

  it('renders an i18n warning notice for structured refusals', async () => {
    apiCallMock.mockResolvedValue({
      ok: true,
      status: 200,
      result: { refused: true, reason: 'refused', activityType: 'EXECUTE_FUNCTION' },
      response: {},
      cacheStatus: null,
    })
    renderWithProviders(<ActivityTestPanel {...baseProps({ activityType: 'EXECUTE_FUNCTION' })} />)

    fireEvent.click(screen.getByRole('button', { name: new RegExp(RUN_KEY) }))

    await waitFor(() => {
      expect(screen.getByText(REFUSED_REFUSED_KEY)).toBeTruthy()
    })
    expect(screen.queryByText(REFUSED_NO_MOCK_KEY)).toBeNull()
  })

  it('disables the button with an i18n hint when the definition is unsaved', () => {
    renderWithProviders(<ActivityTestPanel {...baseProps({ definitionId: null })} />)

    const runButton = screen.getByRole('button', { name: new RegExp(RUN_KEY) }) as HTMLButtonElement
    expect(runButton.disabled).toBe(true)
    expect(screen.getByText(UNSAVED_HINT_KEY)).toBeTruthy()
    expect(screen.queryByText(HINT_KEY)).toBeNull()
    expect(apiCallMock).not.toHaveBeenCalled()
  })

  it('shows the pinned timestamp and unpins through the callback', () => {
    const pinnedSample: PinnedSampleEnvelope = {
      pinnedAt: '2026-07-27T10:00:00.000Z',
      source: 'test',
      data: { customerEmail: 'jane@example.com' },
    }
    const props = baseProps({ pinnedSample })
    renderWithProviders(<ActivityTestPanel {...props} />)

    expect(screen.getByText(new RegExp(PINNED_AT_KEY))).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: new RegExp(UNPIN_KEY) }))
    expect(props.onUnpinSample).toHaveBeenCalledTimes(1)
  })
})
