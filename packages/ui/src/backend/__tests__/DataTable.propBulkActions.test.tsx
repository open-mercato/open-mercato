/**
 * @jest-environment jsdom
 *
 * Host-owned bulk actions (the `bulkActions` prop).
 *
 * `progress/AGENTS.md` requires a server-queued bulk action to return
 * `{ ok, progressJobId }` so the top bar can track it, and `ui/AGENTS.md`
 * forbids a page from building its own progress bar instead. The prop path used
 * to DISCARD that result entirely: no toast, no tracking, and a rejected
 * promise became an unhandled rejection. This file pins the fix — and pins the
 * `void` / `true` / `false` returns to their previous behaviour, because the
 * existing callers flash from their own bulk helper and a second toast would be
 * a regression.
 */
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ColumnDef } from '@tanstack/react-table'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { DataTable } from '../DataTable'

const mockRouterRefresh = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn(), refresh: mockRouterRefresh }),
}))

const flashMock = jest.fn()
jest.mock('../FlashMessages', () => ({
  flash: (...args: unknown[]) => flashMock(...args),
}))
jest.mock('../confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: jest.fn().mockResolvedValue(true), ConfirmDialogElement: null }),
}))

type Row = { id: string; name: string }

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function renderTable(props: Record<string, unknown>) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } })
  const view = render(
    React.createElement(
      QueryClientProvider as any,
      { client: queryClient },
      React.createElement(
        I18nProvider as any,
        { locale: 'en', dict: {} },
        React.createElement(DataTable as any, props)
      )
    )
  )
  return { ...view, cleanupQueryClient: () => queryClient.clear() }
}

const columns: ColumnDef<Row>[] = [{ accessorKey: 'name', header: 'Name' }]

async function selectAllAndRun(label: string) {
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select all rows' }))
  await waitFor(() => expect(screen.getByText('1 selected')).toBeInTheDocument())
  fireEvent.click(screen.getByRole('button', { name: label }))
}

describe('DataTable prop bulk actions', () => {
  beforeEach(() => {
    ;(globalThis as typeof globalThis & { ResizeObserver?: typeof ResizeObserverMock }).ResizeObserver =
      ResizeObserverMock
    flashMock.mockReset()
    mockRouterRefresh.mockReset()
  })

  it('tracks a queued action that returns a progressJobId and says so', async () => {
    const rendered = renderTable({
      columns,
      data: [{ id: 'r1', name: 'Alice' }],
      bulkActions: [
        {
          id: 'replay',
          label: 'Replay',
          onExecute: async () => ({ ok: true, progressJobId: 'job-1' }),
        },
      ],
    })

    try {
      await selectAllAndRun('Replay')
      await waitFor(() =>
        expect(flashMock).toHaveBeenCalledWith(
          'Bulk action started. Track progress in the top bar.',
          'success'
        )
      )
      // A queued action must NOT also trigger an immediate refresh — the work
      // has not happened yet.
      expect(mockRouterRefresh).not.toHaveBeenCalled()
      await waitFor(() => expect(screen.queryByText('1 selected')).not.toBeInTheDocument())
    } finally {
      rendered.cleanupQueryClient()
    }
  })

  it('surfaces a failure result as an error flash instead of swallowing it', async () => {
    const rendered = renderTable({
      columns,
      data: [{ id: 'r1', name: 'Alice' }],
      bulkActions: [
        { id: 'replay', label: 'Replay', onExecute: async () => ({ ok: false, message: 'Nope' }) },
      ],
    })

    try {
      await selectAllAndRun('Replay')
      await waitFor(() => expect(flashMock).toHaveBeenCalledWith('Nope', 'error'))
      // A failed action keeps the selection so the operator can retry.
      expect(screen.getByText('1 selected')).toBeInTheDocument()
    } finally {
      rendered.cleanupQueryClient()
    }
  })

  it('flashes a thrown error rather than leaving an unhandled rejection', async () => {
    const rendered = renderTable({
      columns,
      data: [{ id: 'r1', name: 'Alice' }],
      bulkActions: [
        {
          id: 'replay',
          label: 'Replay',
          onExecute: async () => {
            throw new Error('boom')
          },
        },
      ],
    })

    try {
      await selectAllAndRun('Replay')
      await waitFor(() => expect(flashMock).toHaveBeenCalledWith('boom', 'error'))
    } finally {
      rendered.cleanupQueryClient()
    }
  })

  it('reports and refreshes for a synchronous result that completed inline', async () => {
    const rendered = renderTable({
      columns,
      data: [{ id: 'r1', name: 'Alice' }],
      bulkActions: [
        { id: 'replay', label: 'Replay', onExecute: async () => ({ ok: true, affectedCount: 1 }) },
      ],
    })

    try {
      await selectAllAndRun('Replay')
      await waitFor(() => expect(flashMock).toHaveBeenCalledWith('Bulk action completed.', 'success'))
      await waitFor(() => expect(mockRouterRefresh).toHaveBeenCalled())
    } finally {
      rendered.cleanupQueryClient()
    }
  })

  it('leaves a void-returning action exactly as it was — no second toast', async () => {
    const onExecute = jest.fn(async () => {})
    const rendered = renderTable({
      columns,
      data: [{ id: 'r1', name: 'Alice' }],
      bulkActions: [{ id: 'delete', label: 'Delete selected', onExecute }],
    })

    try {
      await selectAllAndRun('Delete selected')
      await waitFor(() => expect(onExecute).toHaveBeenCalled())
      await waitFor(() => expect(screen.queryByText('1 selected')).not.toBeInTheDocument())
      expect(flashMock).not.toHaveBeenCalled()
      expect(mockRouterRefresh).not.toHaveBeenCalled()
    } finally {
      rendered.cleanupQueryClient()
    }
  })

  it('keeps the selection when the action returns false (a declined confirm)', async () => {
    const rendered = renderTable({
      columns,
      data: [{ id: 'r1', name: 'Alice' }],
      bulkActions: [{ id: 'delete', label: 'Delete selected', onExecute: async () => false }],
    })

    try {
      await selectAllAndRun('Delete selected')
      await waitFor(() => expect(screen.getByText('1 selected')).toBeInTheDocument())
      expect(flashMock).not.toHaveBeenCalled()
    } finally {
      rendered.cleanupQueryClient()
    }
  })
})
