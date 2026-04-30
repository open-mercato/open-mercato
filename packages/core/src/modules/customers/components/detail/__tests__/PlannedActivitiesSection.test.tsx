/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { PlannedActivitiesSection } from '../PlannedActivitiesSection'

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
})
