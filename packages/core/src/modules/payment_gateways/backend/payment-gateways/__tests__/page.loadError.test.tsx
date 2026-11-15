/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import PaymentGatewaysPage from '../page'

const mockApiCall = jest.fn()
const mockFlash = jest.fn()
const mockTranslate = (_key: string, fallback?: string) => fallback ?? _key

const LOAD_ERROR = 'Failed to load payment transactions'

jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => mockTranslate,
}))

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeVersion: () => 0,
}))

jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PageHeader: () => null,
  PageBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  DataTable: (props: { data?: Array<Record<string, unknown>>; error?: React.ReactNode; isLoading?: boolean }) => (
    <div data-testid="transactions-table" data-loading={String(Boolean(props.isLoading))}>
      {props.error ? <div data-testid="table-error">{props.error}</div> : null}
      <div data-testid="row-count">{(props.data ?? []).length}</div>
    </div>
  ),
}))

jest.mock('@open-mercato/ui/backend/injection/InjectionSpot', () => ({
  InjectionSpot: () => null,
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: async ({ operation }: { operation: () => Promise<unknown> }) => operation(),
    retryLastMutation: async () => false,
  }),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: (...args: unknown[]) => mockFlash(...args),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => mockApiCall(...args),
  apiCallOrThrow: jest.fn(),
}))

async function waitForLoaded() {
  await waitFor(() => expect(screen.getByTestId('transactions-table').getAttribute('data-loading')).toBe('false'))
}

describe('payment gateways transactions page load errors', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('passes the load error to the table instead of showing an empty list', async () => {
    mockApiCall.mockResolvedValue({ ok: false, status: 500, result: null })

    render(<PaymentGatewaysPage />)
    await waitForLoaded()

    expect(screen.getByTestId('table-error').textContent).toBe(LOAD_ERROR)
    expect(screen.getByTestId('row-count').textContent).toBe('0')
    expect(mockFlash).toHaveBeenCalledWith(LOAD_ERROR, 'error')
  })

  it('renders no table error when the list loads', async () => {
    mockApiCall.mockResolvedValue({
      ok: true,
      status: 200,
      result: { items: [], total: 0, page: 1, pageSize: 20, totalPages: 1 },
    })

    render(<PaymentGatewaysPage />)
    await waitForLoaded()

    expect(screen.queryByTestId('table-error')).toBeNull()
    expect(mockFlash).not.toHaveBeenCalled()
  })
})
