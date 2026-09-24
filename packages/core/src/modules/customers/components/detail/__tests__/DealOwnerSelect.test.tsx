/** @jest-environment jsdom */

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
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
    expect(fetchAssignableStaffMembers.mock.calls[0][1]).toMatchObject({ pageSize: 20 })
    await waitFor(() => expect(screen.getByText('Grace Hopper')).toBeTruthy())
  })

  it('renders no clear affordance, so the owner cannot be emptied from the UI', () => {
    render(
      <DealOwnerSelect
        value="user-1"
        onChange={() => {}}
        initialOption={{ id: 'user-1', name: 'Ada Lovelace' }}
      />,
    )

    expect(screen.queryByRole('button', { name: /clear selection/i })).toBeNull()
  })

  it('never emits a null owner even if every rendered control is clicked', () => {
    const onChange = jest.fn()
    render(
      <DealOwnerSelect
        value="user-1"
        onChange={onChange}
        initialOption={{ id: 'user-1', name: 'Ada Lovelace' }}
      />,
    )

    for (const button of screen.queryAllByRole('button')) fireEvent.click(button)

    expect(onChange).not.toHaveBeenCalledWith(null)
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
