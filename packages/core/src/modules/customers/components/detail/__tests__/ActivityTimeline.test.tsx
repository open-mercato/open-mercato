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
  it('keeps delete inside the overflow menu and forwards the activity to onDelete', async () => {
    const onDelete = jest.fn()
    renderWithProviders(<ActivityTimeline activities={[baseActivity]} onDelete={onDelete} />)

    expect(screen.queryByRole('menuitem', { name: 'Delete activity' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Open actions' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete activity' }))

    await waitFor(() => {
      expect(onDelete).toHaveBeenCalledWith(baseActivity)
    })
  })

  it('does not render the overflow menu when onDelete is not provided', () => {
    renderWithProviders(<ActivityTimeline activities={[baseActivity]} />)
    expect(screen.queryByRole('button', { name: 'Open actions' })).toBeNull()
  })
})
