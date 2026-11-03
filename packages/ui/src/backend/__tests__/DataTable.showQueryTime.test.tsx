/** @jest-environment jsdom */
import * as React from 'react'
import { renderToString } from 'react-dom/server'
import { DataTable } from '../DataTable'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
}))

jest.mock('../injection/useInjectionDataWidgets', () => ({
  useInjectionDataWidgets: () => ({ widgets: [], isLoading: false }),
}))

type Row = { id: string; name: string }

function renderFooter(showQueryTime?: boolean): string {
  const columns: ColumnDef<Row>[] = [
    { accessorKey: 'name', header: 'Name' },
  ]
  const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } })
  try {
    return renderToString(
      React.createElement(
        QueryClientProvider as any,
        { client: queryClient },
        React.createElement(
          I18nProvider as any,
          { locale: 'en', dict: {} },
          React.createElement(DataTable as any, {
            columns,
            data: [{ id: '1', name: 'Ada' }],
            ...(showQueryTime === undefined ? {} : { showQueryTime }),
            pagination: {
              page: 1,
              pageSize: 20,
              total: 1,
              totalPages: 1,
              durationMs: 142,
              onPageChange: () => {},
            },
          }),
        ),
      )
    )
  } finally {
    queryClient.clear()
  }
}

describe('DataTable showQueryTime', () => {
  it('renders the query duration in the footer by default', () => {
    const html = renderFooter(undefined)
    expect(html).toContain('Showing 1 to 1 of 1 results in 142ms')
  })

  it('renders the count-only footer when showQueryTime is false', () => {
    const html = renderFooter(false)
    expect(html).toContain('Showing 1 to 1 of 1 results')
    expect(html).not.toContain('142ms')
    expect(html).not.toContain('results in')
  })

  it('renders the query duration when showQueryTime is explicitly true', () => {
    const html = renderFooter(true)
    expect(html).toContain('Showing 1 to 1 of 1 results in 142ms')
  })
})
