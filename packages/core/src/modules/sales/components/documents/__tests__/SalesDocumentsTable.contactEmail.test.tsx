/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, act } from '@testing-library/react'
import { SalesDocumentsTable } from '../SalesDocumentsTable'

const mockDataTable = jest.fn()
const mockApiCall = jest.fn()

jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  withDataTableNamespaces: (mappedRow: Record<string, unknown>) => mappedRow,
  DataTable: (props: Record<string, unknown>) => {
    mockDataTable(props)
    return null
  },
}))

jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  PageBody: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
}))

jest.mock('@open-mercato/ui/backend/RowActions', () => ({
  RowActions: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
}))

jest.mock('@open-mercato/ui/primitives/button', () => ({
  Button: ({ children, ...props }: React.ComponentProps<'button'>) => <button {...props}>{children}</button>,
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => mockApiCall(...args),
  withScopedApiRequestHeaders: (_header: unknown, callback?: () => unknown) => callback?.(),
}))

jest.mock('@open-mercato/ui/backend/utils/optimisticLock', () => ({
  buildOptimisticLockHeader: () => ({}),
}))

jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  buildCrudExportUrl: () => '/export.csv',
  deleteCrud: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: jest.fn(), ConfirmDialogElement: null }),
}))

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeVersion: () => 1,
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => {
  // Stable reference: the real useT() is memoized. Returning a fresh function
  // each render would re-create the data-load callback and loop the effect.
  const translate = (key: string, fallback?: string) => fallback ?? key
  return { useT: () => translate }
})

jest.mock('@open-mercato/core/modules/dictionaries/components/dictionaryAppearance', () => ({
  DictionaryValue: ({ value }: { value?: React.ReactNode }) => <span>{value}</span>,
  createDictionaryMap: () => ({}),
  normalizeDictionaryEntries: () => [],
}))

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
}))

jest.mock('../../useSalesChannelsEnabled', () => ({
  useSalesChannelsEnabled: () => ({ enabled: true, isLoading: false }),
}))

function lastProps() {
  return mockDataTable.mock.calls.at(-1)?.[0]
}

describe('SalesDocumentsTable customer e-mail', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('shows the address the list reports, over the one on the customer snapshot (#8459)', async () => {
    mockApiCall.mockResolvedValue({
      ok: true,
      result: {
        items: [
          {
            id: 'doc-1',
            contactEmail: 'accounting@example.test',
            customerSnapshot: { customer: { primaryEmail: 'record@example.test' } },
          },
          {
            id: 'doc-2',
            customerSnapshot: { customer: { primaryEmail: 'record@example.test' } },
          },
        ],
      },
    })

    await act(async () => {
      render(<SalesDocumentsTable kind="quote" />)
    })

    const rows = lastProps()?.data as Array<{ id: string; customerEmail: string | null }>
    expect(rows.find((row) => row.id === 'doc-1')?.customerEmail).toBe('accounting@example.test')
    expect(rows.find((row) => row.id === 'doc-2')?.customerEmail).toBe('record@example.test')
  })
})
