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

jest.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: null, isLoading: false }),
  useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
}))

const mockApiCall = apiCall as jest.MockedFunction<typeof apiCall>

describe('customer_accounts AccountStatusWidget invite form', () => {
  beforeEach(() => {
    flashMock.mockClear()
    mockInvalidateQueries.mockClear()
    mockRunMutation.mockClear()
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
})
