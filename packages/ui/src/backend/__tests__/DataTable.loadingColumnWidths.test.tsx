/**
 * @jest-environment jsdom
 *
 * A reload (sort, page, filter, search) swaps the rows for a single loading
 * row. With the auto table layout the browser would then size the columns from
 * header text alone and the headers would jump. The table re-applies the header
 * widths measured while data was shown, only for the duration of the load.
 */
import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import type { ColumnDef } from '@tanstack/react-table'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { DataTable, resolveLoadingHeaderWidth } from '../DataTable'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn(), refresh: jest.fn() }),
}))

let mockInjectedColumnsLoading = false

jest.mock('../injection/useInjectionDataWidgets', () => ({
  useInjectionDataWidgets: (spotId: string) => ({
    widgets: [],
    isLoading: spotId.endsWith(':columns') && !spotId.startsWith('__disabled__') ? mockInjectedColumnsLoading : false,
  }),
}))

jest.mock('@open-mercato/shared/modules/widgets/injection-loader', () => ({
  getInjectionRegistryVersion: () => 0,
  subscribeToInjectionRegistryChanges: () => () => {},
  loadInjectionWidgetsForSpot: jest.fn(async () => []),
  loadInjectionDataWidgetsForSpot: jest.fn(async () => []),
}))

type Row = { id: string; name: string; email: string; city: string }

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const defaultWidths: Record<string, number> = {
  name: 240,
  email: 310,
  city: 180,
  __om_row_actions__: 96,
}

let measuredWidths: Record<string, number> = { ...defaultWidths }

const baseColumns: ColumnDef<Row>[] = [
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'email', header: 'Email' },
]

const rows: Row[] = [{ id: 'r1', name: 'Alice', email: 'alice@example.com', city: 'Gdańsk' }]

function buildTable(props: Record<string, unknown>) {
  return React.createElement(DataTable as any, {
    columns: baseColumns,
    data: rows,
    rowActions: () => React.createElement('span', null, 'row-action'),
    ...props,
  })
}

function renderTable(props: Record<string, unknown>) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } })
  const wrap = (node: React.ReactElement) =>
    React.createElement(
      QueryClientProvider as any,
      { client: queryClient },
      React.createElement(I18nProvider as any, { locale: 'en', dict: {} }, node),
    )
  const view = render(wrap(buildTable(props)))
  return {
    rerenderTable: (next: Record<string, unknown>) => view.rerender(wrap(buildTable(next))),
    cleanupQueryClient: () => queryClient.clear(),
  }
}

function headerCell(label: string): HTMLElement {
  const cell = screen.getByText(label).closest('th')
  if (!cell) throw new Error(`[internal] header cell not found: ${label}`)
  return cell
}

