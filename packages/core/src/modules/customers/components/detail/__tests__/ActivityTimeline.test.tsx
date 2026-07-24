/**
 * @jest-environment jsdom
 */
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { ActivityTimeline } from '../ActivityTimeline'
import type { InteractionSummary } from '../types'

jest.mock('../AiActionChips', () => ({
  AiActionChips: () => null,
}))

const baseActivity: InteractionSummary = {
  id: 'act-1',
  interactionType: 'call',
  title: 'Intro call',
  body: null,
  status: 'planned',
  scheduledAt: '2026-07-24T14:30:00.000Z',
  occurredAt: null,
  priority: null,
  authorUserId: null,
  ownerUserId: null,
  appearanceIcon: null,
  appearanceColor: null,
  source: 'interaction',
  entityId: 'person-1',
  dealId: null,
  organizationId: null,
  tenantId: null,
  authorName: null,
  authorEmail: null,
  dealTitle: null,
  customValues: null,
  createdAt: '2026-07-01T10:00:00.000Z',
  updatedAt: '2026-07-01T10:00:00.000Z',
}

describe('ActivityTimeline delete affordance', () => {
  it('renders a delete button per row and forwards the activity to onDelete', async () => {
    const onDelete = jest.fn()
    renderWithProviders(<ActivityTimeline activities={[baseActivity]} onDelete={onDelete} />)

    const deleteButton = screen.getByRole('button', { name: 'Delete activity' })
    fireEvent.click(deleteButton)

    await waitFor(() => {
      expect(onDelete).toHaveBeenCalledWith(baseActivity)
    })
  })

  it('does not render a delete button when onDelete is not provided', () => {
    renderWithProviders(<ActivityTimeline activities={[baseActivity]} />)
    expect(screen.queryByRole('button', { name: 'Delete activity' })).toBeNull()
  })
})
