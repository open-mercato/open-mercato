/**
 * @jest-environment jsdom
 */

import '@testing-library/jest-dom'
import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver = MockResizeObserver

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
  apiCallOrThrow: jest.fn(),
  readApiResultOrThrow: jest.fn(),
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
  usePathname: () => '',
  useSearchParams: () => new URLSearchParams(),
}))

jest.mock('@open-mercato/ui/backend/injection/useInjectionDataWidgets', () => ({
  useInjectionDataWidgets: () => ({ widgets: [], isLoading: false }),
}))

jest.mock('@open-mercato/ui/backend/version-history', () => {
  const actual = jest.requireActual('@open-mercato/ui/backend/version-history')
  return {
    ...actual,
    useAuditPermissions: () => ({
      currentUserId: 'user-1',
      canViewTenant: true,
      canUndoSelf: true,
      canUndoTenant: true,
      canRedoSelf: true,
      canRedoTenant: true,
      isLoading: false,
    }),
  }
})

jest.mock('../ActionLogDetailsDialog', () => ({
  ActionLogDetailsDialog: ({ item }: { item: { id: string } }) => (
    <div data-testid="action-log-details-dialog">{item.id}</div>
  ),
}))

import { AuditLogsActions, type ActionLogItem } from '../AuditLogsActions'

const baseItem: ActionLogItem = {
  id: 'log-1',
  commandId: 'catalog.products.delete',
  actionLabel: 'Delete product',
  executionState: 'done',
  actorUserId: 'user-1',
  actorUserName: 'Admin',
  tenantId: 'tenant-1',
  tenantName: 'Tenant',
  organizationId: 'org-1',
  organizationName: 'Org',
  resourceKind: 'catalog.product',
  resourceId: 'product-1',
  undoToken: 'undo-token-1',
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
}

async function findRowButton(name: string): Promise<HTMLElement> {
  const buttons = await screen.findAllByRole('button', { name })
  const inRow = buttons.find((button) => button.closest('tr'))
  if (!inRow) throw new Error(`[internal] no row button named ${name}`)
  return inRow
}

describe('AuditLogsActions row controls', () => {
  beforeEach(() => {
    ;(apiCallOrThrow as jest.Mock).mockReset()
  })

  it('runs the undo without opening the details dialog when the row Undo icon is clicked', async () => {
    ;(apiCallOrThrow as jest.Mock).mockResolvedValue({ ok: true })
    const onRefresh = jest.fn().mockResolvedValue(undefined)
    renderWithProviders(<AuditLogsActions items={[baseItem]} onRefresh={onRefresh} />, {
      dict: { 'audit_logs.actions.undo': 'Undo row' },
    })

    fireEvent.click(await findRowButton('Undo row'))

    await waitFor(() => expect(apiCallOrThrow).toHaveBeenCalledWith(
      '/api/audit_logs/audit-logs/actions/undo',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ undoToken: 'undo-token-1' }) }),
      expect.anything(),
    ))
    await waitFor(() => expect(onRefresh).toHaveBeenCalled())
    expect(screen.queryByTestId('action-log-details-dialog')).not.toBeInTheDocument()
  })

  it('surfaces a refused undo without opening the details dialog', async () => {
    ;(apiCallOrThrow as jest.Mock).mockRejectedValue(Object.assign(new Error('Undo failed'), { status: 409 }))
    const onUndoError = jest.fn()
    renderWithProviders(
      <AuditLogsActions items={[baseItem]} onRefresh={jest.fn()} onUndoError={onUndoError} />,
      { dict: { 'audit_logs.actions.undo': 'Undo row' } },
    )

    fireEvent.click(await findRowButton('Undo row'))

    await waitFor(() => expect(onUndoError).toHaveBeenCalledWith('Undo failed'))
    expect(screen.queryByTestId('action-log-details-dialog')).not.toBeInTheDocument()
  })

  it('does not open the details dialog when the row Redo icon is clicked', async () => {
    ;(apiCallOrThrow as jest.Mock).mockResolvedValue({ ok: true })
    const undoneItem: ActionLogItem = { ...baseItem, executionState: 'undone', undoToken: null }
    renderWithProviders(<AuditLogsActions items={[undoneItem]} onRefresh={jest.fn().mockResolvedValue(undefined)} />, {
      dict: { 'audit_logs.actions.redo': 'Redo row' },
    })

    fireEvent.click(await findRowButton('Redo row'))

    await waitFor(() => expect(apiCallOrThrow).toHaveBeenCalled())
    expect(screen.queryByTestId('action-log-details-dialog')).not.toBeInTheDocument()
  })

  it('still opens the details dialog when the row itself is clicked', async () => {
    renderWithProviders(<AuditLogsActions items={[baseItem]} onRefresh={jest.fn()} />, {
      dict: { 'audit_logs.actions.undo': 'Undo row' },
    })

    fireEvent.click(await screen.findByText('Delete product'))

    expect(await screen.findByTestId('action-log-details-dialog')).toHaveTextContent('log-1')
    expect(apiCallOrThrow).not.toHaveBeenCalled()
  })
})
