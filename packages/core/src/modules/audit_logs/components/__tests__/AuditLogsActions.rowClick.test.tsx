/**
 * @jest-environment jsdom
 */

import '@testing-library/jest-dom'
import * as React from 'react'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
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
import polish from '../../i18n/pl.json'

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
      dict: { 'audit_logs.actions.undo_this': 'Undo row' },
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
      { dict: { 'audit_logs.actions.undo_this': 'Undo row' } },
    )

    fireEvent.click(await findRowButton('Undo row'))

    await waitFor(() => expect(onUndoError).toHaveBeenCalledWith('Undo failed'))
    expect(screen.queryByTestId('action-log-details-dialog')).not.toBeInTheDocument()
  })

  it('does not open the details dialog when the row Redo icon is clicked', async () => {
    ;(apiCallOrThrow as jest.Mock).mockResolvedValue({ ok: true })
    const undoneItem: ActionLogItem = { ...baseItem, executionState: 'undone', undoToken: null }
    renderWithProviders(<AuditLogsActions items={[undoneItem]} onRefresh={jest.fn().mockResolvedValue(undefined)} />, {
      dict: { 'audit_logs.actions.redo_this': 'Redo row' },
    })

    fireEvent.click(await findRowButton('Redo row'))

    await waitFor(() => expect(apiCallOrThrow).toHaveBeenCalled())
    expect(screen.queryByTestId('action-log-details-dialog')).not.toBeInTheDocument()
  })

  it('identifies records, summarizes changes, translates states and keeps native actions sticky', async () => {
    const createdAt = '2026-10-01T10:00:37.000Z'
    renderWithProviders(<AuditLogsActions items={[{
      ...baseItem,
      resourceKind: 'directory.organization',
      snapshotBefore: { view: { name: 'Organization A' } },
      snapshotAfter: { name: 'Organization B' },
      changes: { name: { from: 'Organization A', to: 'Organization B' } },
      createdAt,
    }]} onRefresh={jest.fn()} />, { dict: polish })

    const name = await screen.findByText('Organization B')
    const row = name.closest('tr')!
    expect(within(row).getByText('Nazwa: Organization A → Organization B')).toBeInTheDocument()
    expect(within(row).getByText(polish['audit_logs.version_history.status.done'])).toBeInTheDocument()
    expect(within(row).getByText(new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium', timeStyle: 'medium',
    }).format(new Date(createdAt)))).toBeInTheDocument()
    const undo = within(row).getByRole('button', { name: 'Cofnij to działanie' })
    expect(undo).toHaveAttribute('title', 'Cofnij to działanie')
    expect(undo.closest('td')).toHaveClass('md:sticky', 'md:right-0')
    expect(screen.getByRole('button', { name: polish['audit_logs.actions.undo'] })).toBeInTheDocument()
  })

  it('keeps the ID fallback and only enables the newest undo for each resource', async () => {
    renderWithProviders(<AuditLogsActions items={[baseItem, { ...baseItem, id: 'log-old', undoToken: 'old-token' }]}
      onRefresh={jest.fn()} />, { dict: polish })
    expect(await screen.findAllByText('catalog.product · product-1')).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'Cofnij to działanie' })).toHaveLength(1)
  })

  it('still opens the details dialog when the row itself is clicked', async () => {
    renderWithProviders(<AuditLogsActions items={[baseItem]} onRefresh={jest.fn()} />, {
      dict: { 'audit_logs.actions.undo_this': 'Undo row' },
    })

    fireEvent.click(await screen.findByText('Delete product'))

    expect(await screen.findByTestId('action-log-details-dialog')).toHaveTextContent('log-1')
    expect(apiCallOrThrow).not.toHaveBeenCalled()
  })
})
