/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, fireEvent, screen, within } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { PeopleField, type PeopleFieldAvailability } from '../PeopleField'
import { searchPeopleOptions } from '../lookups'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import type { EditorParticipant } from '../../../../lib/calendar/editorPayload'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  ...jest.requireActual('@open-mercato/ui/backend/utils/apiCall'),
  apiCall: jest.fn(),
}))

jest.mock('../lookups', () => ({
  searchPeopleOptions: jest.fn().mockResolvedValue([]),
}))

function renderField(value: EditorParticipant[], onChange: jest.Mock, mode: 'multi' | 'single' = 'multi') {
  return renderWithProviders(
    <PeopleField
      mode={mode}
      placeholder="Add people…"
      ariaLabel="Participants"
      value={value}
      onChange={onChange}
      includeCustomers
    />,
  )
}

async function typeQuery(text: string) {
  const input = screen.getByRole('combobox')
  await act(async () => {
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: text } })
  })
}

describe('PeopleField', () => {
  it('removes the clicked guest chip by position when multiple guests have no userId', async () => {
    const guestOne: EditorParticipant = { name: 'Guest One', email: 'guest-one@example.org', isCustomer: false }
    const guestTwo: EditorParticipant = { name: 'Guest Two', email: 'guest-two@example.org', isCustomer: false }
    const onChange = jest.fn()

    await act(async () => {
      renderField([guestOne, guestTwo], onChange)
    })

    const removeButtons = screen.getAllByRole('button', { name: /Remove/ })
    expect(removeButtons).toHaveLength(2)

    await act(async () => {
      fireEvent.click(removeButtons[1])
    })

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith([guestOne])
  })

  it('offers an unmatched typed email as a guest and adds it without a userId', async () => {
    const onChange = jest.fn()
    await act(async () => {
      renderField([], onChange)
    })

    await typeQuery(' Guest@Example.ORG ')

    const guestOption = await screen.findByRole('option', { name: /guest@example\.org/i })
    await act(async () => {
      fireEvent.click(guestOption)
    })

    expect(onChange).toHaveBeenCalledWith([
      { name: 'guest@example.org', email: 'guest@example.org', isCustomer: false },
    ])
  })

  it('does not offer a guest for a query that is not a valid email', async () => {
    const onChange = jest.fn()
    await act(async () => {
      renderField([], onChange)
    })

    await typeQuery('not-an-email')

    expect(screen.queryByRole('option')).toBeNull()
    expect(await screen.findByText('No results')).toBeInTheDocument()
  })

  it('does not offer a guest already present as a participant', async () => {
    const onChange = jest.fn()
    const guest: EditorParticipant = { name: 'Guest', email: 'guest@example.org', isCustomer: false }
    await act(async () => {
      renderField([guest], onChange)
    })

    await typeQuery('GUEST@example.org')

    expect(screen.queryByRole('option')).toBeNull()
  })

  it('never offers a guest in single mode — the assignee must be a real staff user', async () => {
    const onChange = jest.fn()
    await act(async () => {
      renderField([], onChange, 'single')
    })

    await typeQuery('guest@example.org')

    expect(screen.queryByRole('option')).toBeNull()
  })
})

describe('PeopleField staff availability', () => {
  const staffIds = {
    leave: 'e8f004ea-6dbc-4a16-bdd0-4ed6f140b073',
    free: 'dbe42a61-a61a-4abc-b351-ab69fb50cb31',
    pending: '4d84f3dd-a76c-4068-a267-10bcb3ec5826',
    unknown: '415cff76-0629-47f4-9cb3-a12a075bbfb3',
    customer: '1d922dcb-451e-472c-aad5-5d989b7b1f90',
  }
  const organizationId = 'bfc0cb9e-3ebc-4820-8105-f413bd49c3fe'
  const mockPeople = jest.mocked(searchPeopleOptions)
  const mockApi = jest.mocked(apiCall)
  const staffOption = (userId: string, name: string) => ({ userId, name, email: null, isCustomer: false })
  const slot = (day: string): PeopleFieldAvailability => ({
    organizationId,
    range: { from: new Date(`${day}T08:00:00Z`), to: new Date(`${day}T09:00:00Z`) },
  })
  const field = (staffAvailability: PeopleFieldAvailability, onChange: jest.Mock) => (
    <PeopleField
      mode="multi"
      placeholder="Add people…"
      ariaLabel="Participants"
      value={[]}
      onChange={onChange}
      staffAvailability={staffAvailability}
      includeCustomers
    />
  )

  beforeEach(() => {
    mockPeople.mockResolvedValue([
      staffOption(staffIds.leave, 'Robin Leave'),
      staffOption(staffIds.free, 'Morgan Free'),
      staffOption(staffIds.pending, 'Alex Pending'),
      staffOption(staffIds.unknown, 'Casey Unknown'),
      { userId: staffIds.customer, name: 'Taylor Customer', email: null, isCustomer: true },
    ])
    mockApi.mockReset()
  })

  it('shows only known staff statuses and drops old hints while checking a changed span', async () => {
    const start = '2026-07-14T00:00:00Z'
    const end = '2026-07-15T00:00:00Z'
    mockApi.mockResolvedValueOnce({
      ok: true,
      status: 200,
      result: {
        items: [
          { organizationId, userId: staffIds.leave, windows: [{ start, end, kind: 'tentative' }, { start, end, kind: 'leave' }] },
          { organizationId, userId: staffIds.free, windows: [] },
          { organizationId, userId: staffIds.pending, windows: [{ start, end, kind: 'tentative' }] },
        ],
      },
    } as Awaited<ReturnType<typeof apiCall>>)
    mockApi.mockResolvedValue({
      ok: false, status: 404, result: null,
    } as Awaited<ReturnType<typeof apiCall>>)
    const onChange = jest.fn()
    const { rerender } = renderWithProviders(field(slot('2026-07-14'), onChange))
    await typeQuery('')

    expect(await screen.findByRole('option', { name: 'Robin Leave, On leave' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Morgan Free, Available' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Alex Pending, Pending leave' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Casey Unknown' })).toBeInTheDocument()
    expect(within(screen.getByRole('option', { name: 'Taylor Customer, Customer' })).queryByText('Available')).not.toBeInTheDocument()
    const firstRequest = new URL(String(mockApi.mock.calls[0]?.[0]), 'http://localhost')
    expect(firstRequest.searchParams.get('userIds')?.split(',')).not.toContain(staffIds.customer)

    rerender(field(slot('2026-07-15'), onChange))
    expect(screen.queryByText('On leave')).not.toBeInTheDocument()
    expect(screen.queryByText('Available')).not.toBeInTheDocument()
    await act(async () => {
      fireEvent.click(screen.getByRole('option', { name: 'Robin Leave' }))
    })
    expect(onChange).toHaveBeenCalledWith([{ userId: staffIds.leave, name: 'Robin Leave', email: undefined, isCustomer: false }])
  })
})
