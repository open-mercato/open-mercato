import * as React from 'react'
import { renderToString } from 'react-dom/server'
import type { ColumnDef } from '@tanstack/react-table'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { DataTable } from '../DataTable'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn(), refresh: jest.fn() }),
}))

const useInjectionDataWidgetsMock = jest.fn()
jest.mock('../injection/useInjectionDataWidgets', () => ({
  useInjectionDataWidgets: (spotId: string) => useInjectionDataWidgetsMock(spotId),
}))

type Row = { id: string; name: string }

describe('DataTable extensions', () => {
  beforeEach(() => {
    useInjectionDataWidgetsMock.mockImplementation(() => ({ widgets: [], isLoading: false, error: null }))
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
})
