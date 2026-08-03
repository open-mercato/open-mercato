/** @jest-environment jsdom */
/**
 * Regression coverage for #3616: DataTable's useVirtualizer must run on every
 * render regardless of the `virtualized` prop (Rules of Hooks). Previously the
 * hook was called inside a ternary gated on `virtualized`, so toggling the prop
 * on a mounted table changed the hook count between renders and React threw
 * "Rendered more/fewer hooks than during the previous render", blanking the
 * entire table.
 */
import * as React from 'react'
import { render } from '@testing-library/react'
import { DataTable } from '../DataTable'
import type { ColumnDef } from '@tanstack/react-table'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
}))

jest.mock('../injection/useInjectionDataWidgets', () => ({
  useInjectionDataWidgets: () => ({ widgets: [], isLoading: false }),
}))

type Row = { id: string; name: string }

const columns: ColumnDef<Row>[] = [{ accessorKey: 'name', header: 'Name' }]
const data: Row[] = [
  { id: '1', name: 'Ada' },
  { id: '2', name: 'Zed' },
]

function renderTable(virtualized: boolean, queryClient: QueryClient) {
  return render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider locale="en" dict={{}}>
        <DataTable columns={columns} data={data} virtualized={virtualized} />
      </I18nProvider>
    </QueryClientProvider>,
  )
}

describe('DataTable virtualized hook stability (#3616)', () => {
  it('does not change hook count when toggling virtualized off → on', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } })
    try {
      const { rerender } = renderTable(false, queryClient)
      expect(() => {
        rerender(
          <QueryClientProvider client={queryClient}>
            <I18nProvider locale="en" dict={{}}>
              <DataTable columns={columns} data={data} virtualized />
            </I18nProvider>
          </QueryClientProvider>,
        )
      }).not.toThrow()
    } finally {
      queryClient.clear()
    }
  })

  it('does not change hook count when toggling virtualized on → off', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } })
    try {
      const { rerender } = renderTable(true, queryClient)
      expect(() => {
        rerender(
          <QueryClientProvider client={queryClient}>
            <I18nProvider locale="en" dict={{}}>
              <DataTable columns={columns} data={data} virtualized={false} />
            </I18nProvider>
          </QueryClientProvider>,
        )
      }).not.toThrow()
    } finally {
      queryClient.clear()
    }
  })

  it('still renders rows in the default non-virtualized mode', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } })
    try {
      const { container } = renderTable(false, queryClient)
      expect(container.textContent).toContain('Ada')
    } finally {
      queryClient.clear()
    }
  })
})
