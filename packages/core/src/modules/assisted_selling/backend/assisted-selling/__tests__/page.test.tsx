/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import AssistedSellingInboxPage from '../page'

/**
 * N3 (review finding): `handleAssignToMe` used a bare, non-throwing `apiCall` for the
 * "Assign to me" row action — a 409 (stale version)/403 (missing feature)/500 response was
 * never inspected, so the handler always ran its success path: a "Conversation assigned to
 * you." flash and a reload, even though nothing was assigned server-side. Switching to the
 * throwing/result-checking `apiCallOrThrow` restores the normal guarded-mutation contract:
 * a 409 surfaces through `surfaceRecordConflict`, anything else falls through to the
 * generic failure flash.
 */

const mockPush = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

const THREAD_ROW = {
  id: 'thread-1',
  storeId: 'store-1',
  buyerCartId: 'cart-1',
  customerId: null,
  customerName: null,
  customerUserId: null,
  status: 'open',
  assignedActorId: null,
  assignedActorName: null,
  liveProposalCount: 0,
  lastActivityAt: null,
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const mockFlash = jest.fn()
const mockSurfaceRecordConflict = jest.fn(() => false)
const mockAssignWrite = jest.fn<Promise<unknown>, [string, RequestInit | undefined]>()

jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PageBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('@open-mercato/ui/backend/FilterBar', () => ({
  FilterBar: () => null,
}))

jest.mock('@open-mercato/ui/primitives/status-badge', () => ({
  StatusBadge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}))

jest.mock('@open-mercato/ui/backend/RowActions', () => ({
  RowActions: ({ items }: { items: Array<{ id: string; label: string; onSelect?: () => void }> }) => (
    <>
      {items.map((item) => (
        <button key={item.id} type="button" onClick={item.onSelect}>
          {item.label}
        </button>
      ))}
    </>
  ),
}))

jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  DataTable: ({ data, rowActions }: { data: unknown[]; rowActions?: (row: unknown) => React.ReactNode }) => (
    <div>
      {data.map((row, index) => (
        <div key={index}>{rowActions?.(row)}</div>
      ))}
    </div>
  ),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: jest.fn(async () => ({ items: [THREAD_ROW], total: 1 })),
  withScopedApiRequestHeaders: <T,>(_headers: Record<string, string>, run: () => Promise<T>) => run(),
  apiCallOrThrow: (url: string, init?: RequestInit) => mockAssignWrite(url, init),
}))

jest.mock('@open-mercato/ui/backend/utils/optimisticLock', () => ({
  buildOptimisticLockHeader: () => ({}),
}))

jest.mock('@open-mercato/ui/backend/conflicts', () => ({
  surfaceRecordConflict: (...args: unknown[]) => mockSurfaceRecordConflict(...args),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: ({ operation }: { operation: () => Promise<unknown> }) => operation(),
  }),
}))

jest.mock('@open-mercato/ui/backend/injection/useAppEventCoalesced', () => ({
  useAppEventCoalesced: () => undefined,
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: (...args: unknown[]) => mockFlash(...args),
}))

async function renderPage() {
  renderWithProviders(<AssistedSellingInboxPage />)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Assign to me' })).toBeInTheDocument())
}

describe('AssistedSellingInboxPage — Assign to me (N3)', () => {
  beforeEach(() => {
    mockFlash.mockReset()
    mockSurfaceRecordConflict.mockReset()
    mockSurfaceRecordConflict.mockReturnValue(false)
    mockAssignWrite.mockReset()
    mockPush.mockReset()
  })

  test('a success response flashes success and reloads', async () => {
    mockAssignWrite.mockResolvedValue({ ok: true, result: { ok: true } })
    await renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Assign to me' }))

    await waitFor(() => expect(mockFlash).toHaveBeenCalledWith('Conversation assigned to you.', 'success'))
  })

  test('a stale-version 409 surfaces as a conflict, never a false success flash', async () => {
    mockAssignWrite.mockRejectedValue(Object.assign(new Error('record_modified'), { status: 409 }))
    mockSurfaceRecordConflict.mockReturnValue(true)
    await renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Assign to me' }))

    await waitFor(() => expect(mockSurfaceRecordConflict).toHaveBeenCalled())
    expect(mockFlash).not.toHaveBeenCalledWith('Conversation assigned to you.', 'success')
  })

  test('a denying 403 falls through to the generic failure flash, never a false success flash', async () => {
    mockAssignWrite.mockRejectedValue(Object.assign(new Error('forbidden'), { status: 403 }))
    await renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Assign to me' }))

    await waitFor(() => expect(mockFlash).toHaveBeenCalledWith('Failed to assign this conversation.', 'error'))
    expect(mockFlash).not.toHaveBeenCalledWith('Conversation assigned to you.', 'success')
  })

  test('a server 500 falls through to the generic failure flash, never a false success flash', async () => {
    mockAssignWrite.mockRejectedValue(Object.assign(new Error('internal error'), { status: 500 }))
    await renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Assign to me' }))

    await waitFor(() => expect(mockFlash).toHaveBeenCalledWith('Failed to assign this conversation.', 'error'))
    expect(mockFlash).not.toHaveBeenCalledWith('Conversation assigned to you.', 'success')
  })
})
