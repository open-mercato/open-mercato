/**
 * @jest-environment jsdom
 */
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import enDict from '../../../i18n/en.json'
import plDict from '../../../i18n/pl.json'
import { ActivityTimeline } from '../ActivityTimeline'
import type { InteractionSummary } from '../types'

function createActivity(overrides: Partial<InteractionSummary> = {}): InteractionSummary {
  return {
    id: 'activity-1',
    interactionType: 'task',
    title: 'Send revised offer',
    body: null,
    status: 'planned',
    scheduledAt: '2026-04-10T09:30:00.000Z',
    occurredAt: null,
    priority: null,
    authorUserId: 'user-1',
    ownerUserId: null,
    appearanceIcon: null,
    appearanceColor: null,
    source: 'manual',
    entityId: 'company-1',
    dealId: 'deal-1',
    organizationId: null,
    tenantId: null,
    authorName: 'Jane Doe',
    authorEmail: 'jane@example.com',
    dealTitle: null,
    customValues: null,
    createdAt: '2026-04-10T09:30:00.000Z',
    updatedAt: '2026-04-10T09:30:00.000Z',
    ...overrides,
  }
}

const locales = [
  { locale: 'en', dict: enDict as Record<string, string>, label: 'Canceled' },
  { locale: 'pl', dict: plDict as Record<string, string>, label: 'Anulowana' },
]

describe('ActivityTimeline canceled status', () => {
  it.each(locales)('labels a canceled activity and strikes its title through ($locale)', ({ locale, dict, label }) => {
    renderWithProviders(
      <ActivityTimeline activities={[createActivity({ status: 'canceled' })]} onMarkDone={jest.fn()} />,
      { locale, dict },
    )

    expect(screen.getByText(label)).toBeInTheDocument()
    expect(screen.getByText('Send revised offer')).toHaveClass('line-through')
    expect(screen.queryByRole('button', { name: dict['customers.activities.actions.markDone'] })).not.toBeInTheDocument()
  })

  it.each(locales)('labels every canceled row in a mixed list ($locale)', ({ locale, dict, label }) => {
    renderWithProviders(
      <ActivityTimeline
        activities={[
          createActivity({ id: 'a-1', title: 'First canceled', status: 'canceled' }),
          createActivity({ id: 'a-2', title: 'Completed call', interactionType: 'call', status: 'done' }),
          createActivity({ id: 'a-3', title: 'Second canceled', status: 'canceled' }),
        ]}
      />,
      { locale, dict },
    )

    expect(screen.getAllByText(label)).toHaveLength(2)
    expect(screen.getByText('First canceled')).toHaveClass('line-through')
    expect(screen.getByText('Second canceled')).toHaveClass('line-through')
    expect(screen.getByText('Completed call')).not.toHaveClass('line-through')
  })

  it.each(['planned', 'in_progress', 'waiting', 'done', 'completed', 'follow_up_custom'])(
    'does not show the canceled label for status %s',
    (status) => {
      renderWithProviders(<ActivityTimeline activities={[createActivity({ status })]} />, {
        locale: 'en',
        dict: enDict as Record<string, string>,
      })

      expect(screen.queryByText('Canceled')).not.toBeInTheDocument()
      expect(screen.getByText('Send revised offer')).not.toHaveClass('line-through')
    },
  )

  it('keeps the Mark done action for open activities', () => {
    renderWithProviders(<ActivityTimeline activities={[createActivity()]} onMarkDone={jest.fn()} />)

    expect(screen.getByRole('button', { name: /Mark done/i })).toBeInTheDocument()
  })
})

it.each([
  { locale: 'en', dict: enDict, label: 'Unknown date' },
  { locale: 'pl', dict: plDict, label: 'Nieznana data' },
])('ActivityTimeline preserves unknown dates ($locale)', ({ locale, dict, label }) => {
  const activity = createActivity({ occurredAt: null, scheduledAt: null, createdAt: '2035-01-01T12:34:00.000Z' })
  renderWithProviders(<ActivityTimeline activities={[activity]} />, { locale, dict })
  expect(screen.getByText(label)).toBeInTheDocument()
  expect(screen.queryByText('2035')).not.toBeInTheDocument()
  expect(screen.queryByText(/12:34/)).not.toBeInTheDocument()
})

describe('ActivityTimeline delete affordance', () => {
  it('keeps delete inside the overflow menu and forwards the activity to onDelete', async () => {
    const onDelete = jest.fn()
    const onEdit = jest.fn()
    const activity = createActivity({ interactionType: 'call', title: 'Intro call' })
    renderWithProviders(<ActivityTimeline activities={[activity]} onEdit={onEdit} onDelete={onDelete} />)

    expect(screen.queryByRole('menuitem', { name: 'Delete activity' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Open actions' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete activity' }))

    await waitFor(() => {
      expect(onDelete).toHaveBeenCalledWith(activity)
    })
    expect(onEdit).not.toHaveBeenCalled()
  })

  it('offers Edit in the same menu and opens the activity for editing', async () => {
    const onEdit = jest.fn()
    const activity = createActivity()
    renderWithProviders(<ActivityTimeline activities={[activity]} onEdit={onEdit} />)

    fireEvent.click(screen.getByRole('button', { name: 'Open actions' }))
    expect(screen.queryByRole('menuitem', { name: 'Delete activity' })).toBeNull()
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Edit' }))

    expect(onEdit).toHaveBeenCalledTimes(1)
    expect(onEdit).toHaveBeenCalledWith(activity)
  })

  it('does not render the overflow menu when the row has no actions', () => {
    renderWithProviders(<ActivityTimeline activities={[createActivity()]} />)
    expect(screen.queryByRole('button', { name: 'Open actions' })).toBeNull()
  })
})
