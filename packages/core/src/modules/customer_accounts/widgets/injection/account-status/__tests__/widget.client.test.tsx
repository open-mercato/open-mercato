/**
 * @jest-environment jsdom
 *
 * Regression coverage for customer account invites rendered inside host forms:
 * the widget must avoid nested forms and route invitation writes through the
 * shared guarded mutation lifecycle.
 */
import * as React from 'react'
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import AccountStatusWidget from '../widget.client'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'

const flashMock = jest.fn()
const mockInvalidateQueries = jest.fn()
const mockRunMutation = jest.fn(
  async ({ operation }: { operation: () => Promise<unknown> }) => operation(),
)

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback: string) => fallback || _key,
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: (...args: unknown[]) => flashMock(...args),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: jest.fn(() => ({ runMutation: mockRunMutation })),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
}))

type MockQueryOptions = { queryKey: unknown[]; queryFn: () => Promise<unknown> }

const mockQueryData = new Map<string, unknown>()
const mockQueryCalls: MockQueryOptions[] = []

jest.mock('@tanstack/react-query', () => ({
  useQuery: (options: MockQueryOptions) => {
    mockQueryCalls.push(options)
    const key = String(options.queryKey[0])
    return { data: mockQueryData.get(key) ?? null, isLoading: false }
  },
  useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
}))

const mockApiCall = apiCall as jest.MockedFunction<typeof apiCall>

const personFixture = {
  person: {
    primaryEmail: 'buyer@example.test',
    displayName: 'Buyer Contact',
  },
  profile: {
    firstName: 'Buyer',
    lastName: 'Contact',
  },
}

