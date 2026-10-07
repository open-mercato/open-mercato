/** @jest-environment jsdom */
import * as React from 'react'
import { DataTable } from '../DataTable'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { fireEvent, render, screen } from '@testing-library/react'
import { Button } from '../../primitives/button'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
}))

jest.mock('../injection/useInjectionDataWidgets', () => ({
  useInjectionDataWidgets: () => ({ widgets: [], isLoading: false }),
}))

type Row = { id: string; code: string; region: string; owner: string }

const columns: ColumnDef<Row>[] = [
  { accessorKey: 'code', header: 'Code' },
  { accessorKey: 'region', header: 'Region' },
  { accessorKey: 'owner', header: 'Owner' },
]

const tokensOf = (el: Element | null): string[] =>
  (el?.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)

type TableProps = {
  data?: Row[]
  error?: React.ReactNode | string | null
  isLoading?: boolean
}

function renderTable({ data = [], error = null, isLoading = false }: TableProps) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } })
  const result = render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider locale="en" dict={{}}>
        <DataTable columns={columns} data={data} error={error} isLoading={isLoading} />
      </I18nProvider>
    </QueryClientProvider>,
  )
  return { ...result, queryClient }
}

// A table wider than its scroll viewport used to centre the error message on the
// whole table, pushing it towards (or past) the right edge of the visible area.
// The error must sit in the same sticky, viewport-wide box as the empty state.
describe('DataTable error state centres within the visible area', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('renders the error inside a sticky, left-pinned box with destructive text', () => {
    const { queryClient } = renderTable({ error: 'Could not load records' })
    try {
      const box = screen.getByText('Could not load records')
      const tokens = tokensOf(box)
      expect(tokens).toEqual(
        expect.arrayContaining(['sticky', 'left-0', 'flex', 'items-center', 'justify-center', 'text-destructive']),
      )
      expect(tokensOf(box.closest('td'))).toContain('p-0')
    } finally {
      queryClient.clear()
    }
  })

  it('sizes the error box to the measured scroll viewport width', () => {
    jest.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(640)
    const { queryClient } = renderTable({ error: 'Could not load records' })
    try {
      const box = screen.getByText('Could not load records')
      expect(box.style.width).toBe('640px')
      expect(tokensOf(box)).not.toContain('w-fit')
    } finally {
      queryClient.clear()
    }
  })

  it('falls back to w-fit when the viewport width is not measurable', () => {
    jest.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(0)
    const { queryClient } = renderTable({ error: 'Could not load records' })
    try {
      const box = screen.getByText('Could not load records')
      expect(box.style.width).toBe('')
      expect(tokensOf(box)).toContain('w-fit')
    } finally {
      queryClient.clear()
    }
  })

  it('renders a node error with a working action button', () => {
    const onRetry = jest.fn()
    const { queryClient } = renderTable({
      error: (
        <span>
          Could not load records.{' '}
          <Button type="button" variant="outline" onClick={onRetry}>
            Try again
          </Button>
        </span>
      ),
    })
    try {
      expect(screen.getByText(/Could not load records\./)).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
      expect(onRetry).toHaveBeenCalledTimes(1)
    } finally {
      queryClient.clear()
    }
  })

  it('shows the loading state instead of the error while loading', () => {
    const { queryClient } = renderTable({ error: 'Could not load records', isLoading: true })
    try {
      expect(screen.queryByText('Could not load records')).not.toBeInTheDocument()
      expect(screen.getByText('Loading data...')).toBeInTheDocument()
    } finally {
      queryClient.clear()
    }
  })

  it('renders rows when there is no error', () => {
    const { queryClient } = renderTable({
      data: [{ id: '1', code: 'AX-100', region: 'North', owner: 'Team Blue' }],
    })
    try {
      expect(screen.getByText('AX-100')).toBeInTheDocument()
      expect(screen.queryByText('Could not load records')).not.toBeInTheDocument()
    } finally {
      queryClient.clear()
    }
  })
})
