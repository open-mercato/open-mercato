/** @jest-environment jsdom */
import * as React from 'react'
import { DataTable } from '../DataTable'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { render } from '@testing-library/react'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
}))

jest.mock('../injection/useInjectionDataWidgets', () => ({
  useInjectionDataWidgets: () => ({ widgets: [], isLoading: false }),
}))

type Row = { id: string; title: string }

const tokensOf = (el: Element | null): string[] =>
  (el?.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)

// The header used to be a single non-wrapping `sm:flex-row` line. A title
// sitting next to a long action group (Create + Export + Refresh + injected
// toolbar buttons) had nothing but `min-w-0` holding it, so it collapsed to a
// sliver while the action buttons — which wrap on their own — spilled onto a
// second line and rendered over it. The row now wraps as a unit, the title
// keeps a 12rem floor, and the actions stay right-aligned in either layout.
describe('DataTable header row wrapping', () => {
  function renderHeaderTable() {
    const columns: ColumnDef<Row>[] = [{ accessorKey: 'title', header: 'Title' }]
    const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } })
    const result = render(
      <QueryClientProvider client={queryClient}>
        <I18nProvider locale="en" dict={{}}>
          <DataTable
            title="Documents"
            actions={<button type="button">Create document</button>}
            columns={columns}
            data={[{ id: '1', title: 'Solar rollout' }]}
          />
        </I18nProvider>
      </QueryClientProvider>,
    )
    return { ...result, queryClient }
  }

  function headerParts(container: HTMLElement) {
    const headerContent = Array.from(container.querySelectorAll('div')).find((el) =>
      tokensOf(el).includes('sm:flex-row'),
    ) ?? null
    return {
      headerContent,
      titleSlot: headerContent?.firstElementChild ?? null,
      actionsSlot: headerContent?.lastElementChild ?? null,
    }
  }

  it('lets the header row wrap instead of crushing the title', () => {
    const { container, queryClient } = renderHeaderTable()
    try {
      const { headerContent } = headerParts(container)
      expect(headerContent).not.toBeNull()
      expect(tokensOf(headerContent)).toEqual(
        expect.arrayContaining([
          'flex',
          'flex-col',
          'gap-2',
          'sm:flex-row',
          'sm:flex-wrap',
          'sm:items-center',
          'sm:justify-between',
        ]),
      )
    } finally {
      queryClient.clear()
    }
  })

  it('gives the title a wrap threshold instead of an unbounded shrink', () => {
    const { container, queryClient } = renderHeaderTable()
    try {
      const { titleSlot } = headerParts(container)
      expect(titleSlot?.textContent).toContain('Documents')
      expect(tokensOf(titleSlot)).toEqual(
        expect.arrayContaining(['flex-1', 'min-w-0', 'sm:basis-48']),
      )
    } finally {
      queryClient.clear()
    }
  })

  it('keeps the actions right-aligned once the row has wrapped', () => {
    const { container, queryClient } = renderHeaderTable()
    try {
      const { actionsSlot } = headerParts(container)
      expect(actionsSlot?.textContent).toContain('Create document')
      expect(tokensOf(actionsSlot)).toEqual(
        expect.arrayContaining([
          'flex',
          'flex-wrap',
          'items-center',
          'gap-2',
          'sm:ml-auto',
          'sm:justify-end',
        ]),
      )
    } finally {
      queryClient.clear()
    }
  })
})
