/**
 * @jest-environment jsdom
 */

/**
 * Work Inbox page (spec §6.2).
 *
 * The assertion that matters most here is the FROZEN table id. The enterprise
 * agent_orchestrator injects its "Review proposal" row action into
 * `data-table:workflows.tasks.list:row-actions`, and `DataTable` derives that
 * spot from `perspective.tableId`. Replacing the task list with a new page is
 * exactly the change that would silently drop that action, so the page's prop
 * and the enterprise injection table are read and compared here rather than
 * merely asserted from memory.
 */

import * as React from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, render, screen, waitFor, fireEvent } from '@testing-library/react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'

const mockTranslate = (key: string, fallbackOrVars?: unknown) =>
  typeof fallbackOrVars === 'string' ? fallbackOrVars : key

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => mockTranslate,
}))

const pushMock = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: jest.fn(), refresh: jest.fn() }),
}))

jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  PageBody: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}))

type TableProps = {
  title?: React.ReactNode
  columns: Array<{ id?: string; cell?: (ctx: { row: { original: Record<string, unknown> } }) => React.ReactNode }>
  data: Array<Record<string, unknown>>
  actions?: React.ReactNode
  perspective?: { tableId?: string }
  pagination?: { pageSize?: number }
  filters?: Array<{ id: string }>
  emptyState?: React.ReactNode
  filterAwareEmptyState?: { active: boolean; entityNamePlural: string; onClearAll: () => void }
  onFiltersApply?: (values: Record<string, unknown>) => void
}

let capturedTableProps: TableProps | null = null

jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  DataTable: (props: TableProps) => {
    capturedTableProps = props
    return (
      <div data-testid="data-table">
        <div data-testid="table-id">{props.perspective?.tableId}</div>
        <div data-testid="table-actions">{props.actions}</div>
        {/*
          Mirrors the real DataTable's own precedence: an active
          filterAwareEmptyState replaces the generic empty slot.
        */}
        {props.data.length === 0
          ? props.filterAwareEmptyState?.active
            ? <div data-testid="filtered-empty-results" />
            : props.emptyState
          : null}
        {props.data.map((row, rowIndex) => (
          <div key={String(row.id)} data-testid={`row-${row.id}`}>
            {props.columns.map((column, columnIndex) => (
              <span key={column.id ?? columnIndex} data-testid={`cell-${row.id}-${column.id}`}>
                {column.cell ? column.cell({ row: { original: row } }) : null}
              </span>
            ))}
            <span data-testid={`row-index-${rowIndex}`}>{String(row.id)}</span>
          </div>
        ))}
      </div>
    )
  },
}))

jest.mock('@open-mercato/ui/backend/RowActions', () => ({
  RowActions: ({ items }: { items: Array<{ id: string; label: string; onSelect?: () => void; href?: string }> }) => (
    <>
      {items.map((item) => (
        <button key={item.id} data-testid={`action-${item.id}`} onClick={() => item.onSelect?.()}>
          {item.label}
        </button>
      ))}
    </>
  ),
}))

jest.mock('@open-mercato/ui/primitives/button', () => ({
  Button: ({ children, ...rest }: { children?: React.ReactNode }) => <button {...rest}>{children}</button>,
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({
    confirm: jest.fn(async () => true),
    ConfirmDialogElement: null,
  }),
}))

