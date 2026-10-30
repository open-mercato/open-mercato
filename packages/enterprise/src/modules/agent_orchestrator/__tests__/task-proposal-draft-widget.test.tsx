/**
 * @jest-environment jsdom
 *
 * The proposal draft card on a disposition task (spec §7.6).
 *
 * It is READ-ONLY by design: the verdict is taken in the caseload, which owns
 * the optimistic lock, the edit payload and the mandatory reason. A second
 * dispose path here would be a second place a proposal can be decided, so the
 * card links there instead — and a test asserts it never posts.
 */

import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import TaskProposalDraftWidget from '../widgets/injection/task-proposal-draft/widget.client'
import widgetModule from '../widgets/injection/task-proposal-draft/widget'
import injectionTable from '../widgets/injection-table'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({ apiCall: jest.fn() }))
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }))

const apiCallMock = apiCall as jest.Mock

const PROPOSAL = {
  id: 'proposal-1',
  runId: 'run-1',
  payload: { actions: [{ type: 'update' }], rationale: 'The deal looks stale.' },
  confidence: 0.42,
  disposition: 'pending',
}

function renderWidget(context: Record<string, unknown>) {
  renderWithProviders(
    <TaskProposalDraftWidget context={context} data={null} onDataChange={() => {}} />,
  )
}

beforeEach(() => {
  apiCallMock.mockReset()
  apiCallMock.mockResolvedValue({ ok: true, status: 200, result: { items: [PROPOSAL] }, response: {}, cacheStatus: null })
})

describe('task proposal draft card', () => {
  it('renders the would-be mutation for a task that carries a proposal', async () => {
    renderWidget({ taskId: 'task-1', formSchema: { proposalId: 'proposal-1' } })

    await waitFor(() => expect(screen.getByTestId('task-proposal-draft')).toBeTruthy())
    expect(screen.getByText('agent_orchestrator.userTaskProposal.draftTitle')).toBeTruthy()
    expect(screen.getByRole('button', { name: /openTrace/ })).toBeTruthy()
  })

  it('renders nothing for a task with no proposal', async () => {
    renderWidget({ taskId: 'task-1', formSchema: { fields: [] } })

    await waitFor(() => expect(apiCallMock).not.toHaveBeenCalled())
    expect(screen.queryByTestId('task-proposal-draft')).toBeNull()
  })

  it('renders nothing when the caller cannot read the proposal', async () => {
    apiCallMock.mockResolvedValue({ ok: false, status: 403, result: { items: [] }, response: {}, cacheStatus: null })
    renderWidget({ taskId: 'task-1', formSchema: { proposalId: 'proposal-1' } })

    await waitFor(() => expect(apiCallMock).toHaveBeenCalled())
    expect(screen.queryByTestId('task-proposal-draft')).toBeNull()
  })

  it('never writes: the verdict stays in the caseload', async () => {
    renderWidget({ taskId: 'task-1', formSchema: { proposalId: 'proposal-1' } })

    await waitFor(() => expect(screen.getByTestId('task-proposal-draft')).toBeTruthy())
    for (const call of apiCallMock.mock.calls) {
      const method = (call[1] as { method?: string } | undefined)?.method ?? 'GET'
      expect(method).toBe('GET')
    }
  })
})

describe('the widget declaration', () => {
  it('is gated on the proposal-read feature', () => {
    expect(widgetModule.metadata.features).toEqual(['agent_orchestrator.proposals.view'])
  })

  it('is mounted on the workflows task-detail spot', () => {
    expect(injectionTable['workflows.task.detail:context']).toEqual([
      { widgetId: 'agent_orchestrator.injection.task-proposal-draft', priority: 30 },
    ])
  })
})
