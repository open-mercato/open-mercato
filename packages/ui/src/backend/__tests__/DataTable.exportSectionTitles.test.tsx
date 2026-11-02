/** @jest-environment jsdom */
import * as React from 'react'
import { DataTable } from '../DataTable'
import type { DataTableExportConfig } from '../DataTable'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
}))

jest.mock('../injection/useInjectionDataWidgets', () => ({
  useInjectionDataWidgets: () => ({ widgets: [], isLoading: false }),
}))

type Row = { id: string; name: string }

const columns: ColumnDef<Row>[] = [{ accessorKey: 'name', header: 'Name' }]

const exporter: DataTableExportConfig = {
  view: { getUrl: () => '/api/example/export?scope=view' },
  full: { getUrl: () => '/api/example/export?scope=full' },
}

function renderExportMenu(dict: Record<string, string>, exportConfig: DataTableExportConfig = exporter) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } })
  const view = render(
    React.createElement(
      QueryClientProvider as any,
      { client: queryClient },
      React.createElement(
        I18nProvider as any,
        { locale: 'en', dict },
        React.createElement(DataTable as any, {
          columns,
          data: [],
          title: 'Test',
          exporter: exportConfig,
        }),
      ),
    )
  )
  fireEvent.click(screen.getByRole('button', { name: dict['ui.dataTable.export.label'] ?? 'Export' }))
  return { view, queryClient }
}

describe('DataTable export section titles', () => {
  it('falls back to the English defaults when the host supplies no translations', () => {
    const { view, queryClient } = renderExportMenu({})
    try {
      expect(screen.getByText('Export what you view')).toBeTruthy()
      expect(screen.getByText('Full data export')).toBeTruthy()
    } finally {
      view.unmount()
      queryClient.clear()
    }
  })

  it('uses the host dictionary for the default section titles without any page-level title', () => {
    const { view, queryClient } = renderExportMenu({
      'ui.dataTable.export.label': 'Eksportuj',
      'ui.dataTable.export.viewTitle': 'Eksport tego, co widzisz',
      'ui.dataTable.export.fullTitle': 'Eksport pełnych danych',
    })
    try {
      expect(screen.getByText('Eksport tego, co widzisz')).toBeTruthy()
      expect(screen.getByText('Eksport pełnych danych')).toBeTruthy()
      expect(screen.queryByText('Export what you view')).toBeNull()
      expect(screen.queryByText('Full data export')).toBeNull()
    } finally {
      view.unmount()
      queryClient.clear()
    }
  })

  it('translates the numbered fallback for explicit sections that omit a title', () => {
    const { view, queryClient } = renderExportMenu(
      { 'ui.dataTable.export.sectionTitle': 'Eksport {index}' },
      { sections: [{ getUrl: () => '/api/example/export?scope=first' }] },
    )
    try {
      expect(screen.getByText('Eksport 1')).toBeTruthy()
    } finally {
      view.unmount()
      queryClient.clear()
    }
  })

  it('keeps the default download filename ASCII when the title is translated', async () => {
    const anchorClicks: HTMLAnchorElement[] = []
    const clickSpy = jest
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function mockClick(this: HTMLAnchorElement) {
        anchorClicks.push(this)
      })
    const originalCreateObjectURL = URL.createObjectURL
    const originalRevokeObjectURL = URL.revokeObjectURL
    URL.createObjectURL = jest.fn(() => 'blob:mock')
    URL.revokeObjectURL = jest.fn()

    const { view, queryClient } = renderExportMenu(
      { 'ui.dataTable.export.fullTitle': '전체 데이터 내보내기' },
      { full: { prepare: () => ({ prepared: { columns: [{ field: 'id', header: 'Id' }], rows: [{ id: '1' }] } }) } },
    )
    try {
      expect(screen.getByText('전체 데이터 내보내기')).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: 'CSV' }))
      await waitFor(() => expect(anchorClicks.length).toBe(1))
      expect(anchorClicks[0].download).toBe('Full_data_export.csv')
    } finally {
      clickSpy.mockRestore()
      URL.createObjectURL = originalCreateObjectURL
      URL.revokeObjectURL = originalRevokeObjectURL
      view.unmount()
      queryClient.clear()
    }
  })

  it('keeps an explicitly supplied section title verbatim', () => {
    const { view, queryClient } = renderExportMenu(
      { 'ui.dataTable.export.viewTitle': 'Eksport tego, co widzisz' },
      { view: { title: 'Host supplied title', getUrl: () => '/api/example/export?scope=view' } },
    )
    try {
      expect(screen.getByText('Host supplied title')).toBeTruthy()
      expect(screen.queryByText('Eksport tego, co widzisz')).toBeNull()
    } finally {
      view.unmount()
      queryClient.clear()
    }
  })
})