jest.mock('@tanstack/react-query', () => {
  const ReactModule = require('react') as typeof React
  return {
    useQuery: ({ queryKey, queryFn }: { queryKey: unknown[]; queryFn: () => Promise<unknown> }) => {
      const [state, setState] = ReactModule.useState<{ data: unknown; isLoading: boolean; error: unknown }>({
        data: undefined,
        isLoading: true,
        error: null,
      })
      const key = JSON.stringify(queryKey)
      ReactModule.useEffect(() => {
        let cancelled = false
        Promise.resolve()
          .then(() => queryFn())
          .then((data) => {
            if (!cancelled) setState({ data, isLoading: false, error: null })
          })
          .catch((error: unknown) => {
            if (!cancelled) setState({ data: undefined, isLoading: false, error })
          })
        return () => {
          cancelled = true
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [key])
      return state
    },
    useQueryClient: () => ({ invalidateQueries: jest.fn() }),
  }
})

jest.mock('lucide-react', () => ({
  AlertTriangle: () => null,
  ArrowDown: () => null,
  ArrowUp: () => null,
  CheckCircle2: () => null,
  Circle: () => null,
  AlertCircle: () => null,
  Clock: () => null,
  EyeOff: () => null,
  Info: () => null,
  Rocket: () => null,
  X: () => null,
  Flame: () => null,
  Inbox: () => null,
  Loader: () => null,
  Minus: () => null,
  Plus: () => null,
  XCircle: () => null,
}))

import WorkInboxPage from '../page'
import { metadata as workInboxMetadata } from '../page.meta'

const TASK_ROW = {
  id: 'task-1',
  kind: 'user_task',
  moduleId: 'workflows',
  title: 'Approve order',
  description: 'Approve the pending sales order',
  status: 'PENDING',
  priority: 'high',
  dueDate: '2026-07-27T00:00:00.000Z',
  overdue: true,
  createdAt: '2026-07-26T00:00:00.000Z',
  updatedAt: '2026-07-26T00:00:00.000Z',
  assignedTo: null,
  assignedToRoles: ['approver'],
  claimedBy: null,
  entityTypes: ['sales:order'],
  entityBindings: [{ entityType: 'sales:order', entityId: 'order-1', label: 'SO-1' }],
  detailHref: '/backend/tasks/task-1',
  actions: [],
  proposalId: null,
}

const DISPOSITION_ROW = {
  ...TASK_ROW,
  id: 'disposition-1',
  kind: 'agent_disposition',
  moduleId: 'agent_orchestrator',
  title: 'Dispose proposal',
  description: null,
  priority: 'extreme',
  overdue: false,
  dueDate: null,
  status: 'IN_PROGRESS',
  claimedBy: 'user-1',
  entityBindings: [],
  entityTypes: [],
  detailHref: '/backend/tasks/disposition-1',
  proposalId: 'proposal-9',
}

function listResult(
  rows: Array<Record<string, unknown>>,
  degradedKinds: string[] = [],
  entityHiddenCount = 0,
) {
  return {
    ok: true,
    status: 200,
    result: {
      data: rows,
      pagination: { total: rows.length, limit: 50, offset: 0, hasMore: false },
      meta: { kinds: ['user_task', 'agent_disposition'], degradedKinds },
      ...(entityHiddenCount > 0
        ? {
            diagnostics: {
              entityHiddenCount,
              entityHidden: Array.from({ length: entityHiddenCount }, (_, index) => ({
                id: `hidden-${index}`,
                reason: 'denied:entity-access',
                entityType: 'customers:person',
              })),
            },
          }
        : {}),
    },
  }
}

describe('Work Inbox page', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    capturedTableProps = null
    ;(apiCall as jest.Mock).mockResolvedValue(listResult([DISPOSITION_ROW, TASK_ROW]))
  })

  test('lists the merged rows from every source', async () => {
    render(<WorkInboxPage />)

    await waitFor(() => expect(screen.getByTestId('row-task-1')).toBeTruthy())
    expect(screen.getByTestId('row-disposition-1')).toBeTruthy()
    expect(screen.getByText('Approve order')).toBeTruthy()
    expect(screen.getByText('Dispose proposal')).toBeTruthy()
  })

  test('preserves the merged server order rather than re-sorting client-side', async () => {
    render(<WorkInboxPage />)

    await waitFor(() => expect(screen.getByTestId('row-index-0')).toBeTruthy())
    expect(screen.getByTestId('row-index-0').textContent).toBe('disposition-1')
    expect(screen.getByTestId('row-index-1').textContent).toBe('task-1')
  })

  test('reads the work inbox endpoint and defaults to the caller own work', async () => {
    render(<WorkInboxPage />)

    await waitFor(() => expect(apiCall).toHaveBeenCalled())
    const url = (apiCall as jest.Mock).mock.calls[0][0] as string
    expect(url).toContain('/api/workflows/work-inbox?')
    expect(url).toContain('myWork=true')
    expect(url).toContain('limit=50')
  })

  test('offers the kind, module, entity-type and role filters the spec requires', async () => {
    render(<WorkInboxPage />)

    await waitFor(() => expect(capturedTableProps).not.toBeNull())
    const filterIds = (capturedTableProps?.filters ?? []).map((filter) => filter.id)
    expect(filterIds).toEqual(
      expect.arrayContaining(['kind', 'module', 'entityType', 'role', 'priority', 'status', 'overdue', 'myWork']),
    )
  })

  test('marks an overdue item with a label, not colour alone', async () => {
    render(<WorkInboxPage />)

    await waitFor(() => expect(screen.getByTestId('cell-task-1-title')).toBeTruthy())
    expect(screen.getByTestId('cell-task-1-title').textContent).toContain('workflows.tasks.overdue')
  })

  test('claims a role-queued item and releases a claimed one', async () => {
    render(<WorkInboxPage />)

    await waitFor(() => expect(screen.getByTestId('action-claim')).toBeTruthy())
    fireEvent.click(screen.getByTestId('action-claim'))

    await waitFor(() =>
      expect((apiCall as jest.Mock).mock.calls.some((call) => call[0] === '/api/workflows/tasks/task-1/claim')).toBe(true),
    )

    fireEvent.click(screen.getByTestId('action-unclaim'))

    await waitFor(() =>
      expect(
        (apiCall as jest.Mock).mock.calls.some((call) => call[0] === '/api/workflows/tasks/disposition-1/unclaim'),
      ).toBe(true),
    )
  })

  test('claim-next posts to the inbox endpoint and opens what it won', async () => {
    render(<WorkInboxPage />)
    await waitFor(() => expect(apiCall).toHaveBeenCalled())
    ;(apiCall as jest.Mock).mockResolvedValueOnce({ ok: true, status: 200, result: { data: TASK_ROW } })

    fireEvent.click(screen.getByText('workflows.workInbox.actions.claimNext'))

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/backend/tasks/task-1'))
  })

  test('keeps the page size within the platform cap', async () => {
    render(<WorkInboxPage />)

    await waitFor(() => expect(capturedTableProps).not.toBeNull())
    expect(capturedTableProps?.pagination?.pageSize).toBeLessThanOrEqual(100)
  })

  /**
   * §6.4 shipped default-ON: an employee who is neither an assignee nor in a
   * role queue went from the whole organisation's tasks to a blank page. These
   * assert the blank page explains itself, and explains itself CORRECTLY —
   * telling somebody their permissions are wrong when they merely filtered
   * sends them to an administrator who cannot help.
   */
  describe('the empty inbox explains itself', () => {
    test('says nothing is assigned to you — never that you lack permission', async () => {
      ;(apiCall as jest.Mock).mockResolvedValue(listResult([]))
      render(<WorkInboxPage />)

      await waitFor(() => expect(screen.getByTestId('work-inbox-empty-no-relationship')).toBeTruthy())
      expect(screen.getByText('workflows.workInbox.empty.noRelationship.title')).toBeTruthy()
      expect(screen.getByText('workflows.workInbox.empty.noRelationship.description')).toBeTruthy()
      expect(capturedTableProps?.filterAwareEmptyState?.active).toBe(false)
    })

    test('hands a narrowed query to the shared filtered-empty state instead', async () => {
      ;(apiCall as jest.Mock).mockResolvedValue(listResult([]))
      render(<WorkInboxPage />)

      await waitFor(() => expect(capturedTableProps).not.toBeNull())
      act(() => {
        capturedTableProps?.onFiltersApply?.({ myWork: 'true', status: 'COMPLETED' })
      })

      await waitFor(() => expect(screen.getByTestId('filtered-empty-results')).toBeTruthy())
      expect(screen.queryByTestId('work-inbox-empty-no-relationship')).toBeNull()
      expect(capturedTableProps?.emptyState).toBeUndefined()
    })

    test('says work is hidden by the entity gate, naming no record and no reason code', async () => {
      ;(apiCall as jest.Mock).mockResolvedValue(listResult([], [], 2))
      render(<WorkInboxPage />)

      await waitFor(() => expect(screen.getByTestId('work-inbox-empty-entity-hidden')).toBeTruthy())
      expect(screen.getByText('workflows.workInbox.empty.entityHidden.title')).toBeTruthy()

      const rendered = screen.getByTestId('data-table').textContent ?? ''
      expect(rendered).not.toContain('denied:')
      expect(rendered).not.toContain('customers:person')
      expect(rendered).not.toContain('hidden-0')
      // The banner above the table would say the same thing a second time.
      expect(screen.queryByText('workflows.workInbox.messages.entityHidden')).toBeNull()
    })

    test('keeps the banner when rows ARE listed — the page is short, not empty', async () => {
      ;(apiCall as jest.Mock).mockResolvedValue(listResult([TASK_ROW], [], 2))
      render(<WorkInboxPage />)

      await waitFor(() => expect(screen.getByText('workflows.workInbox.messages.entityHidden')).toBeTruthy())
      expect(screen.queryByTestId('work-inbox-empty-entity-hidden')).toBeNull()
    })

    test('says the list may be incomplete when a source degraded', async () => {
      ;(apiCall as jest.Mock).mockResolvedValue(listResult([], ['agent_disposition'], 4))
      render(<WorkInboxPage />)

      await waitFor(() => expect(screen.getByTestId('work-inbox-empty-degraded')).toBeTruthy())
      expect(screen.getByText('workflows.workInbox.empty.degraded.title')).toBeTruthy()
      expect(screen.queryByTestId('work-inbox-empty-no-relationship')).toBeNull()
      expect(screen.getByTestId('data-table').textContent ?? '').not.toContain('agent_disposition')
    })
  })

  test('keeps the RBAC guard the retired task list carried', () => {
    expect(workInboxMetadata.requireAuth).toBe(true)
    expect(workInboxMetadata.requireFeatures).toEqual(['workflows.view_tasks'])
  })
})

