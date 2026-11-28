/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import en from '../i18n/en.json'
import InstigatorAuditChainPage from '../backend/audit/by-instigator/[humanUserId]/page'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({ apiCall: jest.fn() }))
jest.mock('@open-mercato/ui/backend/detail', () => ({
  LoadingMessage: ({ label }: { label: string }) => <div>{label}</div>,
  ErrorMessage: ({ label }: { label: string }) => <div role="alert">{label}</div>,
}))

const mockedApiCall = apiCall as jest.MockedFunction<typeof apiCall>
const dict = en as Record<string, string>
const HUMAN_ID = '11111111-1111-4111-8111-111111111111'
const AGENT_ID = '44444444-4444-4444-8444-444444444444'
const RUN_ID = '22222222-2222-4222-8222-222222222222'
const PROPOSAL_ID = '33333333-3333-4333-8333-333333333333'

function entry(overrides: Record<string, unknown>) {
  return {
    commandId: 'customers.deals.update',
    actionType: 'edit',
    actionLabel: 'Update deal',
    sourceKey: 'agent',
    resourceKind: 'customers.deal',
    resourceId: 'deal-1',
    actorUserId: AGENT_ID,
    onBehalfOfUserId: HUMAN_ID,
    createdAt: '2026-10-28T10:00:00.000Z',
    via: 'via_agent',
    agentRunId: null,
    proposalId: null,
    ...overrides,
  }
}

beforeEach(() => {
  mockedApiCall.mockReset()
})

describe('InstigatorAuditChainPage', () => {
  it('links entries to their audit row, run and proposal', async () => {
    mockedApiCall.mockResolvedValue({
      ok: true,
      status: 200,
      result: {
        humanUserId: HUMAN_ID,
        items: [
          entry({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', agentRunId: RUN_ID, proposalId: PROPOSAL_ID }),
          entry({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', actionLabel: 'Direct edit', actorUserId: HUMAN_ID, onBehalfOfUserId: null, via: 'direct' }),
        ],
        total: 2,
      },
    } as unknown as Awaited<ReturnType<typeof apiCall>>)

    renderWithProviders(<InstigatorAuditChainPage params={{ humanUserId: HUMAN_ID }} />, { dict })

    const auditLinks = await screen.findAllByTestId('instigator-entry-audit-link')
    expect(auditLinks.map((link) => link.getAttribute('href'))).toEqual([
      '/backend/audit-logs?logId=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '/backend/audit-logs?logId=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    ])
    const runLinks = screen.getAllByTestId('instigator-entry-run-link')
    expect(runLinks).toHaveLength(1)
    expect(runLinks[0].getAttribute('href')).toBe(`/backend/traces/${RUN_ID}`)
    expect(runLinks[0].textContent).toBe(dict['agent_orchestrator.audit.links.openRun'])
    const proposalLinks = screen.getAllByTestId('instigator-entry-proposal-link')
    expect(proposalLinks).toHaveLength(1)
    expect(proposalLinks[0].getAttribute('href')).toBe(`/backend/caseload/${PROPOSAL_ID}`)
  })
})
