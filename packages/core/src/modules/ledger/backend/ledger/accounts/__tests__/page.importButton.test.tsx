/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'

// When the "Import default chart of accounts" action is offered (spec,
// Backend Pages; R3): only after both the accounts total and the
// account-types total answered zero, never for a chart with account types
// but no accounts, and never for a viewer without `ledger.accounts.manage`.

const apiCallMock = jest.fn()
let grantedFeatures: string[] = ['ledger.accounts.view', 'ledger.accounts.manage']

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
  withScopedApiRequestHeaders: (_headers: unknown, run: () => unknown) => run(),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({ runMutation: jest.fn(), retryLastMutation: jest.fn() }),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/BackendChromeProvider', () => ({
  useBackendChrome: () => ({ payload: { grantedFeatures } }),
}))

jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PageBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  DataTable: ({ actions, isLoading }: { actions?: React.ReactNode; isLoading?: boolean }) => (
    <div data-testid="accounts-table" data-loading={isLoading ? 'true' : 'false'}>
      {actions}
    </div>
  ),
}))

jest.mock('../../../lib/optionLoaders', () => ({
  loadLedgerAccountTypeLabelsByIds: jest.fn().mockResolvedValue({}),
}))

import LedgerAccountsPage from '../page'

const IMPORT_LABEL = 'Import default chart of accounts'

type Deferred = { promise: Promise<unknown>; resolve: (value: unknown) => void }
function deferred(): Deferred {
  let resolve!: (value: unknown) => void
  const promise = new Promise<unknown>((r) => { resolve = r })
  return { promise, resolve }
}

function totalsResponse(total: number) {
  return { ok: true, status: 200, result: { items: [], total, page: 1, totalPages: 1 } }
}

function mockTotals(accounts: number | Deferred, accountTypes: number | Deferred) {
  apiCallMock.mockImplementation(async (url: string) => {
    if (url.startsWith('/api/ledger/account-types')) {
      return typeof accountTypes === 'number' ? totalsResponse(accountTypes) : accountTypes.promise
    }
    if (url.startsWith('/api/ledger/accounts')) {
      return typeof accounts === 'number' ? totalsResponse(accounts) : accounts.promise
    }
    return { ok: false, status: 404, result: null }
  })
}

async function waitForAccountsLoaded() {
  await waitFor(() => expect(screen.getByTestId('accounts-table').getAttribute('data-loading')).toBe('false'))
}

describe('ledger accounts page: import default chart of accounts action', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    grantedFeatures = ['ledger.accounts.view', 'ledger.accounts.manage']
  })

  it('is offered when the chart has no accounts and no account types', async () => {
    mockTotals(0, 0)
    renderWithProviders(<LedgerAccountsPage />)
    expect(await screen.findByRole('button', { name: IMPORT_LABEL })).toBeInTheDocument()
    expect(apiCallMock).toHaveBeenCalledWith('/api/ledger/account-types?pageSize=1')
  })

  it('is not offered when account types exist but there are no accounts (R3)', async () => {
    mockTotals(0, 1)
    renderWithProviders(<LedgerAccountsPage />)
    await waitForAccountsLoaded()
    await waitFor(() => expect(apiCallMock).toHaveBeenCalledWith('/api/ledger/account-types?pageSize=1'))
    expect(screen.queryByRole('button', { name: IMPORT_LABEL })).not.toBeInTheDocument()
  })

  it('is not offered when the chart has accounts', async () => {
    mockTotals(3, 0)
    renderWithProviders(<LedgerAccountsPage />)
    await waitForAccountsLoaded()
    expect(screen.queryByRole('button', { name: IMPORT_LABEL })).not.toBeInTheDocument()
  })

  it('stays hidden until the account-types total has answered', async () => {
    const accountTypes = deferred()
    mockTotals(0, accountTypes)
    renderWithProviders(<LedgerAccountsPage />)
    await waitForAccountsLoaded()
    expect(screen.queryByRole('button', { name: IMPORT_LABEL })).not.toBeInTheDocument()

    accountTypes.resolve(totalsResponse(0))
    expect(await screen.findByRole('button', { name: IMPORT_LABEL })).toBeInTheDocument()
  })

  it('stays hidden when the account-types total cannot be read', async () => {
    apiCallMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/ledger/account-types')) return { ok: false, status: 500, result: null }
      return totalsResponse(0)
    })
    renderWithProviders(<LedgerAccountsPage />)
    await waitForAccountsLoaded()
    await waitFor(() => expect(apiCallMock).toHaveBeenCalledWith('/api/ledger/account-types?pageSize=1'))
    expect(screen.queryByRole('button', { name: IMPORT_LABEL })).not.toBeInTheDocument()
  })

  it('is never offered without ledger.accounts.manage', async () => {
    grantedFeatures = ['ledger.accounts.view']
    mockTotals(0, 0)
    renderWithProviders(<LedgerAccountsPage />)
    await waitForAccountsLoaded()
    expect(screen.queryByRole('button', { name: IMPORT_LABEL })).not.toBeInTheDocument()
  })
})
