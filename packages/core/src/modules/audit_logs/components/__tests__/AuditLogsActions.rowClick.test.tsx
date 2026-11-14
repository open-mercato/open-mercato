/**
 * @jest-environment jsdom
 */

import '@testing-library/jest-dom'
import * as React from 'react'
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import type { InjectionRowActionWidget } from '@open-mercato/shared/modules/widgets/injection'
import { InjectionPosition } from '@open-mercato/shared/modules/widgets/injection-position'
import { formatDisplayDateTime } from '@open-mercato/ui/primitives/date-format'
import type { ModuleInjectionWidgetEntry } from '@open-mercato/shared/modules/registry'
import { registerCoreInjectionTables, registerCoreInjectionWidgets, registerEnabledModuleIds } from '@open-mercato/shared/modules/widgets/injection-loader'

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

const mockPermissions = {
  currentUserId: 'user-1',
  canViewTenant: true,
  canUndoSelf: true,
  canUndoTenant: true,
  canRedoSelf: true,
  canRedoTenant: true,
  isLoading: false,
}

jest.mock('@open-mercato/ui/backend/version-history', () => {
  const actual = jest.requireActual('@open-mercato/ui/backend/version-history')
  return {
    ...actual,
    useAuditPermissions: () => mockPermissions,
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

function registerRowWidget(widget?: InjectionRowActionWidget) {
  const entries: ModuleInjectionWidgetEntry[] = widget ? [{
    moduleId: 'test', key: widget.metadata.id, widgetId: widget.metadata.id, source: 'package', loader: async () => widget,
  }] : []
  registerCoreInjectionWidgets(entries)
  registerCoreInjectionTables([{
    moduleId: 'test',
    table: widget ? { 'data-table:audit_logs.actions.list:row-actions': widget.metadata.id } : {},
  }], entries)
  registerEnabledModuleIds(['audit_logs', 'test'])
}

function addInspectAction(onSelect = jest.fn(), relativeTo?: string) {
  registerRowWidget({
    metadata: { id: 'test.audit-row-action' },
    rowActions: [{
      id: 'test.inspect', label: 'Inspect record', onSelect,
      placement: relativeTo ? { position: InjectionPosition.Before, relativeTo } : undefined,
    }],
  })
  return onSelect
}

describe('AuditLogsActions row controls', () => {
  beforeEach(() => {
    ;(apiCallOrThrow as jest.Mock).mockReset()
    Object.assign(mockPermissions, { canUndoSelf: true, canUndoTenant: true, canRedoSelf: true, canRedoTenant: true })
    registerRowWidget()
  })

  afterEach(() => {
    cleanup()
    registerRowWidget()
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
    expect(within(row).getByText(formatDisplayDateTime(createdAt, 'en')!)).toBeInTheDocument()
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

  it.each(['done', 'undone'] as const)('keeps native and contributed actions together for an eligible %s row', async (executionState) => {
    const operation = executionState === 'done' ? 'undo' : 'redo'
    const onInspect = addInspectAction(jest.fn(), operation)
    ;(apiCallOrThrow as jest.Mock).mockResolvedValue({ ok: true })
    const onRefresh = jest.fn().mockResolvedValue(undefined)
    const item = { ...baseItem, executionState }
    renderWithProviders(<AuditLogsActions items={[item]} onRefresh={onRefresh} />, {
      dict: { 'audit_logs.actions.undo_this': 'Undo this action', 'audit_logs.actions.redo_this': 'Redo this action' },
    })

    const trigger = await findRowButton('Open actions')
    expect(trigger.closest('td')).toHaveClass('md:sticky', 'md:right-0')
    fireEvent.click(trigger)
    const label = executionState === 'done' ? 'Undo this action' : 'Redo this action'
    expect(await screen.findByRole('menuitem', { name: label })).toBeInTheDocument()
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Inspect record', label])
    fireEvent.click(screen.getByRole('menuitem', { name: 'Inspect record' }))
    expect(onInspect).toHaveBeenCalledWith(item, expect.objectContaining({ navigate: expect.any(Function) }))
    expect(apiCallOrThrow).not.toHaveBeenCalled()
    expect(screen.queryByTestId('action-log-details-dialog')).not.toBeInTheDocument()

    fireEvent.click(await findRowButton('Open actions'))
    fireEvent.click(await screen.findByRole('menuitem', { name: label }))
    const body = executionState === 'done' ? { undoToken: item.undoToken } : { logId: item.id }
    await waitFor(() => expect(apiCallOrThrow).toHaveBeenCalledWith(
      `/api/audit_logs/audit-logs/actions/${operation}`,
      expect.objectContaining({ method: 'POST', body: JSON.stringify(body) }),
      expect.anything(),
    ))
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1))
    expect(apiCallOrThrow).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('action-log-details-dialog')).not.toBeInTheDocument()
  })

  it.each(['done', 'undone'] as const)('does not grant denied %s operations through contributed actions', async (executionState) => {
    Object.assign(mockPermissions, { canUndoSelf: false, canUndoTenant: false, canRedoSelf: false, canRedoTenant: false })
    const onInspect = addInspectAction()
    renderWithProviders(<AuditLogsActions items={[{ ...baseItem, executionState }]} onRefresh={jest.fn()} />, {
      dict: { 'audit_logs.actions.undo_this': 'Undo this action', 'audit_logs.actions.redo_this': 'Redo this action' },
    })

    fireEvent.click(await findRowButton('Open actions'))
    const inspect = await screen.findByRole('menuitem', { name: 'Inspect record' })
    expect(screen.getAllByRole('menuitem')).toEqual([inspect])
    fireEvent.click(inspect)
    expect(onInspect).toHaveBeenCalledTimes(1)
    expect(apiCallOrThrow).not.toHaveBeenCalled()
    expect(screen.queryByTestId('action-log-details-dialog')).not.toBeInTheDocument()
  })

  it('keeps older redo controls disabled without widgets and unavailable in contributed menus', async () => {
    const items = [
      { ...baseItem, id: 'latest', actionLabel: 'Latest undone', executionState: 'undone', updatedAt: '2026-10-01T11:00:00.000Z' },
      { ...baseItem, id: 'older', actionLabel: 'Older undone', executionState: 'undone' },
    ]
    const options = { dict: { 'audit_logs.actions.redo_this': 'Redo this action' } }
    const view = renderWithProviders(<AuditLogsActions items={items} onRefresh={jest.fn()} />, options)
    const older = (await screen.findByText('Older undone')).closest('tr')!
    const disabledRedo = within(older).getByRole('button', { name: 'Redo this action' })
    expect(disabledRedo).toBeDisabled()
    fireEvent.click(disabledRedo)
    expect(apiCallOrThrow).not.toHaveBeenCalled()
    view.unmount()

    addInspectAction()
    renderWithProviders(<AuditLogsActions items={items} onRefresh={jest.fn()} />, options)
    const olderWithWidget = (await screen.findByText('Older undone')).closest('tr')!
    fireEvent.click(await within(olderWithWidget).findByRole('button', { name: 'Open actions' }))
    expect(await screen.findByRole('menuitem', { name: 'Inspect record' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Redo this action' })).not.toBeInTheDocument()
    expect(apiCallOrThrow).not.toHaveBeenCalled()
    expect(screen.queryByTestId('action-log-details-dialog')).not.toBeInTheDocument()
  })

  it('does not offer a second native operation while a contributed-menu undo is pending', async () => {
    addInspectAction()
    let finishUndo!: () => void
    const pendingUndo = new Promise<void>((resolve) => { finishUndo = resolve })
    ;(apiCallOrThrow as jest.Mock).mockReturnValue(pendingUndo)
    const onRefresh = jest.fn().mockResolvedValue(undefined)
    renderWithProviders(<AuditLogsActions items={[baseItem]} onRefresh={onRefresh} />, {
      dict: { 'audit_logs.actions.undo_this': 'Undo this action' },
    })

    try {
      fireEvent.click(await findRowButton('Open actions'))
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Undo this action' }))
      await waitFor(() => expect(apiCallOrThrow).toHaveBeenCalledTimes(1))
      const pendingTrigger = screen.queryByRole('button', { name: 'Open actions' })
      if (pendingTrigger) fireEvent.click(pendingTrigger)
      expect(screen.queryByRole('menuitem', { name: 'Undo this action' })).not.toBeInTheDocument()
      expect(screen.queryByRole('menuitem', { name: 'Redo this action' })).not.toBeInTheDocument()
      expect(onRefresh).not.toHaveBeenCalled()
      expect(screen.queryByTestId('action-log-details-dialog')).not.toBeInTheDocument()
    } finally {
      await act(async () => { finishUndo(); await pendingUndo })
    }
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1))
    expect(apiCallOrThrow).toHaveBeenCalledTimes(1)
  })
})
