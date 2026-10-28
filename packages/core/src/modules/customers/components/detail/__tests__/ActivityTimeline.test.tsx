/**
 * @jest-environment jsdom
 */
import { screen } from '@testing-library/react'
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
