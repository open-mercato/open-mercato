/** @jest-environment jsdom */
import * as React from 'react'
import { DataTable } from '../DataTable'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { act, fireEvent, render } from '@testing-library/react'
import { RowActions } from '../RowActions'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
}))

jest.mock('../injection/useInjectionDataWidgets', () => ({
  useInjectionDataWidgets: () => ({ widgets: [], isLoading: false }),
}))

type Row = { id: string; title: string; status: string }

const LEFT_VISIBLE = 'md:after:opacity-100'
const RIGHT_VISIBLE = 'md:before:opacity-100'
const LEFT_HIDDEN = 'md:after:opacity-0'
const RIGHT_HIDDEN = 'md:before:opacity-0'

const tokensOf = (el: Element | null): string[] =>
  (el?.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)

function setScrollMetrics(el: HTMLElement, metrics: { scrollWidth: number; clientWidth: number; scrollLeft: number }) {
  Object.defineProperty(el, 'scrollWidth', { configurable: true, value: metrics.scrollWidth })
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: metrics.clientWidth })
  Object.defineProperty(el, 'scrollLeft', { configurable: true, writable: true, value: metrics.scrollLeft })
  act(() => {
    fireEvent.scroll(el)
  })
}

// Pinned-column shadows signal content hidden under the pinned column, so they
// must only be visible while something is actually scrolled underneath them.
describe('DataTable pinned-column shadows follow horizontal overflow', () => {
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
    const container = result.container
    const scrollEl = container.querySelector('table')?.parentElement as HTMLElement
    const headerCells = Array.from(container.querySelectorAll('thead th'))
    const leftCells = () => [
      container.querySelectorAll('thead th')[0],
      container.querySelector('tbody tr td'),
    ]
    const rightCells = () => {
      const headers = container.querySelectorAll('thead th')
      return [headers[headers.length - 1], container.querySelector('tbody tr td[data-actions-cell]')]
    }
    expect(headerCells.length).toBeGreaterThan(1)
    return { queryClient, scrollEl, leftCells, rightCells }
  }

  function expectShadows(
    cells: { leftCells: () => (Element | null)[]; rightCells: () => (Element | null)[] },
    expected: { left: boolean; right: boolean },
  ) {
    for (const cell of cells.leftCells()) {
      const tokens = tokensOf(cell)
      expect(tokens).toContain(expected.left ? LEFT_VISIBLE : LEFT_HIDDEN)
      expect(tokens).not.toContain(expected.left ? LEFT_HIDDEN : LEFT_VISIBLE)
    }
    for (const cell of cells.rightCells()) {
      const tokens = tokensOf(cell)
      expect(tokens).toContain(expected.right ? RIGHT_VISIBLE : RIGHT_HIDDEN)
      expect(tokens).not.toContain(expected.right ? RIGHT_HIDDEN : RIGHT_VISIBLE)
    }
  }

  it('shows only the right shadow at the scroll start', () => {
    const view = renderStickyTable()
    try {
      setScrollMetrics(view.scrollEl, { scrollWidth: 1200, clientWidth: 600, scrollLeft: 0 })
      expectShadows(view, { left: false, right: true })
    } finally {
      view.queryClient.clear()
    }
  })

  it('shows both shadows mid-scroll', () => {
    const view = renderStickyTable()
    try {
      setScrollMetrics(view.scrollEl, { scrollWidth: 1200, clientWidth: 600, scrollLeft: 300 })
      expectShadows(view, { left: true, right: true })
    } finally {
      view.queryClient.clear()
    }
  })

  it('shows only the left shadow at the scroll end', () => {
    const view = renderStickyTable()
    try {
      setScrollMetrics(view.scrollEl, { scrollWidth: 1200, clientWidth: 600, scrollLeft: 600 })
      expectShadows(view, { left: true, right: false })
    } finally {
      view.queryClient.clear()
    }
  })

  it('shows no shadows when every column fits', () => {
    const view = renderStickyTable()
    try {
      setScrollMetrics(view.scrollEl, { scrollWidth: 600, clientWidth: 600, scrollLeft: 0 })
      expectShadows(view, { left: false, right: false })
    } finally {
      view.queryClient.clear()
    }
  })

  it('re-measures when the table grows without a scroll event', () => {
    const originalResizeObserver = globalThis.ResizeObserver
    const observed = new Set<Element>()
    const callbacks: ResizeObserverCallback[] = []
    class FakeResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        callbacks.push(callback)
      }
      observe(target: Element) {
        observed.add(target)
      }
      unobserve(target: Element) {
        observed.delete(target)
      }
      disconnect() {}
    }
    globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver
    const view = renderStickyTable()
    try {
      expect(observed.has(view.scrollEl)).toBe(true)
      expect(observed.has(view.scrollEl.querySelector('table') as Element)).toBe(true)

      setScrollMetrics(view.scrollEl, { scrollWidth: 1200, clientWidth: 600, scrollLeft: 600 })
      expectShadows(view, { left: true, right: false })

      Object.defineProperty(view.scrollEl, 'scrollWidth', { configurable: true, value: 1500 })
      act(() => {
        callbacks.forEach((callback) => callback([], {} as ResizeObserver))
      })
      expectShadows(view, { left: true, right: true })
    } finally {
      view.queryClient.clear()
      globalThis.ResizeObserver = originalResizeObserver
    }
  })
})
