/** @jest-environment jsdom */

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}))

jest.mock('@open-mercato/ui/backend/BackendChromeProvider', () => ({
  useCurrentOrganization: () => ({ id: 'org-1' }),
}))

const fetchAssignableStaffMembers = jest.fn()
jest.mock('../../../lib/assignableStaff', () => ({
  fetchAssignableStaffMembers: (...args: unknown[]) => fetchAssignableStaffMembers(...args),
}))

import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { DealOwnerSelect } from '../DealOwnerSelect'

function getInput(container: HTMLElement): HTMLInputElement {
  const el = container.querySelector('input')
  if (!el) throw new Error('input not found')
  return el as HTMLInputElement
}

beforeEach(() => {
  fetchAssignableStaffMembers.mockReset()
  fetchAssignableStaffMembers.mockResolvedValue([])
})

describe('DealOwnerSelect', () => {
  it('shows the seeded owner immediately, before any roster request resolves', () => {
    render(
      <DealOwnerSelect
        value="user-1"
        onChange={() => {}}
        initialOption={{ id: 'user-1', name: 'Ada Lovelace', email: 'ada@example.com' }}
      />,
    )

    expect(screen.getByText('Ada Lovelace')).toBeTruthy()
  })

  it('falls back to the email, then the raw id, when no display name is known', () => {
    const { rerender } = render(
      <DealOwnerSelect value="user-1" onChange={() => {}} initialOption={{ id: 'user-1', email: 'ada@example.com' }} />,
    )
    expect(screen.getByText('ada@example.com')).toBeTruthy()

    rerender(<DealOwnerSelect value="user-2" onChange={() => {}} initialOption={{ id: 'user-2' }} />)
    expect(screen.getByText('user-2')).toBeTruthy()
  })

  it('maps roster members to lookup items using the shared staff helper', async () => {
    fetchAssignableStaffMembers.mockResolvedValue([
      { teamMemberId: 'tm-1', userId: 'user-9', displayName: 'Grace Hopper', email: 'grace@example.com', teamName: null },
    ])

    const { container } = render(<DealOwnerSelect value={null} onChange={() => {}} />)
    fireEvent.change(getInput(container), { target: { value: 'grace' } })

    await waitFor(() => expect(fetchAssignableStaffMembers).toHaveBeenCalled())
    // activeOrgId scopes the staff-module-absent fallback; without it the roster spans
    // every organization.
    expect(fetchAssignableStaffMembers.mock.calls[0][1]).toMatchObject({ pageSize: 20, activeOrgId: 'org-1' })
    await waitFor(() => expect(screen.getByText('Grace Hopper')).toBeTruthy())
  })

  // Spec D5: clearing an owner is supported, so the picker must offer the clear control and
  // pass the null straight through — the forms turn it into `ownerUserId: null`.
  it('offers a clear control when an owner is selected', () => {
    render(
      <DealOwnerSelect
        value="user-1"
        onChange={() => {}}
        initialOption={{ id: 'user-1', name: 'Ada Lovelace' }}
      />,
    )

    expect(screen.getAllByRole('button', { name: /clear selection/i }).length).toBeGreaterThan(0)
  })

  it('propagates a cleared selection as null so the owner can be unassigned', () => {
    const onChange = jest.fn()
    render(
      <DealOwnerSelect
        value="user-1"
        onChange={onChange}
        initialOption={{ id: 'user-1', name: 'Ada Lovelace' }}
      />,
    )

    fireEvent.click(screen.getAllByRole('button', { name: /clear selection/i })[0])

    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('degrades to an empty roster when the optional staff module is unavailable', async () => {
    // fetchAssignableStaffMembers already converts the staff 404 into an empty page; a hard
    // rejection is the belt-and-braces case and must not surface as a broken control.
    fetchAssignableStaffMembers.mockRejectedValue(new Error('[internal] staff unavailable'))

    const { container } = render(<DealOwnerSelect value={null} onChange={() => {}} />)
    fireEvent.change(getInput(container), { target: { value: 'anyone' } })

    await waitFor(() => expect(fetchAssignableStaffMembers).toHaveBeenCalled())

    // The contract is "no candidates", not "something broke": no options are offered and
    // the control never enters LookupSelect's error/alert path.
    await waitFor(() => expect(screen.queryAllByRole('option')).toHaveLength(0))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(getInput(container).disabled).toBe(false)
  })
})

// LookupSelect ignores its `options` prop while searching, and a set `value` makes it search —
// so the seed has to be merged into the fetch result or an owner outside the roster renders as
// no selection at all (a departed user, or anyone when the optional `staff` module is off).
describe('DealOwnerSelect seed survives the roster fetch', () => {
  it('keeps the seeded owner listed when the roster does not contain them', async () => {
    fetchAssignableStaffMembers.mockResolvedValue([
      { teamMemberId: 'tm-2', userId: 'someone-else', displayName: 'Grace Hopper', email: 'grace@example.com', teamName: null },
    ])

    const { container } = render(
      <DealOwnerSelect
        value="departed-user"
        onChange={() => {}}
        initialOption={{ id: 'departed-user', name: 'Departed Person' }}
      />,
    )

    fireEvent.change(getInput(container), { target: { value: 'gra' } })
    await waitFor(() => expect(fetchAssignableStaffMembers).toHaveBeenCalled())

    await waitFor(() => expect(screen.getByText('Departed Person')).toBeTruthy())
    expect(screen.getByText('Grace Hopper')).toBeTruthy()
  })

  it('does not duplicate the seed when the roster already contains that user', async () => {
    fetchAssignableStaffMembers.mockResolvedValue([
      { teamMemberId: 'tm-1', userId: 'user-1', displayName: 'Ada Lovelace', email: 'ada@example.com', teamName: null },
    ])

    const { container } = render(
      <DealOwnerSelect
        value="user-1"
        onChange={() => {}}
        initialOption={{ id: 'user-1', name: 'Ada Lovelace' }}
      />,
    )

    fireEvent.change(getInput(container), { target: { value: 'ada' } })
    await waitFor(() => expect(fetchAssignableStaffMembers).toHaveBeenCalled())

    await waitFor(() => expect(screen.getAllByRole('option').length).toBe(1))
  })

  it('does not inject the seed when it no longer matches the selected value', async () => {
    fetchAssignableStaffMembers.mockResolvedValue([
      { teamMemberId: 'tm-2', userId: 'user-9', displayName: 'Grace Hopper', email: 'grace@example.com', teamName: null },
    ])

    const { container } = render(
      <DealOwnerSelect
        value="user-9"
        onChange={() => {}}
        initialOption={{ id: 'stale-seed', name: 'Stale Seed' }}
      />,
    )

    fireEvent.change(getInput(container), { target: { value: 'gra' } })
    await waitFor(() => expect(fetchAssignableStaffMembers).toHaveBeenCalled())

    await waitFor(() => expect(screen.getByText('Grace Hopper')).toBeTruthy())
    expect(screen.queryByText('Stale Seed')).toBeNull()
  })
})

/**
 * Regression guards for #6857. Three separate defects made the picker misreport who the owner
 * is: a name that is really an e-mail was printed twice, a placeholder label outlived the point
 * where the roster knew the real name, and the roster vanished from the list after a save.
 */
describe('DealOwnerSelect identity reporting (#6857)', () => {
  it('does not repeat the e-mail when the name falls back to it', async () => {
    // The deal detail route sends `name: owner.name ?? owner.email`, so a user without a name
    // arrives here with name === email.
    render(
      <DealOwnerSelect
        value="user-1"
        onChange={() => {}}
        initialOption={{ id: 'user-1', name: 'admin@acme.com', email: 'admin@acme.com' }}
      />,
    )

    expect(screen.getAllByText('admin@acme.com')).toHaveLength(1)
  })

  it('prefers the roster name over a placeholder seed once the roster has resolved', async () => {
    fetchAssignableStaffMembers.mockResolvedValue([
      { teamMemberId: 'tm-1', userId: 'user-1', displayName: 'Alex Chen', email: 'admin@acme.com', teamName: null },
    ])

    const { container } = render(
      <DealOwnerSelect
        value="user-1"
        onChange={() => {}}
        // What the create forms seed before the roster is known.
        initialOption={{ id: 'user-1', name: 'Current user' }}
      />,
    )

    fireEvent.change(getInput(container), { target: { value: 'ale' } })
    await waitFor(() => expect(screen.getByText('Alex Chen')).toBeTruthy())

    // Now search something the selected user does not match: the seed is re-injected so the
    // selection stays visible, and it must carry the resolved name, not the placeholder.
    fetchAssignableStaffMembers.mockResolvedValue([
      { teamMemberId: 'tm-2', userId: 'user-9', displayName: 'Priya Nair', email: 'employee@acme.com', teamName: null },
    ])
    fireEvent.change(getInput(container), { target: { value: 'employee' } })

    await waitFor(() => expect(screen.getByText('Priya Nair')).toBeTruthy())
    expect(screen.getByText('Alex Chen')).toBeTruthy()
    expect(screen.queryByText('Current user')).toBeNull()
  })

  it('keeps the resolved roster available to re-render from, so a save cannot collapse the list', async () => {
    // LookupSelect resets its list to `options` whenever it is not searching and does not
    // refetch on a plain re-render. If `options` only ever held the seed, the post-save
    // re-render left a single card until reload.
    const roster = [
      { teamMemberId: 'tm-1', userId: 'user-1', displayName: 'Alex Chen', email: 'admin@acme.com', teamName: null },
      { teamMemberId: 'tm-2', userId: 'user-9', displayName: 'Priya Nair', email: 'employee@acme.com', teamName: null },
    ]
    fetchAssignableStaffMembers.mockResolvedValue(roster)

    const { container, rerender } = render(
      <DealOwnerSelect value="user-1" onChange={() => {}} initialOption={{ id: 'user-1', name: 'Alex Chen' }} />,
    )

    // With a value set, LookupSelect searches immediately with an empty query — the unfiltered
    // fetch that teaches the picker the roster, exactly as on page load.
    await waitFor(() => expect(screen.getByText('Priya Nair')).toBeTruthy())

    // Reproduce the reset: LookupSelect stops searching when there is no value and no query,
    // and then replaces its list with whatever `options` holds. The post-save re-render on the
    // deal detail page goes through exactly this path.
    rerender(
      <DealOwnerSelect value={null} onChange={() => {}} initialOption={{ id: 'user-1', name: 'Alex Chen' }} />,
    )
    fireEvent.change(getInput(container), { target: { value: '' } })
    rerender(
      <DealOwnerSelect value="user-1" onChange={() => {}} initialOption={{ id: 'user-1', name: 'Alex Chen' }} />,
    )

    // The whole roster must still be offered, not just the seeded owner.
    await waitFor(() => expect(screen.getByText('Alex Chen')).toBeTruthy())
    expect(screen.getByText('Priya Nair')).toBeTruthy()
  })
})
