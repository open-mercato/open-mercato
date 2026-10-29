/**
 * @jest-environment jsdom
 *
 * Regression coverage for customer account invites rendered inside host forms:
 * the widget must avoid nested forms and route invitation writes through the
 * shared guarded mutation lifecycle.
 */
import * as React from 'react'
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import AccountStatusWidget from '../widget.client'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'

let mockGrantedFeatures = ['customer_accounts.invite']
let mockChromeReady = true

const flashMock = jest.fn()
const mockInvalidateQueries = jest.fn()
const mockRunMutation = jest.fn(
  async ({ operation }: { operation: () => Promise<unknown>; context: { entityType: string }; mutationPayload: Record<string, unknown> }) => operation(),
)
const mockRetryLastMutation = jest.fn(async () => true)

jest.mock('@open-mercato/ui/backend/BackendChromeProvider', () => ({
  useBackendChrome: () => ({ payload: { grantedFeatures: mockGrantedFeatures }, isReady: mockChromeReady }),
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback: string, values?: Record<string, string>) => {
    let text = fallback || _key
    for (const [name, value] of Object.entries(values ?? {})) {
      text = text.replace(`{${name}}`, value)
    }
    return text
  },
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: (...args: unknown[]) => flashMock(...args),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: jest.fn(() => ({ runMutation: mockRunMutation, retryLastMutation: mockRetryLastMutation })),
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
    mockGrantedFeatures = ['customer_accounts.invite']
    mockChromeReady = true
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
      configurable: true,
      value(this: HTMLDialogElement) { this.setAttribute('open', '') },
    })
    Object.defineProperty(HTMLDialogElement.prototype, 'close', {
      configurable: true,
      value(this: HTMLDialogElement) { this.removeAttribute('open') },
    })
    flashMock.mockClear()
    mockInvalidateQueries.mockReset()
    mockRunMutation.mockClear()
    mockQueryData.clear()
    mockQueryCalls.length = 0
    mockQueryData.set('customer-account-person', personFixture)
    mockApiCall.mockReset()
    mockApiCall.mockImplementation(async (url, options) => {
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

    const runArgs = mockRunMutation.mock.calls[0][0]
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
    mockApiCall.mockImplementation(async (url) => {
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

  function renderPendingInvitation() {
    mockQueryData.set('customer-account-pending-invitation', {
      id: 'invitation-1',
      email: 'buyer@example.test',
      expiresAt: '2026-06-18T12:00:00.000Z',
    })
    return render(<AccountStatusWidget context={{ recordId: 'person-entity-1' }} />)
  }

  it.each(['customer_accounts.invite', 'customer_accounts.*', '*'])('shows Cancel for the effective grant %s', (feature) => {
    mockGrantedFeatures = [feature]
    renderPendingInvitation()
    expect(screen.getByRole('button', { name: 'Cancel invitation' })).toBeInTheDocument()
  })

  it.each([{ features: [] }, { features: ['customer_accounts.view'] }, { features: ['customer_accounts.invite.other'] }])('keeps pending details but hides Cancel without invite permission: $features', ({ features }) => {
    mockGrantedFeatures = features
    renderPendingInvitation()
    expect(screen.getByText('Invitation pending')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel invitation' })).not.toBeInTheDocument()
    expect(mockRunMutation).not.toHaveBeenCalled()
  })

  it('keeps pending details but hides Cancel until effective capabilities are ready', () => {
    mockChromeReady = false
    renderPendingInvitation()
    expect(screen.getByText('Invitation pending')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel invitation' })).not.toBeInTheDocument()
  })

  it('names the recipient in cancellation confirmation and dismisses with Escape without a mutation', async () => {
    renderPendingInvitation()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel invitation' }))

    const dialog = await screen.findByRole('alertdialog', { name: 'Cancel invitation?' })
    expect(within(dialog).getByText('Cancel the invitation for buyer@example.test? The invitation link will stop working.')).toBeInTheDocument()
    fireEvent.keyDown(dialog, { key: 'Escape' })

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(mockRunMutation).not.toHaveBeenCalled()
    expect(mockApiCall).not.toHaveBeenCalled()
    expect(screen.getByText('Invitation pending')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel invitation' })).not.toBeDisabled())
  })

  it.each(['ctrlKey', 'metaKey'] as const)('confirms cancellation with %s+Enter, blocks duplicate actions, and refreshes the pending state', async (modifier) => {
    let resolveDelete!: (value: Awaited<ReturnType<typeof apiCall>>) => void
    const deleteResult = new Promise<Awaited<ReturnType<typeof apiCall>>>((resolve) => { resolveDelete = resolve })
    mockApiCall.mockImplementation(() => deleteResult)
    mockInvalidateQueries.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === 'customer-account-pending-invitation') {
        mockQueryData.delete('customer-account-pending-invitation')
      }
      return Promise.resolve()
    })
    renderPendingInvitation()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel invitation' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Cancel invitation?' })
    fireEvent.keyDown(dialog, { key: 'Enter', [modifier]: true })

    await waitFor(() => expect(mockApiCall).toHaveBeenCalledWith(
      '/api/customer_accounts/admin/users-invite?id=invitation-1',
      { method: 'DELETE' },
    ))
    expect(screen.getByRole('button', { name: 'Resend invitation' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel invitation' })).toBeDisabled()
    expect(mockRunMutation).toHaveBeenCalledWith(expect.objectContaining({
      context: {
        entityType: 'customer_accounts:customer_user_invitation',
        invitationId: 'invitation-1',
        retryLastMutation: mockRetryLastMutation,
      },
      mutationPayload: { id: 'invitation-1' },
    }))

    await act(async () => { resolveDelete({ ok: true, status: 200, result: { ok: true } } as never) })

    await screen.findByText('No portal account linked')
    expect(screen.queryByText('Invitation pending')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel invitation' })).not.toBeInTheDocument()
    expect(flashMock).toHaveBeenCalledWith('Invitation cancelled', 'success')
    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['customer-account-status', 'person-entity-1'] })
  })

  it('keeps a failed cancellation visible and allows retry', async () => {
    mockApiCall.mockResolvedValueOnce({
      ok: false,
      status: 500,
      result: { error: 'unavailable' },
      response: new Response(JSON.stringify({ error: 'unavailable' }), { status: 500 }),
    } as never)
    mockApiCall.mockResolvedValueOnce({ ok: true, status: 200, result: { ok: true } } as never)
    renderPendingInvitation()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel invitation' }))
    let dialog = await screen.findByRole('alertdialog', { name: 'Cancel invitation?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel invitation' }))

    await waitFor(() => expect(flashMock).toHaveBeenCalledWith('Failed to cancel invitation', 'error'))
    expect(screen.getByText('Invitation pending')).toBeInTheDocument()
    expect(mockInvalidateQueries).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Cancel invitation' })).not.toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel invitation' }))
    dialog = await screen.findByRole('alertdialog', { name: 'Cancel invitation?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel invitation' }))

    await waitFor(() => expect(flashMock).toHaveBeenCalledWith('Invitation cancelled', 'success'))
    expect(mockApiCall).toHaveBeenCalledTimes(2)
  })

  it('preserves a cancellation conflict response for guarded mutation conflict handling', async () => {
    const conflict = {
      error: 'The invitation changed. Reload and try again.',
      code: 'optimistic_lock_conflict',
      entityId: 'customer_accounts:customer_user_invitation',
      recordId: 'invitation-1',
      actualUpdatedAt: '2026-10-29T15:00:00.000Z',
    }
    mockApiCall.mockResolvedValueOnce({
      ok: false,
      status: 409,
      result: conflict,
      response: new Response(JSON.stringify(conflict), { status: 409 }),
    } as never)
    renderPendingInvitation()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel invitation' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Cancel invitation?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel invitation' }))

    await waitFor(() => expect(mockRunMutation).toHaveBeenCalledTimes(1))
    await expect(mockRunMutation.mock.results[0].value).rejects.toMatchObject({
      ...conflict,
      status: 409,
      raw: JSON.stringify(conflict),
    })
    expect(mockInvalidateQueries).not.toHaveBeenCalled()
    expect(flashMock).not.toHaveBeenCalledWith('Invitation cancelled', 'success')
    expect(screen.getByText('Invitation pending')).toBeInTheDocument()
  })
})
