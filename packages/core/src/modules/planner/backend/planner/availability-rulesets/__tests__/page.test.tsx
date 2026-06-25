/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import PlannerAvailabilityRuleSetsPage from '../page'

const runMutationMock = jest.fn(async ({ operation }: { operation: () => Promise<unknown> }) => operation())
const retryLastMutationMock = jest.fn()
const deleteCrudMock = jest.fn(async () => ({ ok: true }))
const readApiResultOrThrowMock = jest.fn()
const confirmMock = jest.fn(async () => true)

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: (...args: unknown[]) => runMutationMock(...(args as [{ operation: () => Promise<unknown> }])),
    retryLastMutation: retryLastMutationMock,
  }),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: (...args: unknown[]) => readApiResultOrThrowMock(...args),
  withScopedApiRequestHeaders: (_headers: unknown, fn: () => Promise<unknown>) => fn(),
}))

jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  deleteCrud: (...args: unknown[]) => deleteCrudMock(...args),
}))

jest.mock('@open-mercato/ui/backend/utils/optimisticLock', () => ({
  buildOptimisticLockHeader: () => ({}),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/utils/serverErrors', () => ({
  normalizeCrudServerError: (error: unknown) => ({ message: error instanceof Error ? error.message : null }),
}))

jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({
    confirm: (...args: unknown[]) => confirmMock(...args),
    ConfirmDialogElement: null,
  }),
}))

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeVersion: () => 0,
}))

jest.mock('@open-mercato/shared/lib/time', () => ({
  formatDateTime: (value: string) => value,
}))

jest.mock('@open-mercato/ui/backend/markdown/markdownToPlainText', () => ({
  markdownToPlainText: (value: string) => value,
}))

jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PageBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}))

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

jest.mock('@open-mercato/ui/backend/RowActions', () => ({
  RowActions: ({ items }: { items: Array<{ id: string; label: string; onSelect?: () => void }> }) => (
    <>
      {items.map((item) => (
        <button key={item.id} type="button" onClick={item.onSelect} disabled={!item.onSelect}>
          {item.label}
        </button>
      ))}
    </>
  ),
}))

jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  withDataTableNamespaces: (row: Record<string, unknown>) => row,
  DataTable: ({
    data,
    rowActions,
  }: {
    data: Array<Record<string, unknown>>
    rowActions?: (row: Record<string, unknown>) => React.ReactNode
  }) => (
    <div data-testid="data-table">
      {(Array.isArray(data) ? data : []).map((row, index) => (
        <div key={index}>{rowActions ? rowActions(row) : null}</div>
      ))}
    </div>
  ),
}))

describe('PlannerAvailabilityRuleSetsPage — guarded mutation', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    confirmMock.mockResolvedValue(true)
    readApiResultOrThrowMock.mockResolvedValue({
      items: [
        {
          id: 'rule-set-1',
          name: 'Weekdays',
          description: null,
          timezone: 'Europe/Warsaw',
          updatedAt: '2026-06-01T10:00:00.000Z',
        },
      ],
      total: 1,
      totalPages: 1,
    })
  })

  it('routes the rule-set delete through useGuardedMutation with the optimistic-lock-aware operation', async () => {
    renderWithProviders(<PlannerAvailabilityRuleSetsPage />)

    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(runMutationMock).toHaveBeenCalledTimes(1))

    expect(runMutationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({
          resourceKind: 'planner.availability_rule_set',
          retryLastMutation: expect.any(Function),
        }),
        mutationPayload: expect.objectContaining({ action: 'delete', id: 'rule-set-1' }),
      }),
    )

    expect(deleteCrudMock).toHaveBeenCalledWith(
      'planner/availability-rule-sets',
      'rule-set-1',
      expect.any(Object),
    )
  })
})
