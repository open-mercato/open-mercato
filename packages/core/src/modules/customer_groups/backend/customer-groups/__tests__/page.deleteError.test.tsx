/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import CustomerGroupsPage from '../page'

const mockApiCall = jest.fn()
const mockFlash = jest.fn()
const mockSurfaceRecordConflict = jest.fn((_error: unknown) => false)
const mockTranslate = (_key: string, fallback?: string) => fallback ?? _key

const GROUP_ID = '0b1f6c1e-5f4b-4a8e-9a43-6f2b7f6a9d10'
const SCOPE_MESSAGE = 'This group has members in organizations you cannot access, so you cannot delete it.'
const GENERIC_MESSAGE = 'Could not delete the customer group'

jest.mock('next/link', () => ({ children, href }: { children: React.ReactNode; href: string }) => (
  <a href={href}>{children}</a>
))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => mockTranslate,
}))

jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PageBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  DataTable: (props: { data?: Array<Record<string, unknown>>; rowActions?: (row: Record<string, unknown>) => React.ReactNode }) => (
    <div>
      {(props.data ?? []).map((row) => (
        <div key={String(row.id)}>{props.rowActions?.(row)}</div>
      ))}
    </div>
  ),
}))

jest.mock('@open-mercato/ui/backend/RowActions', () => ({
  RowActions: ({ items }: { items: Array<{ id: string; label: string; onSelect?: () => void }> }) => (
    <div>
      {items.map((item) => (
        <button key={item.id} type="button" data-testid={`row-action-${item.id}`} onClick={() => item.onSelect?.()}>
          {item.label}
        </button>
      ))}
    </div>
  ),
}))

jest.mock('@open-mercato/ui/backend/filters/ListEmptyState', () => ({
  ListEmptyState: () => null,
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: (...args: unknown[]) => mockFlash(...args),
}))

jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: async () => true, ConfirmDialogElement: null }),
}))

jest.mock('@open-mercato/ui/backend/BackendChromeProvider', () => ({
  useBackendChrome: () => ({ payload: { grantedFeatures: ['customer_groups.groups.manage'] }, isReady: true }),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => mockApiCall(...args),
  withScopedApiRequestHeaders: (_headers: Record<string, string>, run: () => unknown) => run(),
}))

jest.mock('@open-mercato/ui/backend/conflicts', () => ({
  surfaceRecordConflict: (error: unknown) => mockSurfaceRecordConflict(error),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: async ({ operation }: { operation: () => Promise<unknown> }) => operation(),
    retryLastMutation: async () => false,
  }),
}))

jest.mock('../../../components/OrphanBanner', () => ({
  OrphanBanner: () => null,
}))

function mockApi(deleteResponse: { ok: boolean; status: number; result: unknown }) {
  mockApiCall.mockImplementation(async (url: string, init?: { method?: string }) => {
    if (init?.method === 'DELETE') return deleteResponse
    return {
      ok: true,
      status: 200,
      result: {
        items: [
          {
            id: GROUP_ID,
            organization_id: null,
            tenant_id: null,
            code: 'wholesale',
            name: 'Wholesale',
            description: null,
            kind: 'b2b',
            parent_id: null,
            priority: 10,
            is_default: false,
            is_active: true,
            created_at: null,
            updated_at: '2026-10-01T00:00:00.000Z',
          },
        ],
        total: 1,
        page: 1,
        totalPages: 1,
      },
    }
  })
}

async function deleteTheGroup() {
  render(<CustomerGroupsPage />)
  fireEvent.click(await screen.findByTestId('row-action-delete'))
  await waitFor(() => expect(mockFlash).toHaveBeenCalled())
}

describe('customer groups list — delete failure message', () => {
  beforeEach(() => {
    mockApiCall.mockReset()
    mockFlash.mockReset()
    mockSurfaceRecordConflict.mockClear()
  })

  it('shows the server reason when the delete is refused', async () => {
    mockApi({ ok: false, status: 409, result: { error: SCOPE_MESSAGE } })
    await deleteTheGroup()
    expect(mockFlash).toHaveBeenCalledWith(SCOPE_MESSAGE, 'error')
  })

  it('falls back to the generic message when the server gives no reason', async () => {
    mockApi({ ok: false, status: 500, result: null })
    await deleteTheGroup()
    expect(mockFlash).toHaveBeenCalledWith(GENERIC_MESSAGE, 'error')
  })
})
