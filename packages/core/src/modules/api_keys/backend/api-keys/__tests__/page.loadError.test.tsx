/** @jest-environment jsdom */
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import ApiKeysListPage from '../page'
import pl from '../../../i18n/pl.json'

const mockApiCall = jest.fn()
const mockFlash = jest.fn()
const mockTranslate = (key: string) => (pl as Record<string, string>)[key] ?? key

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => mockTranslate,
  useLocale: () => 'pl',
}))
jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeVersion: () => 0,
}))
jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PageBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  DataTable: ({ data, isLoading, onSearchChange }: {
    data: unknown[]
    isLoading: boolean
    onSearchChange: (value: string) => void
  }) => (
    <div data-testid="keys-table" data-loading={String(isLoading)}>
      <span data-testid="row-count">{data.length}</span>
      <button onClick={() => onSearchChange('retry')}>Retry</button>
    </div>
  ),
}))
jest.mock('@open-mercato/ui/backend/filters/ListEmptyState', () => ({ ListEmptyState: () => null }))
jest.mock('@open-mercato/ui/backend/RowActions', () => ({ RowActions: () => null }))
jest.mock('@open-mercato/ui/primitives/button', () => ({
  Button: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}))
jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: jest.fn(), ConfirmDialogElement: null }),
}))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => mockApiCall(...args),
  withScopedApiRequestHeaders: jest.fn(),
}))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: (...args: unknown[]) => mockFlash(...args),
}))

describe('API key list network failures', () => {
  beforeEach(() => jest.clearAllMocks())

  it('translates a rejected load and recovers when a later search succeeds', async () => {
    mockApiCall.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    mockApiCall.mockResolvedValueOnce({ ok: true, result: { items: [{ id: 'key-1' }], total: 1, totalPages: 1 } })
    render(<ApiKeysListPage />)

    await waitFor(() => expect(mockFlash).toHaveBeenCalledWith(pl['api_keys.list.error.loadFailed'], 'error'))
    expect(mockFlash).not.toHaveBeenCalledWith('Failed to fetch', 'error')
    await waitFor(() => expect(screen.getByTestId('keys-table')).toHaveAttribute('data-loading', 'false'))

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.getByTestId('row-count')).toHaveTextContent('1'))
    expect(mockApiCall).toHaveBeenLastCalledWith(expect.stringContaining('search=retry'), undefined, expect.anything())
    expect(mockFlash).toHaveBeenCalledTimes(1)
  })
})
