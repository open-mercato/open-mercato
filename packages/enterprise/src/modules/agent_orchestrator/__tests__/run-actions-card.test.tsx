/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { ForbiddenError } from '@open-mercato/ui/backend/utils/api'
import en from '../i18n/en.json'
import { RunActionsCard } from '../components/trace/RunActionsCard'
import { OPTIONAL_REQUEST_INIT } from '../components/optionalRequest'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({ apiCall: jest.fn() }))

const mockedApiCall = apiCall as jest.MockedFunction<typeof apiCall>
const dict = en as Record<string, string>
const RUN_ID = '22222222-2222-4222-8222-222222222222'
const PROPOSAL_ID = '33333333-3333-4333-8333-333333333333'

function respond(status: number, result: unknown) {
  mockedApiCall.mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    result,
    response: { status },
    cacheStatus: null,
  } as unknown as Awaited<ReturnType<typeof apiCall>>)
}

beforeEach(() => {
  mockedApiCall.mockReset()
})

describe('RunActionsCard', () => {
  it('lists the actions the run caused', async () => {
    respond(200, {
      items: [{
        id: 'log-1',
        commandId: 'customers.deals.update',
        actionLabel: 'Update deal',
        resourceKind: 'customers.deal',
        resourceId: 'deal-1',
        actorUserId: '44444444-4444-4444-8444-444444444444',
        onBehalfOfUserId: '55555555-5555-4555-8555-555555555555',
        sourceKey: 'agent',
        correlation: { agentRunId: RUN_ID, proposalId: PROPOSAL_ID },
        createdAt: '2026-10-28T10:00:00.000Z',
      }],
      total: 1,
    })

    renderWithProviders(<RunActionsCard runId={RUN_ID} />, { dict })

    expect(await screen.findByText('Update deal')).toBeTruthy()
    expect(screen.getByText(dict['agent_orchestrator.traces.actions.title'])).toBeTruthy()
    expect(screen.getByText('customers.deals.update')).toBeTruthy()
    expect(screen.getByText(dict['agent_orchestrator.traces.actions.columns.onBehalfOf'])).toBeTruthy()
    expect(screen.getByText(dict['agent_orchestrator.traces.actions.columns.proposal'])).toBeTruthy()
    expect(mockedApiCall).toHaveBeenCalledWith(
      `/api/agent_orchestrator/runs/${RUN_ID}/actions?pageSize=50`,
      OPTIONAL_REQUEST_INIT,
    )
  })

  it('opts out of the global forbidden flash so a missing audit permission stays silent', async () => {
    respond(403, { error: 'Forbidden', requiredFeatures: ['audit_logs.view_tenant'] })

    renderWithProviders(<RunActionsCard runId={RUN_ID} />, { dict })

    await waitFor(() => expect(mockedApiCall).toHaveBeenCalledTimes(1))
    const init = mockedApiCall.mock.calls[0][1]
    expect(new Headers(init?.headers).get('x-om-forbidden-redirect')).toBe('0')
  })

  it('links each action to its audit entry and its proposal', async () => {
    respond(200, {
      items: [{
        id: '66666666-6666-4666-8666-666666666666',
        commandId: 'customers.deals.update',
        actionLabel: 'Update deal',
        resourceKind: 'customers.deal',
        resourceId: 'deal-1',
        actorUserId: null,
        onBehalfOfUserId: null,
        sourceKey: 'agent',
        correlation: { agentRunId: RUN_ID, proposalId: PROPOSAL_ID },
        createdAt: '2026-10-28T10:00:00.000Z',
      }],
      total: 1,
    })

    renderWithProviders(<RunActionsCard runId={RUN_ID} />, { dict })

    const auditLink = await screen.findByTestId('run-action-audit-link')
    expect(auditLink.getAttribute('href')).toBe('/backend/audit-logs?logId=66666666-6666-4666-8666-666666666666')
    expect(auditLink.textContent).toBe(dict['agent_orchestrator.audit.links.openEntry'])
    expect(screen.getByTestId('run-action-proposal-link').getAttribute('href')).toBe(`/backend/caseload/${PROPOSAL_ID}`)
  })

  it('shows the empty state when the run caused no recorded changes', async () => {
    respond(200, { items: [], total: 0 })

    renderWithProviders(<RunActionsCard runId={RUN_ID} />, { dict })

    expect(await screen.findByText(dict['agent_orchestrator.traces.actions.empty'])).toBeTruthy()
  })

  it('hides the card when apiFetch throws ForbiddenError for a caller without the audit permission', async () => {
    mockedApiCall.mockRejectedValue(new ForbiddenError('Forbidden', { requiredFeatures: ['audit_logs.view'], requiredRoles: null }))

    const { container } = renderWithProviders(<RunActionsCard runId={RUN_ID} />, { dict })

    await waitFor(() => expect(container.textContent).toBe(''))
    expect(screen.queryByText(dict['agent_orchestrator.traces.actions.loading'])).toBeNull()
  })

  it('hides the card when the actions request fails', async () => {
    mockedApiCall.mockRejectedValue(new Error('network down'))

    const { container } = renderWithProviders(<RunActionsCard runId={RUN_ID} />, { dict })

    await waitFor(() => expect(container.textContent).toBe(''))
  })

  it('hides the card when the caller lacks the audit permission', async () => {
    respond(403, { error: 'Forbidden' })

    const { container } = renderWithProviders(<RunActionsCard runId={RUN_ID} />, { dict })

    await waitFor(() => expect(container.textContent).toBe(''))
    expect(screen.queryByText(dict['agent_orchestrator.traces.actions.title'])).toBeNull()
  })
})
