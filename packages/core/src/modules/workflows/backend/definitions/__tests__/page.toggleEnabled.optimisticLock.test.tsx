/** @jest-environment jsdom */

import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

/**
 * Regression for #3333 — the workflow definitions list toggles a definition's
 * enabled state with a raw `PUT /api/workflows/definitions/:id` row action. The
 * API enforces command-level optimistic locking, but treats a *missing*
 * expected-version header as a no-op lock, so without the header this row action
 * can silently overwrite a newer definition update.
 *
 * Both toggle entry points (the enabled badge and the row-action menu item) MUST
 * send `buildOptimisticLockHeader(row.original.updatedAt)` via
 * `withScopedApiRequestHeaders`, exactly like the delete and visual-editor update
 * paths already do.
 */

const apiCallMock = jest.fn()
const surfaceRecordConflictMock = jest.fn<boolean, [unknown, unknown]>(() => false)
const flashMock = jest.fn()
const scopedHeaderCalls: Array<Record<string, string>> = []

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
  withScopedApiRequestHeaders: <T,>(headers: Record<string, string>, run: () => Promise<T>) => {
    scopedHeaderCalls.push(headers)
    return run()
  },
}))

jest.mock('@open-mercato/ui/backend/conflicts', () => ({
  surfaceRecordConflict: (...args: [unknown, unknown]) => surfaceRecordConflictMock(...args),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: (...args: unknown[]) => flashMock(...args) }))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string) => fallback ?? key,
}))

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }))

jest.mock('next/link', () => ({ children, href }: { children: React.ReactNode; href: string }) => (
  <a href={href}>{children}</a>
))

jest.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: [], isLoading: false, error: null }),
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}))

let capturedColumns: Array<{ id?: string; cell?: (ctx: unknown) => React.ReactNode }> = []

jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  DataTable: (props: { columns: Array<{ id?: string; cell?: (ctx: unknown) => React.ReactNode }> }) => {
    capturedColumns = props.columns
    return <div data-testid="data-table-mock" />
  },
}))

jest.mock('@open-mercato/ui/backend/RowActions', () => ({
  RowActions: ({ items }: { items: Array<{ id: string; label: string; onSelect?: () => void }> }) => (
    <div>
      {items.map((item) => (
        <button key={item.id} data-testid={`row-action-${item.id}`} onClick={() => item.onSelect?.()}>
          {item.label}
        </button>
      ))}
    </div>
  ),
}))

import * as React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import WorkflowDefinitionsListPage from '../page'

const UPDATED_AT = '2026-06-19T08:42:18.123Z'

function buildDefinition(overrides: Record<string, unknown> = {}) {
  return {
    id: 'def-1',
    workflowId: 'wf_demo',
    workflowName: 'Demo workflow',
    description: null,
    version: 1,
    definition: {},
    enabled: true,
    effectiveFrom: null,
    effectiveTo: null,
    metadata: null,
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    createdAt: '2026-06-19T08:00:00.000Z',
    updatedAt: UPDATED_AT,
    createdBy: null,
    source: 'user',
    ...overrides,
  }
}

function renderColumns() {
  capturedColumns = []
  render(<WorkflowDefinitionsListPage />)
  return capturedColumns
}

describe('WorkflowDefinitionsListPage — toggle enabled sends optimistic-lock header (#3333)', () => {
  beforeEach(() => {
    apiCallMock.mockReset().mockResolvedValue({ ok: true })
    surfaceRecordConflictMock.mockReset().mockReturnValue(false)
    flashMock.mockReset()
    scopedHeaderCalls.length = 0
  })

  it('sends the expected updated_at header when toggling via the enabled badge', async () => {
    const columns = renderColumns()
    const enabledColumn = columns.find((col) => col.id === 'enabled')
    expect(enabledColumn?.cell).toBeTruthy()

    render(enabledColumn!.cell!({ row: { original: buildDefinition() } }) as React.ReactElement)
    fireEvent.click(screen.getByRole('button'))

    await waitFor(() => expect(apiCallMock).toHaveBeenCalledTimes(1))
    expect(apiCallMock.mock.calls[0][0]).toBe('/api/workflows/definitions/def-1')
    expect(apiCallMock.mock.calls[0][1]).toMatchObject({ method: 'PUT' })
    expect(scopedHeaderCalls).toContainEqual({ [OPTIMISTIC_LOCK_HEADER_NAME]: UPDATED_AT })
  })

  it('sends the expected updated_at header when toggling via the row action', async () => {
    const columns = renderColumns()
    const actionsColumn = columns.find((col) => col.id === 'actions')
    expect(actionsColumn?.cell).toBeTruthy()

    render(actionsColumn!.cell!({ row: { original: buildDefinition({ enabled: true }) } }) as React.ReactElement)
    fireEvent.click(screen.getByTestId('row-action-disable'))

    await waitFor(() => expect(apiCallMock).toHaveBeenCalledTimes(1))
    expect(apiCallMock.mock.calls[0][0]).toBe('/api/workflows/definitions/def-1')
    expect(apiCallMock.mock.calls[0][1]).toMatchObject({ method: 'PUT' })
    expect(scopedHeaderCalls).toContainEqual({ [OPTIMISTIC_LOCK_HEADER_NAME]: UPDATED_AT })
  })

  it('surfaces a 409 conflict via surfaceRecordConflict instead of a generic error flash', async () => {
    apiCallMock.mockResolvedValue({
      ok: false,
      status: 409,
      result: { code: 'optimistic_lock_conflict', currentUpdatedAt: '2026-06-19T09:00:00.000Z', expectedUpdatedAt: UPDATED_AT },
    })
    surfaceRecordConflictMock.mockReturnValue(true)

    const columns = renderColumns()
    const enabledColumn = columns.find((col) => col.id === 'enabled')
    render(enabledColumn!.cell!({ row: { original: buildDefinition() } }) as React.ReactElement)
    fireEvent.click(screen.getByRole('button'))

    await waitFor(() => expect(surfaceRecordConflictMock).toHaveBeenCalledTimes(1))
    expect(surfaceRecordConflictMock.mock.calls[0][0]).toMatchObject({ status: 409, code: 'optimistic_lock_conflict' })
    expect(flashMock).not.toHaveBeenCalledWith(expect.anything(), 'error')
  })
})
