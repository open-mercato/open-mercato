/**
 * @jest-environment jsdom
 */
import { screen, waitFor } from '@testing-library/react'
import { fireEvent } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { VersionHistoryPanel } from '../version-history/VersionHistoryPanel'
import type { VersionHistoryEntry } from '../version-history/types'

const apiCallOrThrowMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCallOrThrow: (...args: unknown[]) => apiCallOrThrowMock(...args),
}))

const t = (key: string, fallbackOrParams?: string | Record<string, string | number>, params?: Record<string, string | number>) => {
  const fallback = typeof fallbackOrParams === 'string' ? fallbackOrParams : key
  const resolvedParams = typeof fallbackOrParams === 'string' ? params : fallbackOrParams
  if (!resolvedParams) return fallback
  return fallback.replace(/\{(\w+)\}/g, (_, token) => String(resolvedParams[token] ?? `{${token}}`))
}

describe('VersionHistoryPanel', () => {
  it('renders related-entry action rows with wrapping auto-height button layout', () => {
    const entry: VersionHistoryEntry = {
      id: 'log-1',
      commandId: 'customers.interaction.create',
      actionLabel: 'Create interaction',
      executionState: 'done',
      actorUserId: 'user-1',
      actorUserName: 'superadmin@acme.com',
      resourceKind: 'customers.interaction',
      resourceId: 'interaction-1',
      parentResourceKind: 'customers.person',
      parentResourceId: 'person-1',
      undoToken: null,
      createdAt: '2026-03-30T20:09:00.000Z',
      updatedAt: '2026-03-30T20:09:00.000Z',
      snapshotBefore: null,
      snapshotAfter: null,
      changes: null,
      context: null,
    }

    renderWithProviders(
      <VersionHistoryPanel
        open
        onOpenChange={() => undefined}
        entries={[entry]}
        isLoading={false}
        error={null}
        hasMore={false}
        onLoadMore={() => undefined}
        t={t}
        canUndoRedo={false}
        autoCheckAcl={false}
      />,
    )

    const trigger = screen.getByText('Create interaction').closest('button')

    expect(trigger).not.toBeNull()
    expect(trigger).toHaveClass('h-auto')
    expect(trigger).toHaveClass('flex-col')
    expect(trigger).toHaveClass('items-start')
    expect(trigger).toHaveClass('justify-start')
    expect(trigger).toHaveClass('whitespace-normal')
  })

  it('renders undo trace entries with an explicit action label in list and detail views', () => {
    const entry: VersionHistoryEntry = {
      id: 'log-undo-1',
      commandId: 'customers.companies.update',
      actionLabel: 'Update company',
      executionState: 'done',
      actorUserId: 'user-1',
      actorUserName: 'superadmin@acme.com',
      resourceKind: 'customers.company',
      resourceId: 'company-1',
      parentResourceKind: null,
      parentResourceId: null,
      undoToken: null,
      createdAt: '2026-03-30T20:29:00.000Z',
      updatedAt: '2026-03-30T20:29:00.000Z',
      snapshotBefore: { displayName: 'Acme Updated' },
      snapshotAfter: { displayName: 'Acme' },
      changes: {
        displayName: { from: 'Acme Updated', to: 'Acme' },
      },
      context: { historyAction: 'undo' },
    }

    renderWithProviders(
      <VersionHistoryPanel
        open
        onOpenChange={() => undefined}
        entries={[entry]}
        isLoading={false}
        error={null}
        hasMore={false}
        onLoadMore={() => undefined}
        t={t}
        canUndoRedo={false}
        autoCheckAcl={false}
      />,
    )

    const rowTrigger = screen.getByRole('button', { name: /Undo update company/ })
    expect(rowTrigger).toBeInTheDocument()

    fireEvent.click(rowTrigger)

    expect(screen.getByText('Undo update company')).toBeInTheDocument()
  })

  describe('refused undo and redo', () => {
    const buildEntry = (overrides: Partial<VersionHistoryEntry>): VersionHistoryEntry => ({
      id: 'log-currency-1',
      commandId: 'currencies.currencies.update',
      actionLabel: 'Update currency',
      executionState: 'done',
      actorUserId: 'user-1',
      actorUserName: 'admin@acme.com',
      resourceKind: 'currencies.currency',
      resourceId: 'currency-1',
      parentResourceKind: null,
      parentResourceId: null,
      undoToken: 'undo-token-1',
      createdAt: '2026-10-13T10:00:00.000Z',
      updatedAt: '2026-10-13T10:00:00.000Z',
      snapshotBefore: null,
      snapshotAfter: null,
      changes: null,
      context: null,
      ...overrides,
    })

    const renderPanel = (entry: VersionHistoryEntry) => renderWithProviders(
      <VersionHistoryPanel
        open
        onOpenChange={() => undefined}
        entries={[entry]}
        isLoading={false}
        error={null}
        hasMore={false}
        onLoadMore={() => undefined}
        t={t}
        canUndoRedo
        autoCheckAcl={false}
      />,
    )

    beforeEach(() => {
      apiCallOrThrowMock.mockReset()
    })

    it('shows the server reason when the undo is refused', async () => {
      const refusal = Object.assign(new Error('This change can\'t be undone because it would leave the organization without a base currency.'), { status: 409 })
      apiCallOrThrowMock.mockRejectedValueOnce(refusal)

      renderPanel(buildEntry({}))
      fireEvent.click(screen.getByRole('button', { name: 'audit_logs.actions.undo' }))

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent('This change can\'t be undone because it would leave the organization without a base currency.')
      await waitFor(() => expect(screen.getByRole('button', { name: 'audit_logs.actions.undo' })).not.toBeDisabled())
    })

    it('falls back to the generic undo message when the request never reached the server', async () => {
      apiCallOrThrowMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))

      renderPanel(buildEntry({}))
      fireEvent.click(screen.getByRole('button', { name: 'audit_logs.actions.undo' }))

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent('audit_logs.error.undo')
      expect(alert).not.toHaveTextContent('Failed to fetch')
    })

    it('shows the server reason when the redo is refused', async () => {
      apiCallOrThrowMock.mockRejectedValueOnce(Object.assign(new Error('Redo refused by the server.'), { status: 409 }))

      renderPanel(buildEntry({ executionState: 'undone', undoToken: null }))
      fireEvent.click(screen.getByRole('button', { name: 'audit_logs.actions.redo' }))

      expect(await screen.findByRole('alert')).toHaveTextContent('Redo refused by the server.')
    })
  })
})
