/**
 * @jest-environment jsdom
 *
 * The milestone editor island: reordering, the key suggestions read back from
 * the bound workflow, and the drift warning it renders without ever blocking a
 * save.
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
  { key: 'reported', label: 'Reported', order: 0 },
  { key: 'assessed', label: 'Assessed', order: 1 },
  { key: 'paid', label: 'Paid', order: 2 },
]

/**
 * The workflow as the definitions API returns it. A milestone key is what a STEP
 * announces, so the editor reads the keys off the steps rather than the step ids
 * themselves — the whole point of the model is that the two are different things.
 */
function respondWithEmittedKeys(keys: Array<string | null>) {
  apiCallMock.mockResolvedValue({
    ok: true,
    status: 200,
    result: {
      data: [
        {
          workflowId: 'claims.intake',
          definition: {
            steps: keys.map((milestone, index) => ({
              stepId: `step_${index}`,
              ...(milestone ? { milestone } : {}),
            })),
          },
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
  overrides: { workflowId?: string | null } = {},
) {
  renderWithProviders(
    <MilestoneEditor
      value={value}
      onChange={onChange}
      workflowId={overrides.workflowId === undefined ? 'claims.intake' : overrides.workflowId}
      t={t}
    />,
  )
}

beforeEach(() => {
  apiCallMock.mockReset()
  respondWithEmittedKeys(['reported', 'assessed', 'paid'])
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

  it('suggests the keys the workflow emits and adds a milestone at the end', async () => {
    const onChange = jest.fn()
    renderEditor(MILESTONES, onChange)

    await waitFor(() => expect(document.querySelectorAll('datalist option')).toHaveLength(3))
    fireEvent.click(screen.getByText('agent_orchestrator.processDefinitions.milestones.add'))

    const next = onChange.mock.calls[0][0] as ProcessMilestone[]
    expect(next).toHaveLength(4)
    expect(next[3].order).toBe(3)
    // A new row starts blank: the key is a business identifier the author chooses
    // and the workflow must literally emit, never a generated id.
    expect(next[3].key).toBe('')
  })

  it('ignores steps that announce no milestone — a step is not a milestone', async () => {
    respondWithEmittedKeys(['reported', null, null])
    renderEditor(MILESTONES, jest.fn())
    await waitFor(() => expect(document.querySelectorAll('datalist option')).toHaveLength(1))
  })

  it('warns about a declared key no step emits, without blocking anything', async () => {
    respondWithEmittedKeys(['reported', 'paid'])
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

  it('reports nothing when the workflow could not be resolved — unknown is not missing', async () => {
    apiCallMock.mockResolvedValue({ ok: false, status: 403, result: {}, response: {}, cacheStatus: null })
    renderEditor(MILESTONES, jest.fn())

    await waitFor(() =>
      expect(
        screen.getByText('agent_orchestrator.processDefinitions.milestones.emittedUnresolved'),
      ).toBeTruthy(),
    )
    expect(
      screen.queryByText('agent_orchestrator.processDefinitions.milestones.problems.title'),
    ).toBeNull()
  })

  it('still authors milestones with no workflow bound, and asks nothing', async () => {
    // A single-agent process has no workflow id until the definition is saved, and
    // the vocabulary is authored on the PROCESS — so the editor stays usable.
    renderEditor([], jest.fn(), { workflowId: null })

    expect(
      screen.getByText('agent_orchestrator.processDefinitions.milestones.add'),
    ).toBeTruthy()
    await waitFor(() => expect(apiCallMock).not.toHaveBeenCalled())
  })
})