describe('customer_accounts AccountStatusWidget invite form', () => {
  beforeEach(() => {
    flashMock.mockClear()
    mockInvalidateQueries.mockClear()
    mockRunMutation.mockClear()
    mockQueryData.clear()
    mockQueryCalls.length = 0
    mockQueryData.set('customer-account-person', personFixture)
    mockApiCall.mockReset()
    mockApiCall.mockImplementation(async (url: string, options?: RequestInit) => {
      if (typeof url === 'string' && url.includes('/api/customers/people/')) {
        return {
          ok: true,
          status: 200,
          result: {
            person: {
              primaryEmail: 'buyer@example.test',
              displayName: 'Buyer Contact',
            },
            profile: {
              firstName: 'Buyer',
              lastName: 'Contact',
            },
          },
        } as never
      }
      if (typeof url === 'string' && url.includes('/api/customer_accounts/admin/roles')) {
        return {
          ok: true,
          status: 200,
          result: { items: [{ id: 'role-1', name: 'Buyer' }] },
        } as never
      }
      if (
        typeof url === 'string'
        && url.includes('/api/customer_accounts/admin/users-invite')
        && options?.method === 'POST'
      ) {
        return { ok: true, status: 200, result: { ok: true } } as never
      }
      if (typeof url === 'string' && url.includes('/api/customer_accounts/admin/users-invite')) {
        return {
          ok: true,
          status: 200,
          result: {
            items: [{
              id: 'invitation-1',
              email: 'buyer@example.test',
              expiresAt: '2026-06-18T12:00:00.000Z',
            }],
            total: 1,
          },
        } as never
      }
      return { ok: false, status: 500, result: { error: 'unexpected call' } } as never
    })
  })

  async function openInviteForm() {
    render(<AccountStatusWidget context={{ recordId: 'person-entity-1' }} />)
    fireEvent.click(await screen.findByRole('button', { name: /invite to portal/i }))
    return screen.findByRole('button', { name: /send invitation/i })
  }

  it('routes the invitation POST through useGuardedMutation.runMutation', async () => {
    const submitButton = await openInviteForm()

    fireEvent.change(await screen.findByLabelText(/email/i), {
      target: { value: 'buyer@example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Buyer' }))
    fireEvent.click(submitButton)

    await waitFor(() => {
      expect(mockRunMutation).toHaveBeenCalledTimes(1)
    })

    const runArgs = mockRunMutation.mock.calls[0][0] as {
      context: { entityType: string }
      mutationPayload: Record<string, unknown>
    }
    expect(runArgs.context.entityType).toBe('customer_accounts:user')
    expect(runArgs.mutationPayload.personEntityId).toBe('person-entity-1')
    expect(runArgs.mutationPayload.customerEntityId).toBeUndefined()

    await waitFor(() => {
      const inviteCall = mockApiCall.mock.calls.find(
        ([url]) => typeof url === 'string' && url.includes('/api/customer_accounts/admin/users-invite'),
      )
      expect(inviteCall).toBeTruthy()
      expect((inviteCall?.[1] as RequestInit | undefined)?.method).toBe('POST')
    })
  })

  it('sends an invite from inside a parent CrudForm without submitting the parent form', async () => {
    const parentSubmit = jest.fn((event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault()
    })

    const { container } = render(
      <form onSubmit={parentSubmit}>
        <AccountStatusWidget context={{ recordId: 'person-entity-1' }} />
      </form>,
    )

    await screen.findByRole('button', { name: /invite to portal/i })
    expect(container.querySelectorAll('form')).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: /invite to portal/i }))

    await screen.findByDisplayValue('buyer@example.test')
    await screen.findByRole('button', { name: 'Buyer' })
    expect(container.querySelectorAll('form')).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'Buyer' }))

    const sendButton = screen.getByRole('button', { name: /send invitation/i })
    expect(sendButton).not.toBeDisabled()
    fireEvent.click(sendButton)

    await waitFor(() => expect(mockApiCall).toHaveBeenCalledWith(
      '/api/customer_accounts/admin/users-invite',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          email: 'buyer@example.test',
          roleIds: ['role-1'],
          displayName: 'Buyer Contact',
          personEntityId: 'person-entity-1',
        }),
      }),
    ))
    expect(parentSubmit).not.toHaveBeenCalled()
    expect(flashMock).toHaveBeenCalledWith('Invitation sent successfully', 'success')
  })

  // #4950: the portal user row only appears once the invite is accepted, so the
  // widget must read the pending invitation instead of reporting "no account".
  it('shows the pending invitation instead of the empty state once an invite exists', async () => {
    mockQueryData.set('customer-account-pending-invitation', {
      id: 'invitation-1',
      email: 'buyer@example.test',
      expiresAt: '2026-06-18T12:00:00.000Z',
    })

    render(<AccountStatusWidget context={{ recordId: 'person-entity-1' }} />)

    expect(await screen.findByText('Invitation pending')).toBeInTheDocument()
    expect(screen.getByText('buyer@example.test')).toBeInTheDocument()
    expect(screen.queryByText('No portal account linked')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /resend invitation/i })).toBeInTheDocument()
  })

  it('keeps the empty state when the person has neither an account nor a pending invitation', async () => {
    render(<AccountStatusWidget context={{ recordId: 'person-entity-1' }} />)

    expect(await screen.findByText('No portal account linked')).toBeInTheDocument()
    expect(screen.queryByText('Invitation pending')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /invite to portal/i })).toBeInTheDocument()
  })

  it('reads the pending invitation from the scoped admin invitations endpoint', async () => {
    render(<AccountStatusWidget context={{ recordId: 'person-entity-1' }} />)

    const invitationQuery = mockQueryCalls.find(
      (call) => call.queryKey[0] === 'customer-account-pending-invitation',
    )
    expect(invitationQuery).toBeTruthy()

    await invitationQuery!.queryFn()

    const listCall = mockApiCall.mock.calls.find(
      ([url]) => typeof url === 'string'
        && url.includes('/api/customer_accounts/admin/users-invite')
        && url.includes('personEntityId=person-entity-1'),
    )
    expect(listCall).toBeTruthy()
    expect(listCall?.[1]).toBeUndefined()
  })

  // #5499: an invitation created without a person link (portal invite, or a row
  // predating the entity-ownership guard) is only reachable by the recipient
  // address, so the widget must fall back to it before reporting "no account".
  it('falls back to the recipient email when no invitation carries the person link', async () => {
    mockApiCall.mockImplementation(async (url: string) => {
      if (typeof url === 'string' && url.includes('personEntityId=person-entity-1')) {
        return { ok: true, status: 200, result: { items: [], total: 0 } } as never
      }
      if (typeof url === 'string' && url.includes('email=buyer%40example.test')) {
        return {
          ok: true,
          status: 200,
          result: {
            items: [{
              id: 'invitation-orphan',
              email: 'buyer@example.test',
              expiresAt: '2026-06-18T12:00:00.000Z',
            }],
            total: 1,
          },
        } as never
      }
      return { ok: false, status: 500, result: { error: 'unexpected call' } } as never
    })

    render(<AccountStatusWidget context={{ recordId: 'person-entity-1' }} />)

    const invitationQuery = mockQueryCalls.find(
      (call) => call.queryKey[0] === 'customer-account-pending-invitation',
    )
    expect(invitationQuery).toBeTruthy()
    expect(invitationQuery!.queryKey).toContain('buyer@example.test')

    await expect(invitationQuery!.queryFn()).resolves.toMatchObject({ id: 'invitation-orphan' })
  })

  it('does not query invitations by email when the person has no primary email', async () => {
    mockQueryData.set('customer-account-person', { person: { primaryEmail: null }, profile: null })
    mockApiCall.mockImplementation(async () => (
      { ok: true, status: 200, result: { items: [], total: 0 } } as never
    ))

    render(<AccountStatusWidget context={{ recordId: 'person-entity-1' }} />)

    const invitationQuery = mockQueryCalls.find(
      (call) => call.queryKey[0] === 'customer-account-pending-invitation',
    )
    await expect(invitationQuery!.queryFn()).resolves.toBeNull()

    const emailCall = mockApiCall.mock.calls.find(
      ([url]) => typeof url === 'string' && url.includes('email='),
    )
    expect(emailCall).toBeFalsy()
  })
})
