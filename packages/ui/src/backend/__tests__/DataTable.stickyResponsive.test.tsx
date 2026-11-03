/** @jest-environment jsdom */
import * as React from 'react'
import { DataTable } from '../DataTable'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
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
  function renderStickyTable({ embedded = false }: { embedded?: boolean } = {}) {
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
            embedded={embedded}
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
          expect.arrayContaining(['md:sticky', 'md:left-0', 'md:bg-card', 'md:after:absolute']),
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

  // Pinned cells carry z-10/z-20 while the app top bar sits at `z-sticky`
  // (10). Without an isolated stacking context around the table, the pinned
  // actions column painted over the top bar while the page scrolled (#7063).
  it('confines pinned cell z-index to the table stacking context', () => {
    const { container, queryClient } = renderStickyTable()
    try {
      const table = container.querySelector('table')
      const scrollWrapper = table?.parentElement ?? null
      expect(tokensOf(scrollWrapper)).toContain('isolate')
      const pinned = container.querySelectorAll('[class*="md:sticky"]')
      expect(pinned.length).toBeGreaterThan(0)
      pinned.forEach((cell) => {
        expect(scrollWrapper?.contains(cell)).toBe(true)
      })
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
          expect.arrayContaining(['md:sticky', 'md:right-0', 'md:bg-card', 'md:before:absolute']),
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

  // A non-embedded table sits on its `bg-card` container. Pinned cells used to
  // paint `bg-background`, a darker band in the dark theme, and their opaque
  // fill hid the header strip and the row-hover tint behind them (#7414).
  it('paints pinned cells with the card surface and carries the header strip and row hover through', () => {
    const { container, queryClient } = renderStickyTable()
    try {
      const headerCells = Array.from(container.querySelectorAll('thead th'))
      const pinnedHeaders = [headerCells[0], headerCells[headerCells.length - 1]]
      const bodyRow = container.querySelector('tbody tr')
      const pinnedBodyCells = [
        container.querySelector('tbody tr td'),
        container.querySelector('tbody tr td[data-actions-cell]'),
      ]

      for (const cell of pinnedHeaders) {
        const tokens = tokensOf(cell)
        expect(tokens).toEqual(
          expect.arrayContaining(['md:bg-card', 'md:bg-linear-to-r', 'md:from-muted/40', 'md:to-muted/40']),
        )
        expect(tokens).not.toContain('md:bg-background')
      }

      expect(tokensOf(bodyRow)).toContain('group/row')
      for (const cell of pinnedBodyCells) {
        const tokens = tokensOf(cell)
        expect(tokens).toEqual(
          expect.arrayContaining([
            'md:bg-card',
            'md:group-hover/row:bg-linear-to-r',
            'md:group-hover/row:from-muted/30',
            'md:group-hover/row:to-muted/30',
          ]),
        )
        expect(tokens).not.toContain('md:bg-background')
      }
    } finally {
      queryClient.clear()
    }
  })

  it('keeps the page surface on pinned cells of an embedded table but still carries the tints', () => {
    const { container, queryClient } = renderStickyTable({ embedded: true })
    try {
      const actionsHeader = Array.from(container.querySelectorAll('thead th')).pop() ?? null
      const actionsBodyCell = container.querySelector('tbody tr td[data-actions-cell]')

      expect(tokensOf(actionsHeader)).toEqual(
        expect.arrayContaining(['md:bg-background', 'md:from-muted/40']),
      )
      expect(tokensOf(actionsBodyCell)).toEqual(
        expect.arrayContaining(['md:bg-background', 'md:group-hover/row:from-muted/30']),
      )
      expect(tokensOf(actionsBodyCell)).not.toContain('md:bg-card')
    } finally {
      queryClient.clear()
    }
  })
})
