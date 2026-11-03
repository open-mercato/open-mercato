/**
 * @jest-environment jsdom
 */

/**
 * Regression coverage for #5669: the Demo Credentials card used to render a
 * hardcoded account list unconditionally, so an installation initialized with
 * `--no-examples` — or an organization the examples were never seeded into —
 * still advertised logins that do not exist. The card must now appear only for
 * accounts the admin endpoint reports as present in the caller's organization.
 */

import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { EXAMPLE_PORTAL_ACCOUNTS } from '@open-mercato/core/modules/customer_accounts/lib/exampleAccounts'

const mockApiCall = jest.fn()

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
}))

import { CustomerAccountsSettingsPageClient } from '../CustomerAccountsSettingsPageClient'

const [alice] = EXAMPLE_PORTAL_ACCOUNTS

function renderPage() {
  return render(<CustomerAccountsSettingsPageClient portalOrigin="https://portal.example.com" />)
}

describe('CustomerAccountsSettingsPageClient — demo credentials', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('hides the whole Demo Credentials card when no example accounts were seeded', async () => {
    mockApiCall.mockResolvedValue({ ok: true, result: { items: [] } })

    renderPage()

    await waitFor(() => expect(mockApiCall).toHaveBeenCalledWith('/api/customer_accounts/admin/demo-accounts'))
    await waitFor(() => expect(screen.getByText('Portal Access')).toBeInTheDocument())
    expect(screen.queryByText('Demo Credentials')).not.toBeInTheDocument()
    expect(screen.queryByText(alice.email)).not.toBeInTheDocument()
    expect(document.body.textContent).not.toContain(alice.password)
  })

  it('renders only the seeded accounts the endpoint reports, with their role names', async () => {
    mockApiCall.mockResolvedValue({
      ok: true,
      result: {
        items: [
          {
            email: alice.email,
            password: alice.password,
            roles: [{ id: 'role-1', name: 'Portal Admin', slug: 'portal_admin' }],
          },
        ],
      },
    })

    renderPage()

    expect(await screen.findByText('Demo Credentials')).toBeInTheDocument()
    expect(screen.getByText(alice.email)).toBeInTheDocument()
    expect(screen.getByText('Portal Admin')).toBeInTheDocument()
    for (const account of EXAMPLE_PORTAL_ACCOUNTS.filter((entry) => entry.email !== alice.email)) {
      expect(screen.queryByText(account.email)).not.toBeInTheDocument()
    }
  })

  it('falls back to a translated label when a seeded account has no role link', async () => {
    mockApiCall.mockResolvedValue({
      ok: true,
      result: { items: [{ email: alice.email, password: alice.password, roles: [] }] },
    })

    renderPage()

    expect(await screen.findByText('No role assigned')).toBeInTheDocument()
  })

  it('hides the card when the lookup fails rather than falling back to hardcoded credentials', async () => {
    mockApiCall.mockRejectedValue(new Error('network down'))

    renderPage()

    await waitFor(() => expect(screen.getByText('Portal Access')).toBeInTheDocument())
    expect(screen.queryByText('Demo Credentials')).not.toBeInTheDocument()
    expect(document.body.textContent).not.toContain(alice.password)
  })
})
