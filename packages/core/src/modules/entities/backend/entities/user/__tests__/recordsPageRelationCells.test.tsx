/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { registerEntityIds } from '@open-mercato/shared/lib/encryption/entityIds'

const mockReadApiResultOrThrow = jest.fn()
const mockUseCustomFieldDefs = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
  readApiResultOrThrow: (...args: unknown[]) => mockReadApiResultOrThrow(...args),
  withScopedApiRequestHeaders: (_header: unknown, run: () => unknown) => run(),
}))

jest.mock('@open-mercato/ui/backend/utils/customFieldDefs', () => ({
  ...jest.requireActual('@open-mercato/ui/backend/utils/customFieldDefs'),
  useCustomFieldDefs: (...args: unknown[]) => mockUseCustomFieldDefs(...args),
}))

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}))

jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
}))

jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PageBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('@open-mercato/ui/backend/ContextHelp', () => ({
  ContextHelp: () => null,
}))

jest.mock('@open-mercato/ui/primitives/button', () => ({
  Button: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}))

jest.mock('@open-mercato/ui/backend/RowActions', () => ({
  RowActions: () => null,
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('@open-mercato/ui/backend/utils/serverErrors', () => ({ raiseCrudError: jest.fn() }))
jest.mock('@open-mercato/ui/backend/utils/optimisticLock', () => ({ buildOptimisticLockHeader: jest.fn() }))

jest.mock('@open-mercato/ui/backend/detail', () => ({
  ErrorMessage: ({ label }: { label: string }) => <div>{label}</div>,
  LoadingMessage: ({ label }: { label: string }) => <div>{label}</div>,
}))

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeVersion: () => 0,
}))

jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: jest.fn(), ConfirmDialogElement: null }),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({ runMutation: jest.fn(), retryLastMutation: jest.fn() }),
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback?: string) => fallback ?? _key,
}))

jest.mock('@open-mercato/core/modules/entities/components/useRecordsEntityGuard', () => ({
  useRecordsEntityGuard: () => 'allowed',
}))

jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  DataTable: ({ columns, data }: { columns: any[]; data: any[] }) => (
    <table>
      <tbody>
        {data.map((row, rowIndex) => (
          <tr key={rowIndex}>
            {columns.map((column, columnIndex) => {
              const Cell = column.cell
              return (
                <td key={columnIndex}>
                  {Cell ? <Cell getValue={() => row[column.accessorKey]} /> : null}
                </td>
              )
            })}
          </tr>
        ))}
      </tbody>
    </table>
  ),
}))

const RecordsPage = require('../[entityId]/records/page').default

const RELATION_DEFINITION = {
  key: 'related_order',
  kind: 'relation',
  label: 'Related order',
  listVisible: true,
  optionsUrl: '/api/entities/relations/options?entityId=sales%3Asales_order',
}

function countCalls(pathFragment: string): number {
  return mockReadApiResultOrThrow.mock.calls.filter(
    (call) => String(call[0]).includes(pathFragment),
  ).length
}

describe('user entity records page — relation cells', () => {
  beforeAll(() => {
    registerEntityIds({ sales: { sales_order: 'sales:sales_order' } })
  })

  beforeEach(() => {
    jest.clearAllMocks()
    mockUseCustomFieldDefs.mockReturnValue({ data: [RELATION_DEFINITION] })
    mockReadApiResultOrThrow.mockImplementation(async (url: string) => {
      if (String(url).includes('/api/entities/records')) {
        return {
          items: [{ id: 'record-1', related_order: 'order-1' }],
          total: 1,
          page: 1,
          pageSize: 50,
          totalPages: 1,
        }
      }
      return { items: [{ value: 'order-1', label: 'Order #1001' }] }
    })
  })

  it('renders the resolved relation label as a link to the target record', async () => {
    render(<RecordsPage params={{ entityId: 'custom%3Astock_in' }} />)

    const link = await screen.findByRole('link', { name: 'Order #1001' })
    expect(link).toHaveAttribute('href', '/backend/sales/orders/order-1')
  })

  it('settles after resolving relation displays instead of refetching in a loop', async () => {
    render(<RecordsPage params={{ entityId: 'custom%3Astock_in' }} />)

    await screen.findByRole('link', { name: 'Order #1001' })
    const recordCallsAfterResolve = countCalls('/api/entities/records')
    await new Promise((resolve) => setTimeout(resolve, 250))

    expect(countCalls('/api/entities/records')).toBe(recordCallsAfterResolve)
    expect(countCalls('/api/entities/records')).toBeLessThanOrEqual(2)
    expect(countCalls('/api/entities/relations/options')).toBeLessThanOrEqual(2)
  })

  it('falls back to the raw relation id when the lookup returns nothing', async () => {
    mockReadApiResultOrThrow.mockImplementation(async (url: string) => {
      if (String(url).includes('/api/entities/records')) {
        return {
          items: [{ id: 'record-1', related_order: 'order-1' }],
          total: 1,
          page: 1,
          pageSize: 50,
          totalPages: 1,
        }
      }
      return { items: [] }
    })

    render(<RecordsPage params={{ entityId: 'custom%3Astock_in' }} />)

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'order-1' })).toBeInTheDocument()
    })
  })
})
