/**
 * @jest-environment jsdom
 */

/**
 * Regression coverage for #5669: the Customer Portal banner printed a fixed
 * `Demo credentials: …` line on every render, regardless of whether those
 * accounts existed in the organization being viewed. The line must now appear
 * only for accounts the admin endpoint reports as seeded in the caller's scope.
 */

import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { EXAMPLE_PORTAL_ACCOUNTS } from '@open-mercato/core/modules/customer_accounts/lib/exampleAccounts'

const mockApiCall = jest.fn()
const mockReadApiResultOrThrow = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string, params?: Record<string, string>) => {
    const template = fallback ?? key
    if (!params) return template
    return Object.entries(params).reduce(
      (acc, [name, value]) => acc.replaceAll(`{${name}}`, value),
      template,
    )
  },
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => mockApiCall(...args),
  readApiResultOrThrow: (...args: unknown[]) => mockReadApiResultOrThrow(...args),
  withScopedApiRequestHeaders: async (_headers: unknown, operation: () => Promise<unknown>) => operation(),
}))

jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  DataTable: () => <div data-testid="data-table" />,
}))

jest.mock('@open-mercato/ui/backend/RowActions', () => ({
  RowActions: () => <div />,
}))

jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: jest.fn(), ConfirmDialogElement: null }),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({ runMutation: jest.fn(), retryLastMutation: jest.fn() }),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

import { PortalUsersPageClient } from '../PortalUsersPageClient'

const [alice] = EXAMPLE_PORTAL_ACCOUNTS

function mockDemoAccounts(items: Array<{ email: string; password: string; roles: [] }>) {
  mockApiCall.mockImplementation(async (url: string) => {
    if (url === '/api/customer_accounts/admin/demo-accounts') {
      return { ok: true, result: { items } }
    }
    return { ok: true, result: { items: [] } }
  })
}

describe('PortalUsersPageClient — demo credentials banner', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockReadApiResultOrThrow.mockResolvedValue({ items: [], total: 0, totalPages: 1 })
  })

  it('omits the credentials line when no example accounts were seeded', async () => {
    mockDemoAccounts([])

    render(<PortalUsersPageClient portalOrigin="https://portal.example.com" />)

    await waitFor(() => expect(screen.getByText('Customer Portal')).toBeInTheDocument())
    await waitFor(() =>
      expect(mockApiCall).toHaveBeenCalledWith('/api/customer_accounts/admin/demo-accounts'),
    )
    expect(document.body.textContent).not.toContain(alice.email)
    expect(document.body.textContent).not.toContain(alice.password)
    expect(document.body.textContent).not.toContain('demo credentials')
  })

  it('shows the credentials line for a seeded account', async () => {
    mockDemoAccounts([{ email: alice.email, password: alice.password, roles: [] }])

    render(<PortalUsersPageClient portalOrigin="https://portal.example.com" />)

    expect(
      await screen.findByText(`Seeded demo credentials: ${alice.email} / ${alice.password}`),
    ).toBeInTheDocument()
  })
})
