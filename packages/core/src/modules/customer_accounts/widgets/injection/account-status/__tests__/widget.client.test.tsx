/**
 * @jest-environment jsdom
 *
 * Regression coverage for #3195 — the account-status invite form must route its
 * invitation POST through `useGuardedMutation.runMutation` so the shared mutation
 * injection lifecycle (record locks, conflict UI, global write guards) runs,
 * instead of calling `apiCall` directly.
 */
import * as React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import AccountStatusWidget from '../widget.client'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'

const mockRunMutation = jest.fn(
  async ({ operation }: { operation: () => Promise<unknown> }) => operation(),
)

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback: string) => fallback || _key,
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: jest.fn(() => ({ runMutation: mockRunMutation })),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
}))

jest.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: null, isLoading: false }),
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}))

const mockApiCall = apiCall as jest.MockedFunction<typeof apiCall>

describe('customer_accounts AccountStatusWidget invite form (#3195)', () => {
  beforeEach(() => {
    mockRunMutation.mockClear()
    mockApiCall.mockReset()
    mockApiCall.mockImplementation(async (url: string) => {
      if (typeof url === 'string' && url.includes('/api/customers/people/')) {
        return { ok: true, status: 200, result: { person: null, profile: null } } as never
      }
      if (typeof url === 'string' && url.includes('/api/customer_accounts/admin/roles')) {
        return {
          ok: true,
          status: 200,
          result: { items: [{ id: 'role-1', name: 'Buyer' }] },
        } as never
      }
      // users-invite POST
      return { ok: true, status: 200, result: { ok: true } } as never
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
    expect(runArgs.mutationPayload.customerEntityId).toBe('person-entity-1')

    await waitFor(() => {
      const inviteCall = mockApiCall.mock.calls.find(
        ([url]) => typeof url === 'string' && url.includes('/api/customer_accounts/admin/users-invite'),
      )
      expect(inviteCall).toBeTruthy()
      expect((inviteCall?.[1] as RequestInit | undefined)?.method).toBe('POST')
    })
  })
})
