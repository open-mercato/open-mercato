/**
 * @jest-environment jsdom
 *
 * The milestone editor island: reordering, the step picker, and the drift
 * warning it renders without ever blocking a save.
 */

import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import type { ProcessMilestone } from '../data/validators'
import { MilestoneEditor } from '../backend/processes/definitions/MilestoneEditor'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({ apiCall: jest.fn() }))

const apiCallMock = apiCall as jest.Mock

/** The test translator returns the key, so assertions read as the contract. */
const t: TranslateFn = (key) => key

const MILESTONES: ProcessMilestone[] = [
  { id: 'a', label: 'Reported', stepId: 'report', order: 0 },
  { id: 'b', label: 'Assessed', stepId: 'assess_claim', order: 1 },
  { id: 'c', label: 'Paid', stepId: 'pay', order: 2 },
]

function respondWithSteps(stepIds: string[]) {
  apiCallMock.mockResolvedValue({
    ok: true,
    status: 200,
    result: {
      data: [
        {
          workflowId: 'claims.intake',
          definition: { steps: stepIds.map((stepId) => ({ stepId, stepName: `Step ${stepId}` })) },
        },
      ],
    },
    response: {},
    cacheStatus: null,
  })
}

function renderEditor(
  value: ProcessMilestone[],
  onChange: (next: ProcessMilestone[]) => void,
  overrides: { targetType?: 'agent' | 'workflow'; workflowId?: string | null } = {},
) {
  renderWithProviders(
    <MilestoneEditor
      value={value}
      onChange={onChange}
      targetType={overrides.targetType ?? 'workflow'}
      workflowId={overrides.workflowId === undefined ? 'claims.intake' : overrides.workflowId}
      t={t}
    />,
  )
}

beforeEach(() => {
  apiCallMock.mockReset()
  respondWithSteps(['report', 'assess_claim', 'pay'])
})

describe('milestone editor', () => {
  it('reorders a milestone and renumbers the whole list', async () => {
    const onChange = jest.fn()
    renderEditor(MILESTONES, onChange)

    const moveUp = await screen.findAllByRole('button', {
      name: 'agent_orchestrator.processDefinitions.milestones.moveUp',
    })
    // The first row cannot move up; the third row's control moves "Paid" above "Assessed".
    fireEvent.click(moveUp[2])

    expect(onChange).toHaveBeenCalledTimes(1)
    const next = onChange.mock.calls[0][0] as ProcessMilestone[]
    expect(next.map((one) => one.label)).toEqual(['Reported', 'Paid', 'Assessed'])
    expect(next.map((one) => one.order)).toEqual([0, 1, 2])
  })

  it('disables the ordering controls at the ends of the list', async () => {
    renderEditor(MILESTONES, jest.fn())
    const moveUp = await screen.findAllByRole('button', {
      name: 'agent_orchestrator.processDefinitions.milestones.moveUp',
    })
    const moveDown = screen.getAllByRole('button', {
      name: 'agent_orchestrator.processDefinitions.milestones.moveDown',
    })
    expect((moveUp[0] as HTMLButtonElement).disabled).toBe(true)
    expect((moveDown[2] as HTMLButtonElement).disabled).toBe(true)
  })

  it('offers the workflow steps to the picker and adds a milestone at the end', async () => {
    const onChange = jest.fn()
    renderEditor(MILESTONES, onChange)

    await waitFor(() => expect(document.querySelectorAll('datalist option')).toHaveLength(3))
    fireEvent.click(screen.getByText('agent_orchestrator.processDefinitions.milestones.add'))

    const next = onChange.mock.calls[0][0] as ProcessMilestone[]
    expect(next).toHaveLength(4)
    expect(next[3].order).toBe(3)
    expect(next[3].id).toBeTruthy()
  })

  it('warns about a milestone whose step the workflow no longer declares, without blocking anything', async () => {
    respondWithSteps(['report', 'pay'])
    renderEditor(MILESTONES, jest.fn())

    await waitFor(() =>
      expect(
        screen.getByText('agent_orchestrator.processDefinitions.milestones.problems.title'),
      ).toBeTruthy(),
    )
    expect(
      screen.getByText('agent_orchestrator.processDefinitions.milestones.problems.stillSaveable'),
    ).toBeTruthy()
    // The editor still renders every row and every control — nothing is disabled by a warning.
    expect(
      screen.getAllByRole('button', {
        name: 'agent_orchestrator.processDefinitions.milestones.remove',
      }),
    ).toHaveLength(3)
  })

  it('reports nothing when the workflow steps could not be resolved', async () => {
    apiCallMock.mockResolvedValue({ ok: false, status: 403, result: {}, response: {}, cacheStatus: null })
    renderEditor(MILESTONES, jest.fn())

    await waitFor(() =>
      expect(
        screen.getByText('agent_orchestrator.processDefinitions.milestones.stepsUnresolved'),
      ).toBeTruthy(),
    )
    expect(
      screen.queryByText('agent_orchestrator.processDefinitions.milestones.problems.title'),
    ).toBeNull()
  })

  it('refuses to author milestones on an agent target and never asks for steps', async () => {
    renderEditor([], jest.fn(), { targetType: 'agent', workflowId: null })

    expect(
      screen.getByText('agent_orchestrator.processDefinitions.milestones.agentTargetHint'),
    ).toBeTruthy()
    expect(
      screen.queryByText('agent_orchestrator.processDefinitions.milestones.add'),
    ).toBeNull()
    await waitFor(() => expect(apiCallMock).not.toHaveBeenCalled())
  })
})
