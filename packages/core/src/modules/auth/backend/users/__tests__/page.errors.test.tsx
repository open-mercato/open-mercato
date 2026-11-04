/** @jest-environment jsdom */
import * as React from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { QueryClient } from '@tanstack/react-query'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'

jest.mock('next/navigation', () => ({
  useSearchParams: () => ({ getAll: () => [] }),
}))

jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PageBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  DataTable: ({ data, error, isLoading, emptyState, onSearchChange }: {
    data: Array<{ id: string; email: string }>
    error?: React.ReactNode
    isLoading: boolean
    emptyState?: React.ReactNode
    onSearchChange: (value: string) => void
  }) => (
    <div>
      <input aria-label="Search users" onChange={(event) => onSearchChange(event.target.value)} />
      {isLoading ? <div role="status">Loading</div> : error || (
        data.length ? data.map((row) => <div key={row.id}>{row.email}</div>) : emptyState
      )}
    </div>
  ),
}))

jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: jest.fn(), ConfirmDialogElement: null }),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
  withScopedApiRequestHeaders: (_headers: unknown, run: () => unknown) => run(),
}))

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeVersion: jest.fn(),
}))

import UsersListPage from '../page'

const dictionary = {
  'auth.users.list.error.load': 'Nie udało się wczytać użytkowników',
  'auth.users.list.actions.retry': 'Spróbuj ponownie',
}

function usersResult(email: string) {
  return {
    ok: true,
    status: 200,
    result: {
      items: [{ id: email, email, name: email, roles: [], organizationId: 'org', tenantId: 'tenant' }],
      total: 1,
      totalPages: 1,
    },
  }
}

function deferredUsersResult() {
  let resolve: (value: ReturnType<typeof usersResult>) => void = () => {}
  const promise = new Promise<ReturnType<typeof usersResult>>((settle) => { resolve = settle })
  return { promise, resolve }
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return { ...renderWithProviders(<UsersListPage />, { locale: 'pl', dict: dictionary, queryClient }), queryClient }
}

describe('Users list query error recovery', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.mocked(useOrganizationScopeVersion).mockReturnValue(1)
  })

  it('keeps a localized error visible while retrying the unchanged search query, then shows recovered data', async () => {
    const recovered = deferredUsersResult()
    const usersRequest = jest.fn()
      .mockResolvedValueOnce(usersResult('initial@example.com'))
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockImplementationOnce(() => recovered.promise)
    jest.mocked(apiCall).mockImplementation((url) => (
      String(url).startsWith('/api/auth/users?')
        ? usersRequest(url)
        : Promise.resolve({ ok: true, status: 200, result: { items: [] } })
    ))
    const { queryClient } = renderPage()
    await screen.findByText('initial@example.com')
    fireEvent.change(screen.getByRole('textbox', { name: 'Search users' }), { target: { value: 'recovered' } })
    expect(await screen.findByRole('alert')).toHaveTextContent(dictionary['auth.users.list.error.load'])
    expect(screen.queryByText('initial@example.com')).not.toBeInTheDocument()
    expect(screen.queryByText('No Users yet')).not.toBeInTheDocument()
    const retry = screen.getByRole('button', { name: dictionary['auth.users.list.actions.retry'] })
    fireEvent.click(retry)
    await waitFor(() => expect(retry).toBeDisabled())
    expect(screen.getByRole('alert')).toHaveTextContent(dictionary['auth.users.list.error.load'])
    expect(usersRequest).toHaveBeenCalledTimes(3)
    const failedUrl = usersRequest.mock.calls[1][0]
    expect(new URL(failedUrl, 'http://localhost').searchParams.get('search')).toBe('recovered')
    expect(usersRequest.mock.calls[2][0]).toBe(failedUrl)
    await act(async () => { recovered.resolve(usersResult('recovered@example.com')) })
    await screen.findByText('recovered@example.com')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    queryClient.clear()
  })

  it('does not show previous-scope rows when a new organization or tenant scope fails and recovers', async () => {
    const recovered = deferredUsersResult()
    const usersRequest = jest.fn()
      .mockResolvedValueOnce(usersResult('previous-scope@example.com'))
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockImplementationOnce(() => recovered.promise)
    jest.mocked(apiCall).mockImplementation((url) => (
      String(url).startsWith('/api/auth/users?')
        ? usersRequest(url)
        : Promise.resolve({ ok: true, status: 200, result: { items: [] } })
    ))
    const { rerender, queryClient } = renderPage()
    await screen.findByText('previous-scope@example.com')
    jest.mocked(useOrganizationScopeVersion).mockReturnValue(2)
    rerender(<UsersListPage />)
    expect(screen.queryByText('previous-scope@example.com')).not.toBeInTheDocument()
    await screen.findByRole('alert')
    expect(screen.queryByText('previous-scope@example.com')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: dictionary['auth.users.list.actions.retry'] }))
    await waitFor(() => expect(usersRequest).toHaveBeenCalledTimes(3))
    expect(usersRequest.mock.calls[2][0]).toBe(usersRequest.mock.calls[1][0])
    expect(screen.queryByText('previous-scope@example.com')).not.toBeInTheDocument()
    await act(async () => { recovered.resolve(usersResult('current-scope@example.com')) })
    await screen.findByText('current-scope@example.com')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText('previous-scope@example.com')).not.toBeInTheDocument()
    queryClient.clear()
  })

  it('replaces cached rows with an HTTP error and clears it after a successful empty recovery', async () => {
    const usersRequest = jest.fn()
      .mockResolvedValueOnce(usersResult('cached@example.com'))
      .mockResolvedValueOnce({ ok: false, status: 503, response: new Response(null, { status: 503 }) })
      .mockResolvedValueOnce({ ok: true, status: 200, result: { items: [], total: 0, totalPages: 1 } })
    jest.mocked(apiCall).mockImplementation((url) => (
      String(url).startsWith('/api/auth/users?')
        ? usersRequest(url)
        : Promise.resolve({ ok: true, status: 200, result: { items: [] } })
    ))
    const { queryClient } = renderPage()
    await screen.findByText('cached@example.com')
    await act(async () => { await queryClient.invalidateQueries({ queryKey: ['users'] }) })
    expect(await screen.findByRole('alert')).toHaveTextContent(dictionary['auth.users.list.error.load'])
    expect(screen.queryByText('cached@example.com')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: dictionary['auth.users.list.actions.retry'] }))
    await screen.findByText('No Users yet')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(usersRequest.mock.calls[2][0]).toBe(usersRequest.mock.calls[1][0])
    queryClient.clear()
  })

})
