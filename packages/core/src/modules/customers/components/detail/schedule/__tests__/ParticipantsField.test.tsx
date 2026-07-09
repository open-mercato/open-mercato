/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { ParticipantsField } from '../ParticipantsField'
import type { Participant } from '../useScheduleFormState'

jest.mock('../../assignableStaff', () => ({
  fetchAssignableStaffMembersPage: jest.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 }),
}))

const baseGuestPermissions = { canInviteOthers: false, canModify: false, canSeeList: false }

function renderField(overrides?: {
  participants?: Participant[]
  setGuestPermissions?: jest.Mock
  guestPermissions?: typeof baseGuestPermissions
}) {
  const setGuestPermissions = overrides?.setGuestPermissions ?? jest.fn()
  renderWithProviders(
    <ParticipantsField
      visible={new Set(['participants'])}
      activityType="meeting"
      participants={overrides?.participants ?? []}
      setParticipants={jest.fn()}
      removeParticipant={jest.fn()}
      guestPermissions={overrides?.guestPermissions ?? baseGuestPermissions}
      setGuestPermissions={setGuestPermissions}
    />,
  )
  return { setGuestPermissions }
}

const sampleParticipant: Participant = {
  userId: 'user-1',
  name: 'Jan Kowalski',
  email: 'jan@example.com',
  color: 'bg-primary',
  status: 'pending',
}

describe('ParticipantsField', () => {
  it('renders the participant search through the shared SearchInput primitive (no raw <input>)', async () => {
    await act(async () => {
      renderField()
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add participant' }))
    })

    await waitFor(() =>
      expect(screen.getByPlaceholderText('Search team members...')).toBeInTheDocument(),
    )
    const searchInput = screen.getByPlaceholderText('Search team members...')
    expect(searchInput).toHaveAttribute('type', 'search')
  })

  it('renders guest-permission toggles as shared Checkbox primitives and reports changes', async () => {
    const setGuestPermissions = jest.fn()
    await act(async () => {
      renderField({ participants: [sampleParticipant], setGuestPermissions })
    })

    const checkboxes = screen.getAllByRole('checkbox')
    expect(checkboxes.length).toBe(3)

    await act(async () => {
      fireEvent.click(screen.getByText('Invite others'))
    })

    expect(setGuestPermissions).toHaveBeenCalledTimes(1)
    const updater = setGuestPermissions.mock.calls[0][0] as (prev: typeof baseGuestPermissions) => typeof baseGuestPermissions
    expect(updater(baseGuestPermissions)).toEqual({ ...baseGuestPermissions, canInviteOthers: true })
  })
})
