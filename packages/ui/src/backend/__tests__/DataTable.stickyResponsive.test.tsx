/** @jest-environment jsdom */
import * as React from 'react'
import { DataTable } from '../DataTable'
import type { ColumnDef } from '@tanstack/react-table'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { render } from '@testing-library/react'
import { RowActions } from '../RowActions'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
}))

jest.mock('../injection/useInjectionDataWidgets', () => ({
  useInjectionDataWidgets: () => ({ widgets: [], isLoading: false }),
}))

type Row = { id: string; title: string; status: string }

const tokensOf = (el: Element | null): string[] =>
  (el?.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)

// Pinned columns must never consume the viewport on phones: an unconditionally
// `sticky` first column (often ~300px wide) plus a sticky actions column can
// exceed a small screen entirely, leaving the middle columns scrolling
// invisibly underneath with no reachable window. Pinning (position, offsets,
// z-index, opaque background, edge shadows) must therefore apply only from the
// `md` breakpoint up, so narrow viewports fall back to the documented plain
// horizontal-scroll behavior where every column can be swiped into view.
describe('DataTable sticky columns are viewport-gated', () => {
  function renderStickyTable() {
    const columns: ColumnDef<Row>[] = [
      { accessorKey: 'title', header: 'Title' },
      { accessorKey: 'status', header: 'Status' },
    ]
    const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } })
    const result = render(
      <QueryClientProvider client={queryClient}>
        <I18nProvider locale="en" dict={{}}>
          <DataTable
            columns={columns}
            data={[{ id: '1', title: 'Solar rollout', status: 'open' }]}
            stickyFirstColumn
            stickyActionsColumn
            rowActions={() => (
              <RowActions items={[{ id: 'edit', label: 'Edit', onSelect: () => {} }]} />
            )}
          />
        </I18nProvider>
      </QueryClientProvider>,
    )
    return { ...result, queryClient }
  }

  it('pins the first data column only from md up', () => {
    const { container, queryClient } = renderStickyTable()
    try {
      const headerCells = container.querySelectorAll('thead th')
      const firstHeader = headerCells[0]
      const firstBodyCell = container.querySelector('tbody tr td')

      for (const cell of [firstHeader, firstBodyCell]) {
        const tokens = tokensOf(cell)
        expect(tokens).toEqual(
          expect.arrayContaining(['md:sticky', 'md:left-0', 'md:bg-background', 'md:after:absolute']),
        )
        expect(tokens).not.toContain('sticky')
        expect(tokens).not.toContain('left-0')
        expect(tokens).not.toContain('bg-background')
        expect(tokens).not.toContain('after:absolute')
      }
    } finally {
      queryClient.clear()
    }
  })

  it('pins the actions column only from md up', () => {
    const { container, queryClient } = renderStickyTable()
    try {
      const headerCells = container.querySelectorAll('thead th')
      const actionsHeader = headerCells[headerCells.length - 1]
      const actionsBodyCell = container.querySelector('tbody tr td[data-actions-cell]')
      expect(actionsBodyCell).not.toBeNull()

      for (const cell of [actionsHeader, actionsBodyCell]) {
        const tokens = tokensOf(cell)
        expect(tokens).toEqual(
          expect.arrayContaining(['md:sticky', 'md:right-0', 'md:bg-background', 'md:before:absolute']),
        )
        expect(tokens).not.toContain('sticky')
        expect(tokens).not.toContain('right-0')
        expect(tokens).not.toContain('bg-background')
        expect(tokens).not.toContain('before:absolute')
      }
    } finally {
      queryClient.clear()
    }
  })
})
