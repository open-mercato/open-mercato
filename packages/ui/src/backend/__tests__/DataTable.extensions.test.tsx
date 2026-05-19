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
import { APP_EVENT_DOM_NAME } from '../injection/useAppEvent'

const mockRouterRefresh = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn(), refresh: mockRouterRefresh }),
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
  const renderElement = (props: Record<string, unknown>) => React.createElement(
    QueryClientProvider as any,
    { client: queryClient },
    React.createElement(
      I18nProvider as any,
      { locale: 'en', dict: {} },
      React.createElement(DataTable as any, props),
    ),
  )
  const view = render(
    renderElement(elementProps),
  )
  return {
    ...view,
    rerenderTable: (nextProps: Record<string, unknown>) => view.rerender(renderElement(nextProps)),
    cleanupQueryClient: () => queryClient.clear(),
  }
}

describe('DataTable extensions', () => {
  beforeEach(() => {
    ;(globalThis as typeof globalThis & { ResizeObserver?: typeof ResizeObserverMock }).ResizeObserver = ResizeObserverMock
    useInjectionDataWidgetsMock.mockImplementation(() => ({ widgets: [], isLoading: false, error: null }))
    flashMock.mockReset()
    mockRouterRefresh.mockReset()
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

  it('refreshes the table when a tracked bulk action progress job completes', async () => {
    const onExecute = jest.fn(async () => ({ ok: true, progressJobId: 'job-1' }))
    const refreshButtonMock = jest.fn()

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
      refreshButton: { label: 'Refresh', onRefresh: refreshButtonMock },
    })

    try {
      fireEvent.click(screen.getByRole('button', { name: 'Delete all filtered' }))

      await waitFor(() => expect(onExecute).toHaveBeenCalledTimes(1))
      refreshButtonMock.mockClear()
      mockRouterRefresh.mockClear()

      window.dispatchEvent(new CustomEvent(APP_EVENT_DOM_NAME, {
        detail: {
          id: 'progress.job.completed',
          payload: { jobId: 'job-1' },
          timestamp: Date.now(),
          organizationId: 'org-1',
        },
      }))

      await waitFor(() => expect(refreshButtonMock).toHaveBeenCalledTimes(1))
      expect(mockRouterRefresh).not.toHaveBeenCalled()
    } finally {
      rendered.cleanupQueryClient()
    }
  })

  it('clears selection when selectionScopeKey changes', async () => {
    const rendered = renderTable({
      columns: [{ accessorKey: 'name', header: 'Name' }],
      data: [{ id: 'r1', name: 'Alice' }],
      bulkActions: [{ id: 'bulk', label: 'Bulk', onExecute: jest.fn() }],
      selectionScopeKey: 'scope-1',
    })

    try {
      fireEvent.click(screen.getByRole('checkbox', { name: 'Select all rows' }))

      await waitFor(() => expect(screen.getByText('1 selected')).toBeInTheDocument())

      rendered.rerenderTable({
        columns: [{ accessorKey: 'name', header: 'Name' }],
        data: [{ id: 'r1', name: 'Alice' }],
        bulkActions: [{ id: 'bulk', label: 'Bulk', onExecute: jest.fn() }],
        selectionScopeKey: 'scope-2',
      })

      await waitFor(() => expect(screen.queryByText('1 selected')).not.toBeInTheDocument())
    } finally {
      rendered.cleanupQueryClient()
    }
  })

  it('keeps selection unchanged when selectionScopeKey is omitted', async () => {
    const rendered = renderTable({
      columns: [{ accessorKey: 'name', header: 'Name' }],
      data: [{ id: 'r1', name: 'Alice' }],
      bulkActions: [{ id: 'bulk', label: 'Bulk', onExecute: jest.fn() }],
    })

    try {
      fireEvent.click(screen.getByRole('checkbox', { name: 'Select all rows' }))

      await waitFor(() => expect(screen.getByText('1 selected')).toBeInTheDocument())

      rendered.rerenderTable({
        columns: [{ accessorKey: 'name', header: 'Name' }],
        data: [{ id: 'r1', name: 'Alice' }],
        bulkActions: [{ id: 'bulk', label: 'Bulk', onExecute: jest.fn() }],
        title: 'Messages',
      })

      await waitFor(() => expect(screen.getByText('1 selected')).toBeInTheDocument())
    } finally {
      rendered.cleanupQueryClient()
    }
  })

  it('applies sticky positioning to the actions column when enabled', () => {
    const rendered = renderTable({
      columns: [{ accessorKey: 'name', header: 'Name' }],
      data: [{ id: 'r1', name: 'Alice' }],
      rowActions: () => <button type="button">Open</button>,
      stickyActionsColumn: true,
    })

    try {
      const actionsHeader = screen.getByRole('columnheader', { name: 'Actions' })
      expect(actionsHeader.className).toContain('sticky')
      expect(actionsHeader.className).toContain('right-0')

      const actionsCell = rendered.container.querySelector('[data-actions-cell]')
      expect(actionsCell).not.toBeNull()
      expect(actionsCell?.className).toContain('sticky')
      expect(actionsCell?.className).toContain('right-0')
    } finally {
      rendered.cleanupQueryClient()
    }
  })

  it('does not expose saved filters through the perspectives action row', async () => {
    const originalFetch = globalThis.fetch
    const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/auth/feature-check')) {
        return new Response(JSON.stringify({ granted: ['perspectives.use'] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      if (url.includes('/api/perspectives/customers.people.list')) {
        return new Response(JSON.stringify({
          tableId: 'customers.people.list',
          perspectives: [],
          rolePerspectives: [],
          roles: [],
          defaultPerspectiveId: null,
          canApplyToRoles: false,
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({}), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      })
    })
    ;(globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch

    const rendered = renderTable({
      columns: [{ accessorKey: 'name', header: 'Name' }],
      data: [{ id: 'r1', name: 'Alice' }],
      searchValue: '',
      onSearchChange: () => {},
      perspective: { tableId: 'customers.people.list' },
      advancedFilter: {
        value: {
          root: {
            id: 'root',
            type: 'group',
            combinator: 'and',
            children: [
              { id: 'rule-1', type: 'rule', field: 'name', operator: 'contains', value: 'Alice' },
            ],
          },
        },
        fields: [{ key: 'name', label: 'Name', type: 'text' }],
        onChange: () => {},
        onApply: () => {},
        onClear: () => {},
        externalPopover: true,
      },
    })

    try {
      await screen.findByRole('button', { name: /All views/ })
      expect(screen.queryByTestId('advanced-filter-save-trigger')).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Save filter' })).not.toBeInTheDocument()
      expect(fetchMock.mock.calls.some(([input, init]) =>
        String(input).includes('/api/perspectives/customers.people.list') && init?.method === 'POST'
      )).toBe(false)
    } finally {
      if (originalFetch) {
        globalThis.fetch = originalFetch
      } else {
        delete (globalThis as typeof globalThis & { fetch?: typeof fetch }).fetch
      }
      rendered.cleanupQueryClient()
    }
  })

  it('clears the advanced filter tree when No view is selected', async () => {
    const originalFetch = globalThis.fetch
    const savedTree = {
      v: 2,
      root: {
        id: 'saved-root',
        type: 'group',
        combinator: 'and',
        children: [
          { id: 'saved-rule', type: 'rule', field: 'name', operator: 'contains', value: 'Alice' },
        ],
      },
    }
    const perspectiveResponse = {
      tableId: 'customers.people.list.clear-test',
      perspectives: [
        {
          id: 'saved-filter-1',
          name: 'Owned leads',
          tableId: 'customers.people.list.clear-test',
          isDefault: false,
          settings: { filters: savedTree },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      rolePerspectives: [],
      roles: [],
      defaultPerspectiveId: null,
      canApplyToRoles: false,
    }
    const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/auth/feature-check')) {
        return new Response(JSON.stringify({ granted: ['perspectives.use'] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      if (url.includes('/api/perspectives/customers.people.list.clear-test')) {
        return new Response(JSON.stringify(perspectiveResponse), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({}), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      })
    })
    ;(globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch
    window.localStorage.clear()

    const onApplyTree = jest.fn()
    const rendered = renderTable({
      columns: [{ accessorKey: 'name', header: 'Name' }],
      data: [{ id: 'r1', name: 'Alice' }],
      searchValue: '',
      onSearchChange: () => {},
      perspective: {
        tableId: 'customers.people.list.clear-test',
        initialState: { response: perspectiveResponse },
      },
      advancedFilter: {
        value: savedTree,
        fields: [{ key: 'name', label: 'Name', type: 'text' }],
        onChange: () => {},
        onApply: () => {},
        onClear: () => {},
        externalPopover: true,
        onApplyTree,
      },
    })

    try {
      await waitFor(() => expect(onApplyTree).toHaveBeenCalled())
      const activeViewButton = await screen.findByRole('button', { name: /Owned leads/ })
      fireEvent.click(activeViewButton)
      fireEvent.click(screen.getByRole('button', { name: /No view/ }))

      await waitFor(() => {
        const calls = onApplyTree.mock.calls
        const lastTree = calls[calls.length - 1]?.[0]
        expect(lastTree?.root.children).toHaveLength(0)
      })
      await waitFor(() => expect(screen.getByRole('button', { name: /All views/ })).toBeInTheDocument())
      const calls = onApplyTree.mock.calls
      expect(calls[calls.length - 1]?.[0]?.root.children).toHaveLength(0)
    } finally {
      if (originalFetch) {
        globalThis.fetch = originalFetch
      } else {
        delete (globalThis as typeof globalThis & { fetch?: typeof fetch }).fetch
      }
      rendered.cleanupQueryClient()
    }
  })
})
