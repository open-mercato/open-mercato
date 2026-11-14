/** @jest-environment jsdom */
import * as React from 'react'
import { DataTable } from '../DataTable'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import type { SortingState } from '@tanstack/react-table'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { fireEvent, render, screen } from '@testing-library/react'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
}))

jest.mock('../injection/useInjectionDataWidgets', () => ({
  useInjectionDataWidgets: () => ({ widgets: [], isLoading: false }),
}))

type Row = { id: string; code: string; region: string; score: number }

const columns: ColumnDef<Row>[] = [
  { accessorKey: 'code', header: 'Code', enableSorting: true },
  { accessorKey: 'region', header: 'Region', enableSorting: true },
  { accessorKey: 'score', header: 'Score', enableSorting: true },
]

const rows: Row[] = [
  { id: '1', code: 'A-1', region: 'North', score: 10 },
  { id: '2', code: 'B-2', region: 'South', score: 20 },
]

function Wrapper({ children }: { children: React.ReactNode }) {
  const [queryClient] = React.useState(() => new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } }))
  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider locale="en" dict={{}}>
        {children}
      </I18nProvider>
    </QueryClientProvider>
  )
}

function ControlledTable({ onSortingChange }: { onSortingChange: (next: SortingState) => void }) {
  const [sorting, setSorting] = React.useState<SortingState>([])
  return (
    <DataTable<Row>
      columns={columns}
      data={rows}
      sortable
      manualSorting
      sorting={sorting}
      onSortingChange={(next) => {
        setSorting(next)
        onSortingChange(next)
      }}
    />
  )
}

describe('DataTable header sort cycle', () => {
  it('cycles ascending, descending, then clears sorting', () => {
    const onSortingChange = jest.fn()
    render(
      <Wrapper>
        <ControlledTable onSortingChange={onSortingChange} />
      </Wrapper>,
    )

    const header = () => screen.getByRole('button', { name: /Code/ })

    fireEvent.click(header())
    expect(onSortingChange).toHaveBeenLastCalledWith([{ id: 'code', desc: false }])

    fireEvent.click(header())
    expect(onSortingChange).toHaveBeenLastCalledWith([{ id: 'code', desc: true }])

    fireEvent.click(header())
    expect(onSortingChange).toHaveBeenLastCalledWith([])

    fireEvent.click(header())
    expect(onSortingChange).toHaveBeenLastCalledWith([{ id: 'code', desc: false }])
  })

  it('starts numeric columns ascending and clears after descending', () => {
    const onSortingChange = jest.fn()
    render(
      <Wrapper>
        <ControlledTable onSortingChange={onSortingChange} />
      </Wrapper>,
    )

    const header = () => screen.getByRole('button', { name: /Score/ })

    fireEvent.click(header())
    expect(onSortingChange).toHaveBeenLastCalledWith([{ id: 'score', desc: false }])

    fireEvent.click(header())
    expect(onSortingChange).toHaveBeenLastCalledWith([{ id: 'score', desc: true }])

    fireEvent.click(header())
    expect(onSortingChange).toHaveBeenLastCalledWith([])
  })

  it('replaces the sorted column on shift+click instead of adding a second one', () => {
    const onSortingChange = jest.fn()
    render(
      <Wrapper>
        <ControlledTable onSortingChange={onSortingChange} />
      </Wrapper>,
    )

    fireEvent.click(screen.getByRole('button', { name: /Code/ }))
    expect(onSortingChange).toHaveBeenLastCalledWith([{ id: 'code', desc: false }])

    fireEvent.click(screen.getByRole('button', { name: /Region/ }), { shiftKey: true })
    expect(onSortingChange).toHaveBeenLastCalledWith([{ id: 'region', desc: false }])
  })
})