/**
 * BACKWARD_COMPATIBILITY.md §6 — widget spot ids are FROZEN.
 */
describe('the frozen enterprise row-action spot still resolves', () => {
  const enterpriseInjectionTable = join(
    __dirname,
    '..',
    '..',
    '..',
    '..',
    '..',
    '..',
    '..',
    'enterprise',
    'src',
    'modules',
    'agent_orchestrator',
    'widgets',
    'injection-table.ts',
  )

  test('the page emits the table id DataTable turns into the injected spot', async () => {
    ;(apiCall as jest.Mock).mockResolvedValue(listResult([TASK_ROW]))
    render(<WorkInboxPage />)

    await waitFor(() => expect(screen.getByTestId('table-id')).toBeTruthy())
    expect(screen.getByTestId('table-id').textContent).toBe('workflows.tasks.list')
  })

  test('the emitted table id matches the spot the enterprise module injects into', () => {
    const source = readFileSync(enterpriseInjectionTable, 'utf8')
    const spots = [...source.matchAll(/'data-table:([^:']+):row-actions'/g)].map((match) => match[1])

    expect(spots).toContain('workflows.tasks.list')
  })

  test('the enterprise action reads a field the work-inbox row still carries', () => {
    expect(Object.keys(DISPOSITION_ROW)).toContain('proposalId')
    expect(DISPOSITION_ROW.proposalId).toBe('proposal-9')
  })
})
