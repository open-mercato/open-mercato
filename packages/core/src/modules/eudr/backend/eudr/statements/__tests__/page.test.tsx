/** @jest-environment jsdom */

import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import EudrStatementsPage from '../page'

type StatementRowStub = {
  id: string
  title: string
  commodity: string
  status: string
  updatedAt: string
  latestRisk: null
}

const mockApiCall = jest.fn()
const mockRunMutation = jest.fn()
const mockConfirm = jest.fn(async () => true)
const mockFlash = jest.fn()

const messages: Record<string, string> = {
  'eudr.errors.archivedReadOnly': 'Archived statements are read-only.',
  'eudr.statements.list.deleteError': 'Could not delete the statement.',
  'eudr.statements.list.actions.delete': 'Delete',
  'eudr.statements.list.actions.edit': 'Edit',
  'eudr.statements.duplicateAction': 'Duplicate',
}

function statementRow(id: string, status: string): StatementRowStub {
  return {
    id,
    title: `Statement ${id}`,
    commodity: 'coffee',
    status,
    updatedAt: '2026-08-01T10:00:00.000Z',
    latestRisk: null,
  }
}

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}))

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props}>{children}</a>
  ),
}))

jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PageBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  DataTable: ({
    data,
    rowActions,
  }: {
    data?: StatementRowStub[]
    rowActions?: (row: StatementRowStub) => React.ReactNode
  }) => (
    <div>
      {(data ?? []).map((row) => (
        <div key={row.id} data-testid={`row-${row.id}`}>
          {rowActions?.(row)}
        </div>
      ))}
    </div>
  ),
}))

jest.mock('@open-mercato/ui/backend/RowActions', () => ({
  RowActions: ({ items }: { items: Array<{ id?: string; label: string; onSelect?: () => void }> }) => (
    <>
      {items.map((item) => (
        <button key={item.id} type="button" data-testid={`action-${item.id}`} onClick={item.onSelect}>
          {item.label}
        </button>
      ))}
    </>
  ),
}))

jest.mock('@open-mercato/ui/backend/filters/ListEmptyState', () => ({
  ListEmptyState: () => null,
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: (...args: unknown[]) => mockRunMutation(...args),
    retryLastMutation: jest.fn(),
  }),
}))

jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({
    confirm: (...args: unknown[]) => mockConfirm(...args),
    ConfirmDialogElement: null,
  }),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => mockApiCall(...args),
  withScopedApiRequestHeaders: (_headers: unknown, operation: () => unknown) => operation(),
}))

jest.mock('@open-mercato/ui/backend/utils/optimisticLock', () => ({
  buildOptimisticLockHeader: jest.fn(() => ({})),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: (...args: unknown[]) => mockFlash(...args),
}))

jest.mock('@open-mercato/ui/backend/conflicts', () => ({
  surfaceRecordConflict: jest.fn(() => false),
}))

jest.mock('@open-mercato/ui/primitives/button', () => ({
  Button: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

jest.mock('@open-mercato/ui/primitives/status-badge', () => ({
  StatusBadge: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeVersion: () => 1,
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useLocale: () => 'en',
  useT: () => (key: string) => messages[key] ?? key,
}))

async function renderListWith(rows: StatementRowStub[]): Promise<void> {
  mockApiCall.mockResolvedValue({
    ok: true,
    result: { items: rows, total: rows.length, totalPages: 1 },
  })
  render(<EudrStatementsPage />)
  await waitFor(() => expect(screen.getByTestId(`row-${rows[0].id}`)).toBeTruthy())
}

describe('EUDR statements list delete affordance', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockConfirm.mockResolvedValue(true)
  })

  it('offers Delete for a statement that can still be deleted', async () => {
    await renderListWith([statementRow('draft-1', 'draft')])

    expect(screen.queryByTestId('action-delete')).not.toBeNull()
  })

  it('hides Delete for an archived statement, which the server always refuses', async () => {
    await renderListWith([statementRow('archived-1', 'archived')])

    expect(screen.queryByTestId('action-edit')).not.toBeNull()
    expect(screen.queryByTestId('action-duplicate')).not.toBeNull()
    expect(screen.queryByTestId('action-delete')).toBeNull()
  })

  it('names the reason when a delete is refused instead of showing generic copy', async () => {
    mockRunMutation.mockRejectedValue(
      Object.assign(new Error('[internal] eudr statement delete failed'), {
        status: 400,
        error: 'eudr.errors.archivedReadOnly',
      }),
    )

    await renderListWith([statementRow('draft-1', 'draft')])
    fireEvent.click(screen.getByTestId('action-delete'))

    await waitFor(() => expect(mockFlash).toHaveBeenCalled())
    expect(mockFlash).toHaveBeenCalledWith('Archived statements are read-only.', 'error')
  })

  it('falls back to the generic copy when the failure carries no reason', async () => {
    mockRunMutation.mockRejectedValue(new Error('Failed to fetch'))

    await renderListWith([statementRow('draft-1', 'draft')])
    fireEvent.click(screen.getByTestId('action-delete'))

    await waitFor(() => expect(mockFlash).toHaveBeenCalled())
    expect(mockFlash).toHaveBeenCalledWith('Could not delete the statement.', 'error')
  })
})