describe('DataTable header widths while loading', () => {
  let rectSpy: jest.SpyInstance

  beforeEach(() => {
    measuredWidths = { ...defaultWidths }
    mockInjectedColumnsLoading = false
    ;(globalThis as typeof globalThis & { ResizeObserver?: typeof ResizeObserverMock }).ResizeObserver =
      ResizeObserverMock
    rectSpy = jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const key = this.dataset?.columnWidthKey
      const width = key ? measuredWidths[key] ?? 0 : 0
      return { width, height: 20, top: 0, left: 0, right: width, bottom: 20, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
    })
  })

  afterEach(() => {
    rectSpy.mockRestore()
  })

  it('leaves headers on auto width when the first render is already loading', async () => {
    const rendered = renderTable({ isLoading: true, data: [] })
    try {
      await waitFor(() => expect(screen.getAllByText('Loading data...').length).toBeGreaterThan(0))
      const frozenHeaders = Array.from(document.querySelectorAll('th')).filter((cell) => cell.style.width !== '')
      expect(frozenHeaders).toHaveLength(0)
    } finally {
      rendered.cleanupQueryClient()
    }
  })

  it('freezes the measured widths during a reload and releases them afterwards', async () => {
    const rendered = renderTable({ isLoading: false })
    try {
      await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument())
      expect(headerCell('Name').style.width).toBe('')

      rendered.rerenderTable({ isLoading: true, data: [] })
      expect(headerCell('Name').style.width).toBe('240px')
      expect(headerCell('Name').style.minWidth).toBe('240px')
      expect(headerCell('Email').style.width).toBe('310px')
      expect(headerCell('Actions').style.width).toBe('96px')

      rendered.rerenderTable({ isLoading: false })
      await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument())
      expect(headerCell('Name').style.width).toBe('')
      expect(headerCell('Actions').style.width).toBe('')
    } finally {
      rendered.cleanupQueryClient()
    }
  })

  it('does not freeze a column that was not on screen when widths were measured', async () => {
    const rendered = renderTable({ isLoading: false })
    try {
      await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument())

      rendered.rerenderTable({
        isLoading: true,
        data: [],
        columns: [...baseColumns, { accessorKey: 'city', header: 'City' }],
      })
      await waitFor(() => expect(screen.getByText('City')).toBeInTheDocument())
      expect(headerCell('City').style.width).toBe('')
      expect(headerCell('Name').style.width).toBe('240px')
    } finally {
      rendered.cleanupQueryClient()
    }
  })

  it('uses the widths of an empty result rather than those of earlier rows', async () => {
    const rendered = renderTable({ isLoading: false })
    try {
      await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument())

      measuredWidths.name = 120
      rendered.rerenderTable({ isLoading: false, data: [] })
      await waitFor(() => expect(screen.queryByText('Alice')).not.toBeInTheDocument())

      rendered.rerenderTable({ isLoading: true, data: [] })
      expect(headerCell('Name').style.width).toBe('120px')
    } finally {
      rendered.cleanupQueryClient()
    }
  })

  it('uses the widths of an error state rather than those of earlier rows', async () => {
    const rendered = renderTable({ isLoading: false })
    try {
      await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument())

      measuredWidths.name = 130
      rendered.rerenderTable({ isLoading: false, data: [], error: 'Request failed' })
      await waitFor(() => expect(screen.getByText('Request failed')).toBeInTheDocument())

      rendered.rerenderTable({ isLoading: true, data: [] })
      expect(headerCell('Name').style.width).toBe('130px')
    } finally {
      rendered.cleanupQueryClient()
    }
  })

  it('measures headers that mount after injected columns finish loading', async () => {
    mockInjectedColumnsLoading = true
    const rendered = renderTable({ isLoading: false, extensionTableId: 'late-columns' })
    try {
      await waitFor(() => expect(screen.getAllByText('Loading data...').length).toBeGreaterThan(0))
      expect(screen.queryByText('Alice')).not.toBeInTheDocument()

      mockInjectedColumnsLoading = false
      rendered.rerenderTable({ isLoading: false, extensionTableId: 'late-columns' })
      await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument())

      rendered.rerenderTable({ isLoading: true, data: [], extensionTableId: 'late-columns' })
      expect(headerCell('Name').style.width).toBe('240px')
      expect(headerCell('Email').style.width).toBe('310px')
    } finally {
      rendered.cleanupQueryClient()
    }
  })
})

describe('resolveLoadingHeaderWidth', () => {
  it('prefers a user-resized width over the measured one', () => {
    expect(resolveLoadingHeaderWidth(150, 240, true)).toBe(150)
    expect(resolveLoadingHeaderWidth(150, 240, false)).toBe(150)
  })

  it('uses the measured width only while loading', () => {
    expect(resolveLoadingHeaderWidth(undefined, 240, true)).toBe(240)
    expect(resolveLoadingHeaderWidth(undefined, 240, false)).toBeUndefined()
    expect(resolveLoadingHeaderWidth(undefined, undefined, true)).toBeUndefined()
  })
})
