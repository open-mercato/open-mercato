/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { renderToString } from 'react-dom/server'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ColumnDef } from '@tanstack/react-table'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { DataTable } from '../DataTable'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn(), refresh: jest.fn() }),
}))

const useInjectionDataWidgetsMock = jest.fn()
const flashMock = jest.fn()
jest.mock('../injection/useInjectionDataWidgets', () => ({
  useInjectionDataWidgets: (spotId: string) => useInjectionDataWidgetsMock(spotId),
}))
jest.mock('../FlashMessages', () => ({
  flash: (...args: unknown[]) => flashMock(...args),
}))
jest.mock('../confirm-dialog', () => ({
  useConfirmDialog: () => ({
    confirm: jest.fn().mockResolvedValue(true),
    ConfirmDialogElement: null,
  }),
}))

type Row = { id: string; name: string }

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function renderTable(elementProps: Record<string, unknown>) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } })
  const view = render(
    React.createElement(
      QueryClientProvider as any,
      { client: queryClient },
      React.createElement(
        I18nProvider as any,
        { locale: 'en', dict: {} },
        React.createElement(DataTable as any, elementProps),
      ),
    ),
  )
  return {
    ...view,
    cleanupQueryClient: () => queryClient.clear(),
  }
}

describe('DataTable extensions', () => {
  beforeEach(() => {
    ;(globalThis as typeof globalThis & { ResizeObserver?: typeof ResizeObserverMock }).ResizeObserver = ResizeObserverMock
    useInjectionDataWidgetsMock.mockImplementation(() => ({ widgets: [], isLoading: false, error: null }))
    flashMock.mockReset()
  })

  it('renders injected columns from data-table extension surface', () => {
    useInjectionDataWidgetsMock.mockImplementation((spotId: string) => {
      if (spotId === 'data-table:customers.people:columns') {
        return {
          widgets: [
            {
              metadata: { id: 'test.columns' },
              columns: [
                {
                  id: 'ext_col',
                  header: 'Injected',
                  accessorKey: 'name',
                  sortable: false,
                },
              ],
            },
          ],
          isLoading: false,
          error: null,
        }
      }
      return { widgets: [], isLoading: false, error: null }
    })

    const columns: ColumnDef<Row>[] = [{ accessorKey: 'name', header: 'Name' }]
    const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } })
    const html = renderToString(
      React.createElement(
        QueryClientProvider as any,
        { client: queryClient },
        React.createElement(
          I18nProvider as any,
          { locale: 'en', dict: {} },
          React.createElement(DataTable as any, {
            columns,
            data: [{ id: 'r1', name: 'Alice' }],
            injectionSpotId: 'data-table:customers.people',
          }),
        ),
      ),
    )

    expect(html).toContain('Injected')
    queryClient.clear()
  })

  it('renders injected bulk action button when bulk extension exists', () => {
    useInjectionDataWidgetsMock.mockImplementation((spotId: string) => {
      if (spotId === 'data-table:customers.people:bulk-actions') {
        return {
          widgets: [
            {
              metadata: { id: 'test.bulk-actions' },
              bulkActions: [
                {
                  id: 'bulk-normal',
                  label: 'Set normal',
                  onExecute: async () => ({ ok: true }),
                },
              ],
            },
          ],
          isLoading: false,
          error: null,
        }
      }
      return { widgets: [], isLoading: false, error: null }
    })

    const columns: ColumnDef<Row>[] = [{ accessorKey: 'name', header: 'Name' }]
    const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } })
    const html = renderToString(
      React.createElement(
        QueryClientProvider as any,
        { client: queryClient },
        React.createElement(
          I18nProvider as any,
          { locale: 'en', dict: {} },
          React.createElement(DataTable as any, {
            columns,
            data: [{ id: 'r1', name: 'Alice' }],
            injectionSpotId: 'data-table:customers.people',
          }),
        ),
      ),
    )

    expect(html).toContain('Set normal')
    expect(html).toContain('Select all rows')
    queryClient.clear()
  })

  it('allows filter-scope bulk actions without selected rows and forwards injection context', async () => {
    const onExecute = jest.fn(async () => ({ ok: true }))
    useInjectionDataWidgetsMock.mockImplementation((spotId: string) => {
      if (spotId === 'data-table:customers.people:bulk-actions') {
        return {
          widgets: [
            {
              metadata: { id: 'test.bulk-actions' },
              bulkActions: [
                {
                  id: 'bulk-delete-filtered',
                  label: 'Delete all filtered',
                  requiresSelection: false,
                  onExecute,
                },
              ],
            },
          ],
          isLoading: false,
          error: null,
        }
      }
      return { widgets: [], isLoading: false, error: null }
    })

    const columns: ColumnDef<Row>[] = [{ accessorKey: 'name', header: 'Name' }]
    const rendered = renderTable({
      columns,
      data: [{ id: 'r1', name: 'Alice' }],
      injectionSpotId: 'data-table:customers.people',
      injectionContext: { search: 'alice', filters: { isActive: true } },
    })

    try {
      const button = screen.getByRole('button', { name: 'Delete all filtered' })
      expect(button).toBeEnabled()

      fireEvent.click(button)

      await waitFor(() => expect(onExecute).toHaveBeenCalledTimes(1))
      expect(onExecute).toHaveBeenCalledWith(
        [],
        expect.objectContaining({
          tableId: 'customers.people',
          injectionContext: { search: 'alice', filters: { isActive: true } },
          confirm: expect.any(Function),
          translate: expect.any(Function),
        }),
      )
      expect(flashMock).toHaveBeenCalledWith('Bulk action completed.', 'success')
    } finally {
      rendered.cleanupQueryClient()
    }
  })

  it('acknowledges bulk action progress jobs without local polling', async () => {
    const onExecute = jest.fn(async () => ({ ok: true, progressJobId: 'job-1' }))

    useInjectionDataWidgetsMock.mockImplementation((spotId: string) => {
      if (spotId === 'data-table:customers.people:bulk-actions') {
        return {
          widgets: [
            {
              metadata: { id: 'test.bulk-actions' },
              bulkActions: [
                {
                  id: 'bulk-delete-filtered',
                  label: 'Delete all filtered',
                  requiresSelection: false,
                  onExecute,
                },
              ],
            },
          ],
          isLoading: false,
          error: null,
        }
      }
      return { widgets: [], isLoading: false, error: null }
    })

    const rendered = renderTable({
      columns: [{ accessorKey: 'name', header: 'Name' }],
      data: [{ id: 'r1', name: 'Alice' }],
      injectionSpotId: 'data-table:customers.people',
    })

    try {
      const button = screen.getByRole('button', { name: 'Delete all filtered' })
      fireEvent.click(button)

      await waitFor(() => expect(onExecute).toHaveBeenCalledTimes(1))
      expect(flashMock).toHaveBeenCalledWith('Bulk action started. Track progress in the top bar.', 'success')
      expect(screen.queryByText('1 / 2')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Delete all filtered' })).toBeEnabled()
    } finally {
      rendered.cleanupQueryClient()
    }
  })
})
