/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { ParticipantsField } from '../ParticipantsField'
import type { Participant } from '../useScheduleFormState'
import { fetchAssignableStaffMembersPage } from '../../assignableStaff'

jest.mock('../../assignableStaff', () => ({
  fetchAssignableStaffMembersPage: jest
    .fn()
    .mockResolvedValue({ items: [], servedCount: 0, total: 0, page: 1, pageSize: 20 }),
}))

const baseGuestPermissions = { canInviteOthers: false, canModify: false, canSeeList: false }

function renderField(overrides?: {
  participants?: Participant[]
  setGuestPermissions?: jest.Mock
  guestPermissions?: typeof baseGuestPermissions
  removeParticipant?: jest.Mock
}) {
  const setGuestPermissions = overrides?.setGuestPermissions ?? jest.fn()
  const removeParticipant = overrides?.removeParticipant ?? jest.fn()
  renderWithProviders(
    <ParticipantsField
      visible={new Set(['participants'])}
      activityType="meeting"
      participants={overrides?.participants ?? []}
      setParticipants={jest.fn()}
      removeParticipant={removeParticipant}
      guestPermissions={overrides?.guestPermissions ?? baseGuestPermissions}
      setGuestPermissions={setGuestPermissions}
    />,
  )
  return { setGuestPermissions, removeParticipant }
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
      fireEvent.focus(screen.getByPlaceholderText('Search team members...'))
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

  it('removes the clicked guest chip by position, not by userId, when multiple guests have no userId', async () => {
    const guestOne: Participant = { name: 'Guest One', email: 'guest-one@example.org', status: 'pending' }
    const guestTwo: Participant = { name: 'Guest Two', email: 'guest-two@example.org', status: 'pending' }
    const removeParticipant = jest.fn()
    await act(async () => {
      renderField({ participants: [guestOne, guestTwo], removeParticipant })
    })

    const removeButtons = screen.getAllByRole('button', { name: 'Remove participant' })
    expect(removeButtons).toHaveLength(2)

    await act(async () => {
      fireEvent.click(removeButtons[1])
    })

    expect(removeParticipant).toHaveBeenCalledTimes(1)
    expect(removeParticipant).toHaveBeenCalledWith(1)
  })

  // The guard used to be a `total`-derived `page < totalPages`. When the total
  // under-reports (a capped list count, or staff added between requests) the
  // button vanished and the remaining members were unreachable.
  describe('load-more termination', () => {
    it('offers Load more on a full page even when total under-reports', async () => {
      ;(fetchAssignableStaffMembersPage as jest.Mock).mockResolvedValueOnce({
        items: Array.from({ length: 20 }, (_, index) => ({
          userId: `staff-${index + 1}`,
          displayName: `Staff ${index + 1}`,
          email: `staff${index + 1}@example.com`,
        })),
        servedCount: 20,
        total: 3,
        page: 1,
        pageSize: 20,
      })

      await act(async () => { renderField() })
      fireEvent.focus(screen.getByPlaceholderText('Search team members...'))

      await waitFor(() => {
        expect(screen.getByText('Staff 1')).toBeInTheDocument()
      })
      expect(screen.getByRole('button', { name: 'Load more' })).toBeInTheDocument()
    })

    it('hides Load more once a page comes back short', async () => {
      ;(fetchAssignableStaffMembersPage as jest.Mock).mockResolvedValueOnce({
        items: [{ userId: 'staff-1', displayName: 'Staff 1', email: 'staff1@example.com' }],
        servedCount: 1,
        // A large total must not conjure a next page.
        total: 999,
        page: 1,
        pageSize: 20,
      })

      await act(async () => { renderField() })
      fireEvent.focus(screen.getByPlaceholderText('Search team members...'))

      await waitFor(() => {
        expect(screen.getByText('Staff 1')).toBeInTheDocument()
      })
      expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull()
    })

    // `/api/staff/team-members/assignable` is a query-engine list: a page past
    // the end comes back empty, not clamped. That empty page is what ends the
    // sequence, at the cost of one extra request.
    it('stops on the empty page past the end', async () => {
      ;(fetchAssignableStaffMembersPage as jest.Mock)
        .mockResolvedValueOnce({
          items: Array.from({ length: 20 }, (_, index) => ({
            userId: `staff-${index + 1}`,
            displayName: `Staff ${index + 1}`,
            email: `staff${index + 1}@example.com`,
          })),
          servedCount: 20,
          total: 20,
          page: 1,
          pageSize: 20,
        })
        .mockResolvedValueOnce({ items: [], servedCount: 0, total: 20, page: 2, pageSize: 20 })

      await act(async () => { renderField() })
      fireEvent.focus(screen.getByPlaceholderText('Search team members...'))

      await waitFor(() => {
        expect(screen.getByText('Staff 1')).toBeInTheDocument()
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
      })

      await waitFor(() => {
        expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull()
      })
      expect(screen.getByText('Staff 20')).toBeInTheDocument()
    })

    // The served count, not the deduped list, decides. A page the server filled
    // but whose rows collapse under dedupe must still offer the next page.
    it('offers Load more when dedupe shortens a full page', async () => {
      ;(fetchAssignableStaffMembersPage as jest.Mock).mockResolvedValueOnce({
        items: [{ userId: 'staff-1', displayName: 'Staff 1', email: 'staff1@example.com' }],
        servedCount: 20,
        total: 20,
        page: 1,
        pageSize: 20,
      })

      await act(async () => { renderField() })
      fireEvent.focus(screen.getByPlaceholderText('Search team members...'))

      await waitFor(() => {
        expect(screen.getByText('Staff 1')).toBeInTheDocument()
      })
      expect(screen.getByRole('button', { name: 'Load more' })).toBeInTheDocument()
    })
  })
})
