/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { PlannedActivitiesSection } from '../PlannedActivitiesSection'
import type { InteractionSummary } from '../types'

function makeActivity(overrides: Partial<InteractionSummary> & { id: string }): InteractionSummary {
  return {
    interactionType: 'meeting',
    title: 'Follow-up call',
    body: null,
    status: 'planned',
    scheduledAt: null,
    occurredAt: null,
    priority: null,
    authorUserId: null,
    ownerUserId: null,
    appearanceIcon: null,
    appearanceColor: null,
    source: 'manual',
    entityId: 'company-1',
    dealId: null,
    organizationId: 'org-1',
    tenantId: 'tenant-1',
    authorName: null,
    authorEmail: null,
    dealTitle: null,
    customValues: null,
    createdAt: '2026-04-01T10:00:00.000Z',
    updatedAt: '2026-04-01T10:00:00.000Z',
    ...overrides,
  } as InteractionSummary
}

// Builds an ISO instant at a given wall-clock time on the reader's local calendar
// day `dayOffset` days from today, so the assertions below describe a calendar day
// rather than a fixed number of milliseconds from now.
function localInstantAtOffset(dayOffset: number, hours: number, minutes: number): string {
  const target = new Date()
  target.setDate(target.getDate() + dayOffset)
  target.setHours(hours, minutes, 0, 0)
  return target.toISOString()
}

const PL_DICT = {
  'customers.timeline.planned.tomorrow': 'Jutro {{time}}',
}

describe('PlannedActivitiesSection', () => {
  it('marks an overdue activity done without opening the edit flow', () => {
    const onComplete = jest.fn()
    const onEdit = jest.fn()

    renderWithProviders(
      <PlannedActivitiesSection
        activities={[
          {
            id: 'activity-1',
            interactionType: 'meeting',
            title: 'Follow-up call',
            body: null,
            status: 'planned',
            scheduledAt: '2026-04-10T09:00:00.000Z',
            occurredAt: null,
            priority: null,
            authorUserId: null,
            ownerUserId: null,
            appearanceIcon: null,
            appearanceColor: null,
            source: 'manual',
            entityId: 'company-1',
            dealId: null,
            organizationId: 'org-1',
            tenantId: 'tenant-1',
            authorName: 'Ada Lovelace',
            authorEmail: null,
            dealTitle: null,
            customValues: null,
            createdAt: '2026-04-01T10:00:00.000Z',
            updatedAt: '2026-04-01T10:00:00.000Z',
          },
        ]}
        onComplete={onComplete}
        onEdit={onEdit}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Mark done' }))

    expect(onComplete).toHaveBeenCalledWith('activity-1')
    expect(onEdit).not.toHaveBeenCalled()
  })

  it('translates the due-tomorrow label instead of rendering the English literal (#5933)', () => {
    renderWithProviders(
      <PlannedActivitiesSection
        activities={[makeActivity({ id: 'activity-tomorrow', scheduledAt: localInstantAtOffset(1, 10, 30) })]}
      />,
      { locale: 'pl', dict: PL_DICT },
    )

    expect(screen.getByText(/^Jutro /)).toBeTruthy()
    expect(screen.queryByText(/Tomorrow/)).toBeNull()
  })

  it('falls back to the English default when the dictionary has no tomorrow entry', () => {
    renderWithProviders(
      <PlannedActivitiesSection
        activities={[makeActivity({ id: 'activity-tomorrow', scheduledAt: localInstantAtOffset(1, 10, 30) })]}
      />,
    )

    expect(screen.getByText(/^Tomorrow /)).toBeTruthy()
  })

  it('treats the whole of tomorrow as tomorrow, at both ends of the local calendar day (#5933)', () => {
    renderWithProviders(
      <PlannedActivitiesSection
        activities={[
          makeActivity({ id: 'just-after-midnight', title: 'Early', scheduledAt: localInstantAtOffset(1, 0, 5) }),
          makeActivity({ id: 'just-before-midnight', title: 'Late', scheduledAt: localInstantAtOffset(1, 23, 55) }),
        ]}
      />,
      { locale: 'pl', dict: PL_DICT },
    )

    expect(screen.getAllByText(/^Jutro /)).toHaveLength(2)
  })

  it('does not label activities outside tomorrow as tomorrow', () => {
    renderWithProviders(
      <PlannedActivitiesSection
        activities={[
          makeActivity({ id: 'later-today', title: 'Later today', scheduledAt: localInstantAtOffset(0, 23, 30) }),
          makeActivity({ id: 'day-after', title: 'Day after', scheduledAt: localInstantAtOffset(2, 10, 0) }),
        ]}
      />,
      { locale: 'pl', dict: PL_DICT },
    )

    expect(screen.queryByText(/^Jutro /)).toBeNull()
    expect(screen.queryByText(/Tomorrow/)).toBeNull()
  })
})
