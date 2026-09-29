/** @jest-environment jsdom */
import * as React from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
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

/**
 * The capped-count feature's risky half lives in the pager: `Pagination` decides
 * from `totalIsCapped` plus a `hasNextPage` that `DataTable` derives from the
 * rendered row count whether a row past the cap is reachable at all. The unit
 * tests on the primitive pin its own logic; these pin the wiring between a
 * capped list payload and that primitive, which is where a regression would
 * silently strand data while every other test stayed green.
 *
 * Derived from the manual UI QA on #5228: 31 rows behind a reported total of 3.
 */
type Row = { id: string; name: string }

const columns: ColumnDef<Row>[] = [{ accessorKey: 'name', header: 'Name' }]

const PAGE_SIZE = 20

function rows(count: number, offset = 0): Row[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `row-${offset + i + 1}`,
    name: `Row ${offset + i + 1}`,
  }))
}

function renderTable(pagination: Record<string, unknown>, data: Row[]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: 0, retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider locale="en" dict={{}}>
        <DataTable columns={columns as any} data={data} pagination={pagination as any} />
      </I18nProvider>
    </QueryClientProvider>,
  )
}

const info = () => document.querySelector('[data-slot="pagination-info"]')?.textContent ?? ''
const next = () => document.querySelector('[data-slot="pagination-next"]') as HTMLButtonElement | null
const last = () => document.querySelector('[data-slot="pagination-last"]')

describe('DataTable pagination with a capped total', () => {
  // The floor must read as a floor. A capped list showing "of 3 results" would
  // state a number the server explicitly refused to vouch for.
  it('renders the total as a floor and hides the jump-to-last control', () => {
    renderTable(
      { page: 1, pageSize: PAGE_SIZE, total: 3, totalPages: 1, totalIsCapped: true, onPageChange: jest.fn() },
      rows(PAGE_SIZE),
    )
    expect(info()).toBe('Showing 1 to 20 of 3+ results')
    // The jump would land on the floor's last page while presenting itself as
    // the end of the data, which is precisely the lie this feature must avoid.
    expect(last()).toBeNull()
  })

  // This is the assertion that would have caught an unfixed clamp: with a
  // floor-derived page count of 1, a naive pager disables Next on page 1 and
  // every row past the cap becomes unreachable.
  it('keeps Next live past the floor while the page comes back full', () => {
    const onPageChange = jest.fn()
    renderTable(
      { page: 1, pageSize: PAGE_SIZE, total: 3, totalPages: 1, totalIsCapped: true, onPageChange },
      rows(PAGE_SIZE),
    )
    const button = next()
    expect(button?.disabled).toBe(false)
    fireEvent.click(button!)
    expect(onPageChange).toHaveBeenCalledWith(2)
  })

  // Deep-linking past the floor must not bounce the user back, and the range
  // label has to describe the rows actually on screen rather than the floor.
  it('serves a page past the floor without snapping back, and retires Next on a short page', () => {
    const onPageChange = jest.fn()
    renderTable(
      { page: 2, pageSize: PAGE_SIZE, total: 3, totalPages: 1, totalIsCapped: true, onPageChange },
      rows(11, PAGE_SIZE),
    )
    expect(info()).toBe('Showing 21 to 31 of 3+ results')
    expect(within(document.body).getByText('Row 31')).toBeInTheDocument()
    // Short page ⇒ nothing beyond it, so Next retires here rather than at the floor.
    expect(next()?.disabled).toBe(true)
    expect(onPageChange).not.toHaveBeenCalled()
  })

  // Capping is conditional: below the cap the server sends no flag, and the
  // table must be byte-identical to its pre-feature behaviour.
  it('leaves an uncapped list unchanged — exact total, jump-to-last offered', () => {
    renderTable(
      { page: 1, pageSize: PAGE_SIZE, total: 31, totalPages: 2, onPageChange: jest.fn() },
      rows(PAGE_SIZE),
    )
    expect(info()).toBe('Showing 1 to 20 of 31 results')
    expect(last()).not.toBeNull()
    expect(next()?.disabled).toBe(false)
  })

  // The exact-multiple false positive: short-page detection cannot distinguish
  // "a full last page" from "more to come", so Next survives one page too far.
  // The label must not then claim a row it is not showing.
  it('claims no range when a capped page comes back empty', () => {
    renderTable(
      { page: 3, pageSize: PAGE_SIZE, total: 3, totalPages: 1, totalIsCapped: true, onPageChange: jest.fn() },
      [],
    )
    expect(info()).toBe('No further results past 3')
    expect(next()?.disabled).toBe(true)
  })
})
