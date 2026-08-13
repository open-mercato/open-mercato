/**
 * @jest-environment jsdom
 */

/**
 * The company-header trigger (B6).
 *
 * What is worth testing here is not that a button renders. It is that a button
 * which PLACES A PHONE CALL cannot be fired by one click, cannot dial a number
 * nobody checked, and reports the run honestly — including the case where the
 * workflow completes down its failure route.
 */

import * as React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import DealBriefTriggerWidget, {
  normalizeChiefOfSalesPhone,
} from '../widgets/injection/deal-brief-trigger/widget.client'
import { DEAL_BRIEFING_WORKFLOW_ID } from '../lib/deal-briefing-contract'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
}))

const retryLastMutation = jest.fn(async () => true)
const capturedContexts: Array<Record<string, unknown>> = []

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: async ({
      operation,
      context,
    }: {
      operation: () => Promise<unknown>
      context: Record<string, unknown>
    }) => {
      capturedContexts.push(context)
      return operation()
    },
    retryLastMutation,
  }),
}))

jest.mock('@open-mercato/ui/primitives/dialog', () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({
    children,
    onKeyDown,
  }: {
    children: React.ReactNode
    onKeyDown?: React.KeyboardEventHandler
  }) => (
    <div data-testid="dialog-content" onKeyDown={onKeyDown}>
      {children}
    </div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

const apiCallMock = apiCall as unknown as jest.Mock

const COMPANY_ID = '11111111-1111-4111-8111-111111111111'
const INSTANCE_ID = '22222222-2222-4222-8222-222222222222'

const companyData = {
  company: { id: COMPANY_ID, displayName: 'ACME Industries' },
}

function renderWidget(data: typeof companyData | null = companyData) {
  return render(<DealBriefTriggerWidget context={{ companyId: COMPANY_ID }} data={data} />)
}

function startedResponse() {
  return {
    ok: true,
    status: 201,
    result: { data: { instance: { id: INSTANCE_ID } } },
  }
}

function emitLifecycle(id: string, payload: Record<string, unknown>) {
  act(() => {
    window.dispatchEvent(
      new CustomEvent('om:event', {
        detail: { id, payload, timestamp: Date.now(), organizationId: 'org' },
      }),
    )
  })
}

async function openAndSubmit(phoneValue: string) {
  fireEvent.click(screen.getByRole('button', { name: /brief the chief of sales/i }))
  fireEvent.change(screen.getByLabelText(/chief of sales phone number/i), {
    target: { value: phoneValue },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Start the call' }))
}

beforeEach(() => {
  apiCallMock.mockReset()
  retryLastMutation.mockClear()
  capturedContexts.length = 0
})

describe('normalizeChiefOfSalesPhone', () => {
  it('accepts how people actually write a number', () => {
    expect(normalizeChiefOfSalesPhone('+48 123 456 789')).toBe('+48123456789')
    expect(normalizeChiefOfSalesPhone('+1 (415) 555-0134')).toBe('+14155550134')
    expect(normalizeChiefOfSalesPhone('0048123456789')).toBe('+48123456789')
  })

  it('refuses anything without a country code', () => {
    // The call is placed from the tenant's ElevenLabs number, whose country the
    // browser cannot know. Guessing one dials a stranger.
    expect(normalizeChiefOfSalesPhone('123456789')).toBeNull()
    expect(normalizeChiefOfSalesPhone('')).toBeNull()
    expect(normalizeChiefOfSalesPhone('+0123456789')).toBeNull()
    expect(normalizeChiefOfSalesPhone('not a phone')).toBeNull()
  })
})

describe('DealBriefTriggerWidget', () => {
  it('renders nothing when the host cannot say which company this is', () => {
    const { container } = render(<DealBriefTriggerWidget context={{}} data={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('does not start a call on a single click — it asks first', () => {
    renderWidget()
    fireEvent.click(screen.getByRole('button', { name: /brief the chief of sales/i }))
    expect(apiCallMock).not.toHaveBeenCalled()
    expect(screen.getByText('Start a briefing call?')).toBeInTheDocument()
  })

  it('names the company in the confirmation', () => {
    renderWidget()
    fireEvent.click(screen.getByRole('button', { name: /brief the chief of sales/i }))
    expect(
      screen.getByText(/reads them a summary of ACME Industries’s open deals/),
    ).toBeInTheDocument()
  })

  it('refuses to dial a number that is not dialable, and starts nothing', async () => {
    renderWidget()
    await openAndSubmit('555 0134')
    await waitFor(() => {
      expect(
        screen.getByText(
          'That is not a number we can dial. Use the international format, for example +48123456789.',
        ),
      ).toBeInTheDocument()
    })
    expect(apiCallMock).not.toHaveBeenCalled()
  })

  it('starts the seeded workflow with the context B5 declared', async () => {
    apiCallMock.mockResolvedValue(startedResponse())
    renderWidget()
    await openAndSubmit('+48 123 456 789')

    await waitFor(() => expect(apiCallMock).toHaveBeenCalledTimes(1))
    const [url, init] = apiCallMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/workflows/instances')
    expect(init.method).toBe('POST')
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(body).toEqual({
      workflowId: DEAL_BRIEFING_WORKFLOW_ID,
      initialContext: {
        companyId: COMPANY_ID,
        chiefOfSalesPhone: '+48123456789',
        companyName: 'ACME Industries',
      },
      metadata: { entityType: 'customers.company', entityId: COMPANY_ID },
    })
  })

  it('never sends initiatedBy — the route owns it', async () => {
    apiCallMock.mockResolvedValue(startedResponse())
    renderWidget()
    await openAndSubmit('+48123456789')
    await waitFor(() => expect(apiCallMock).toHaveBeenCalledTimes(1))
    const body = JSON.parse(String((apiCallMock.mock.calls[0][1] as RequestInit).body)) as {
      metadata: Record<string, unknown>
    }
    expect(body.metadata).not.toHaveProperty('initiatedBy')
  })

  it('offers retryLastMutation to the injection context', async () => {
    apiCallMock.mockResolvedValue(startedResponse())
    renderWidget()
    await openAndSubmit('+48123456789')
    await waitFor(() => expect(capturedContexts).toHaveLength(1))
    expect(capturedContexts[0]).toMatchObject({
      entityType: 'customers.company',
      entityId: COMPANY_ID,
    })
    expect(typeof capturedContexts[0].retryLastMutation).toBe('function')
  })

  it('submits on Cmd/Ctrl+Enter', async () => {
    apiCallMock.mockResolvedValue(startedResponse())
    renderWidget()
    fireEvent.click(screen.getByRole('button', { name: /brief the chief of sales/i }))
    fireEvent.change(screen.getByLabelText(/chief of sales phone number/i), {
      target: { value: '+48123456789' },
    })
    fireEvent.keyDown(screen.getByTestId('dialog-content'), { key: 'Enter', metaKey: true })
    await waitFor(() => expect(apiCallMock).toHaveBeenCalledTimes(1))
  })

  it('closes the confirmation and links to the run once it starts', async () => {
    apiCallMock.mockResolvedValue(startedResponse())
    renderWidget()
    await openAndSubmit('+48123456789')

    await waitFor(() => {
      expect(
        screen.getByText('Briefing started. The chief of sales will be called shortly.'),
      ).toBeInTheDocument()
    })
    expect(screen.queryByTestId('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /view the run/i })).toHaveAttribute(
      'href',
      `/backend/instances/${INSTANCE_ID}`,
    )
  })

  it.each([
    [403, 'You need permission to start workflow instances to brief the chief of sales.'],
    [404, 'The deal briefing workflow is not available on this tenant yet.'],
    [400, 'Select a single organization before starting a briefing call.'],
    [500, 'Failed to start the briefing call.'],
  ])('explains a %s without pretending the call happened', async (status, message) => {
    apiCallMock.mockResolvedValue({ ok: false, status, result: { error: 'server prose' } })
    renderWidget()
    await openAndSubmit('+48123456789')

    await waitFor(() => expect(screen.getByText(message)).toBeInTheDocument())
    expect(screen.getByTestId('dialog')).toBeInTheDocument()
    expect(screen.queryByText(/view the run/i)).not.toBeInTheDocument()
  })

  it('follows its own run live, and only its own', async () => {
    apiCallMock.mockResolvedValue(startedResponse())
    renderWidget()
    await openAndSubmit('+48123456789')
    await waitFor(() => expect(apiCallMock).toHaveBeenCalledTimes(1))

    emitLifecycle('workflows.instance.started', { id: INSTANCE_ID, stepId: 'call_chief' })
    await waitFor(() =>
      expect(screen.getByText('Calling the chief of sales…')).toBeInTheDocument(),
    )

    emitLifecycle('workflows.instance.started', { id: 'someone-elses-run', stepId: 'prepare_brief' })
    expect(screen.getByText('Calling the chief of sales…')).toBeInTheDocument()
  })

  it('does not call a briefing delivered when the run ended on the failure step', async () => {
    apiCallMock.mockResolvedValue(startedResponse())
    renderWidget()
    await openAndSubmit('+48123456789')
    await waitFor(() => expect(apiCallMock).toHaveBeenCalledTimes(1))

    emitLifecycle('workflows.instance.completed', { id: INSTANCE_ID, stepId: 'brief_failed' })
    await waitFor(() =>
      expect(screen.getByText('The briefing did not complete.')).toBeInTheDocument(),
    )
    expect(screen.queryByText('Briefing completed.')).not.toBeInTheDocument()
  })
})
