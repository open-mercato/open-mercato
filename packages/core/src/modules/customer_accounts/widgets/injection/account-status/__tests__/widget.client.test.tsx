/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const apiCallMock = jest.fn()
const flashMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback: string) => fallback || _key,
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: (...args: unknown[]) => flashMock(...args),
}))

import AccountStatusWidget from '../widget.client'

function renderWithQueryClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      {ui}
    </QueryClientProvider>,
  )
}

describe('customer account status widget', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    apiCallMock.mockImplementation((url: string, options?: RequestInit) => {
      if (url.startsWith('/api/customer_accounts/admin/users?')) {
        return Promise.resolve({ ok: true, result: { items: [] } })
      }
      if (url === '/api/customers/people/person-1') {
        return Promise.resolve({
          ok: true,
          result: {
            person: { primaryEmail: 'buyer@example.test', displayName: 'Buyer Contact' },
            profile: { firstName: 'Buyer', lastName: 'Contact' },
          },
        })
      }
      if (url === '/api/customer_accounts/admin/roles?pageSize=100') {
        return Promise.resolve({
          ok: true,
          result: { items: [{ id: '00000000-0000-4000-8000-000000000001', name: 'Viewer' }] },
        })
      }
      if (url === '/api/customer_accounts/admin/users-invite' && options?.method === 'POST') {
        return Promise.resolve({ ok: true, result: { ok: true } })
      }
      return Promise.resolve({ ok: false, result: { error: 'unexpected call' } })
    })
  })

  it('sends an invite from inside a parent CrudForm without submitting the parent form', async () => {
    const parentSubmit = jest.fn((event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault()
    })

    const { container } = renderWithQueryClient(
      <form onSubmit={parentSubmit}>
        <AccountStatusWidget context={{ recordId: 'person-1' }} />
      </form>,
    )

    await screen.findByRole('button', { name: 'Invite to Portal' })
    expect(container.querySelectorAll('form')).toHaveLength(1)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Invite to Portal' }))
    })

    await screen.findByDisplayValue('buyer@example.test')
    await screen.findByRole('button', { name: 'Viewer' })
    expect(container.querySelectorAll('form')).toHaveLength(1)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Viewer' }))
    })

    const sendButton = screen.getByRole('button', { name: 'Send Invitation' })
    expect(sendButton).not.toBeDisabled()

    await act(async () => {
      fireEvent.click(sendButton)
    })

    await waitFor(() => expect(apiCallMock).toHaveBeenCalledWith(
      '/api/customer_accounts/admin/users-invite',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          email: 'buyer@example.test',
          roleIds: ['00000000-0000-4000-8000-000000000001'],
          displayName: 'Buyer Contact',
          customerEntityId: 'person-1',
        }),
      }),
    ))
    expect(parentSubmit).not.toHaveBeenCalled()
    expect(flashMock).toHaveBeenCalledWith('Invitation sent successfully', 'success')
  })
})
