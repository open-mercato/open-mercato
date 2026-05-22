/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { ActivitiesCard } from '../ActivitiesCard'
import type { InteractionSummary } from '../types'

const readApiResultOrThrowMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: (...args: unknown[]) => readApiResultOrThrowMock(...args),
}))

function makePlannedActivity(overrides: Partial<InteractionSummary> = {}): InteractionSummary {
  const today = new Date()
  today.setHours(10, 0, 0, 0)
  return {
    id: 'act-1',
    interactionType: 'meeting',
    title: 'Q2 review meeting with Sarah',
    body: null,
    status: 'planned',
    scheduledAt: today.toISOString(),
    occurredAt: null,
    priority: null,
    authorUserId: null,
    ownerUserId: null,
    appearanceIcon: null,
    appearanceColor: null,
    source: null,
    entityId: 'entity-1',
    dealId: null,
    organizationId: null,
    tenantId: null,
    authorName: null,
    authorEmail: null,
    dealTitle: null,
    customValues: null,
    duration: 25,
    createdAt: today.toISOString(),
    updatedAt: today.toISOString(),
    ...overrides,
  }
}

describe('ActivitiesCard — planned event subtitle fallback', () => {
  beforeEach(() => {
    readApiResultOrThrowMock.mockReset()
    readApiResultOrThrowMock.mockResolvedValue({ items: [] })
  })

  it('uses the company name as subtitle suffix when the activity has no dealTitle', () => {
    renderWithProviders(
      <ActivitiesCard
        entityId="person-123"
        plannedActivities={[makePlannedActivity({ dealTitle: null })]}
        entityCompanyName="Copperleaf Design Co."
        onAddNew={() => {}}
      />,
    )
    const subtitle = screen.getByText(/Copperleaf Design Co\./)
    expect(subtitle.textContent).toContain('Meeting')
    expect(subtitle.textContent).toContain('Copperleaf Design Co.')
  })

  it('prefers dealTitle over the company-name fallback', () => {
    renderWithProviders(
      <ActivitiesCard
        entityId="person-123"
        plannedActivities={[
          makePlannedActivity({ dealTitle: 'Q2 Enterprise Deal', interactionType: 'call' }),
        ]}
        entityCompanyName="Copperleaf Design Co."
        onAddNew={() => {}}
      />,
    )
    expect(screen.getByText(/Q2 Enterprise Deal/)).toBeInTheDocument()
    expect(screen.queryByText(/Copperleaf Design Co\./)).toBeNull()
  })

  it('renders bare type when neither dealTitle nor entityCompanyName is supplied', () => {
    renderWithProviders(
      <ActivitiesCard
        entityId="person-123"
        plannedActivities={[
          makePlannedActivity({ dealTitle: null, interactionType: 'email' }),
        ]}
        onAddNew={() => {}}
      />,
    )
    const subtitle = screen.getByText('Email')
    expect(subtitle).toBeInTheDocument()
  })
})
