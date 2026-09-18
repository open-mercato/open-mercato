/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import type { ProcessMilestone } from '../data/validators'
import { MilestoneEditor } from '../backend/processes/definitions/MilestoneEditor'
import { fetchWorkflowMilestones } from '../backend/processes/definitions/milestoneSuggestions'
import dictionary from '../i18n/en.json'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({ apiCall: jest.fn() }))
const apiCallMock = apiCall as jest.Mock
const t: TranslateFn = (key, fallback, params) => {
  const text = (dictionary as Record<string, string>)[key] ?? fallback ?? key
  return text.replace(/\{(\w+)\}/g, (match, name: string) => String(params?.[name] ?? match))
}
const milestones: ProcessMilestone[] = [
  { key: 'reported', label: 'Reported', order: 0 },
  { key: 'paid', label: 'Paid', order: 1 },
]
function response(keys: string[], workflowId = 'claims.intake') {
  return {
    ok: true,
    result: {
      data: [
        {
          id: 'definition',
          workflowId,
          version: 1,
          definition: {
            steps: keys.map((milestone) => ({ stepId: milestone, stepName: milestone + ' step', milestone })),
          },
        },
      ],
      pagination: { hasMore: false },
    },
  }
}
function Harness({
  workflowId = 'claims.intake',
  initial = [],
}: {
  workflowId?: string
  initial?: ProcessMilestone[]
}) {
  const [value, setValue] = React.useState(initial)
  return (
    <>
      <MilestoneEditor value={value} onChange={setValue} workflowId={workflowId} t={t} />
      <output data-testid="stored">{JSON.stringify(value)}</output>
    </>
  )
}
beforeEach(() => {
  apiCallMock.mockReset()
  apiCallMock.mockResolvedValue(response(['reported', 'paid']))
})

test('selects a reported milestone, edits its display name without changing its key, and removes the suggestion', async () => {
  renderWithProviders(<Harness />)
  const suggestion = await screen.findByRole('button', { name: /Reported.*reported step/ })
  fireEvent.click(suggestion)
  const label = screen.getByDisplayValue('Reported')
  fireEvent.change(label, { target: { value: 'Request received' } })
  expect(screen.getByTestId('stored').textContent).toContain('"key":"reported","label":"Request received"')
  expect(screen.queryByRole('button', { name: /Reported.*reported step/ })).toBeNull()
})

test('adds all unselected milestones without duplicates and supports reordering', async () => {
  renderWithProviders(<Harness initial={[milestones[0]]} />)
  fireEvent.click(await screen.findByRole('button', { name: /Paid.*paid step/ }))
  fireEvent.click(
    screen.getAllByRole('button', { name: t('agent_orchestrator.processDefinitions.milestones.moveUp') })[1],
  )
  expect(JSON.parse(screen.getByTestId('stored').textContent!)).toEqual([
    { key: 'paid', label: 'Paid', order: 0 },
    { key: 'reported', label: 'Reported', order: 1 },
  ])
})

test('empty workflow explains overall status and never invents suggestions', async () => {
  apiCallMock.mockResolvedValue(response([]))
  renderWithProviders(<Harness />)
  expect(
    await screen.findByText(t('agent_orchestrator.processDefinitions.milestones.noSuggestions')),
  ).toBeTruthy()
  expect(screen.queryByText(t('agent_orchestrator.processDefinitions.milestones.available'))).toBeNull()
})

test('custom drafts are not saved or warned about until explicitly added', async () => {
  renderWithProviders(<Harness />)
  await screen.findByText(t('agent_orchestrator.processDefinitions.milestones.available'))
  fireEvent.click(screen.getByText(t('agent_orchestrator.processDefinitions.milestones.custom')))
  fireEvent.change(screen.getByLabelText(t('agent_orchestrator.processDefinitions.milestones.label')), {
    target: { value: 'Review done' },
  })
  expect(screen.getByTestId('stored').textContent).toBe('[]')
  expect(screen.queryByRole('alert')).toBeNull()
  fireEvent.click(
    screen.getByRole('button', {
      name: t('agent_orchestrator.processDefinitions.milestones.add'),
      exact: true,
    }),
  )
  expect(screen.getByTestId('stored').textContent).toContain('"key":"review_done"')
  expect(screen.getByText(/Not reported by the selected workflow: Review done/)).toBeTruthy()
})

test('network failures offer retry and do not assert milestones are missing', async () => {
  apiCallMock.mockRejectedValueOnce(new Error('offline'))
  renderWithProviders(<Harness initial={milestones} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Try again' }))
  await waitFor(() => expect(apiCallMock).toHaveBeenCalledTimes(2))
  expect(screen.queryByText(/Not reported by the selected workflow:/)).toBeNull()
})

test('switching workflows keeps selected milestones and ignores a late old response', async () => {
  let resolveOld: (value: ReturnType<typeof response>) => void = () => {}
  apiCallMock.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveOld = resolve
      }),
  )
  const { rerender } = renderWithProviders(<Harness initial={milestones} />)
  apiCallMock.mockResolvedValue(response(['reviewed'], 'new.workflow'))
  rerender(<Harness workflowId="new.workflow" initial={milestones} />)
  await screen.findByRole('button', { name: /Reviewed.*reviewed step/ })
  resolveOld(response(['reported']))
  await waitFor(() => expect(screen.queryByRole('button', { name: /Reported.*reported step/ })).toBeNull())
  expect(screen.getByTestId('stored').textContent).toContain('"key":"paid"')
})

test('new single-agent processes suggest only completion without requesting a workflow', async () => {
  renderWithProviders(<MilestoneEditor value={[]} onChange={jest.fn()} workflowId={null} singleAgent t={t} />)
  expect(screen.getByRole('button', { name: /Task completed/ })).toBeTruthy()
  expect(apiCallMock).not.toHaveBeenCalled()
})

test('reads the latest published version across pages and combines repeated milestone emissions', async () => {
  apiCallMock
    .mockResolvedValueOnce({
      ok: true,
      result: {
        data: [{ workflowId: 'claims.intake', version: 1, definition: { steps: [{ milestone: 'old' }] } }],
        pagination: { hasMore: true },
      },
    })
    .mockResolvedValueOnce({
      ok: true,
      result: {
        data: [
          {
            workflowId: 'claims.intake',
            version: 3,
            definition: {
              steps: [
                { stepName: 'Card payment', milestone: 'paid' },
                { stepName: 'Bank transfer', milestone: 'paid' },
                { stepName: 'Unmarked step' },
              ],
            },
          },
        ],
        pagination: { hasMore: false },
      },
    })
  const result = await fetchWorkflowMilestones('claims.intake')
  expect(result?.suggestions).toEqual([
    { key: 'paid', label: 'Paid', steps: ['Card payment', 'Bank transfer'] },
  ])
  expect(apiCallMock.mock.calls[1][0]).toContain('offset=100')
  expect(apiCallMock.mock.calls[0][0]).toContain('lifecycle=published')
})
