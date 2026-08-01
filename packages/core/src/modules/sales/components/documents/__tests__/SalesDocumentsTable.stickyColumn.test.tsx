/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, act } from '@testing-library/react'
import { SalesDocumentsTable } from '../SalesDocumentsTable'

// Capture the props handed to DataTable so we can assert the sticky-column wiring.
const mockDataTable = jest.fn()
const mockApiCall = jest.fn()

jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  withDataTableNamespaces: (mappedRow: Record<string, unknown>) => mappedRow,
  DataTable: (props: any) => {
    mockDataTable(props)
    return null
  },
}))

jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: any) => <div>{children}</div>,
  PageBody: ({ children }: any) => <div>{children}</div>,
}))

jest.mock('@open-mercato/ui/backend/RowActions', () => ({
  RowActions: ({ children }: any) => <div>{children}</div>,
}))

jest.mock('@open-mercato/ui/primitives/button', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: any[]) => mockApiCall(...args),
  withScopedApiRequestHeaders: (_header: unknown, callback: any) => callback?.(),
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
  DictionaryValue: ({ value }: any) => <span>{value}</span>,
  createDictionaryMap: () => ({}),
  normalizeDictionaryEntries: () => [],
}))

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, ...props }: any) => <a {...props}>{children}</a>,
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
}))

describe('SalesDocumentsTable sticky number column (issue #3039)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockApiCall.mockResolvedValue({ ok: true, result: { items: [] } })
  })

  it.each(['order', 'quote'] as const)(
    'pins the %s number column by passing stickyFirstColumn to DataTable',
    async (kind) => {
      await act(async () => {
        render(<SalesDocumentsTable kind={kind} />)
      })

      expect(mockDataTable).toHaveBeenCalled()
      const props = mockDataTable.mock.calls.at(-1)?.[0]

      // The number column must be the first data column for stickyFirstColumn to pin it.
      expect(props?.columns?.[0]?.id).toBe('number')
      // Regression for #3039: DataTable applies position: sticky to the first column
      // only when stickyFirstColumn is set; meta.sticky alone is inert.
      expect(props?.stickyFirstColumn).toBe(true)
    },
  )
})
