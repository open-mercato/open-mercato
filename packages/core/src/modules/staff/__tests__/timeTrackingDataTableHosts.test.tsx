/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { extensionPoints } from '../extension-points'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn(), refresh: jest.fn() }),
}))

const useInjectionDataWidgetsMock = jest.fn()
jest.mock('@open-mercato/ui/backend/injection/useInjectionDataWidgets', () => ({
  useInjectionDataWidgets: (spotId: string) => useInjectionDataWidgetsMock(spotId),
}))

const loadInjectionWidgetsForSpotMock = jest.fn(async () => [])
jest.mock('@open-mercato/shared/modules/widgets/injection-loader', () => ({
  getInjectionRegistryVersion: () => 0,
  subscribeToInjectionRegistryChanges: () => () => {},
  loadInjectionWidgetsForSpot: (spotId: string) => loadInjectionWidgetsForSpotMock(spotId),
  loadInjectionDataWidgetsForSpot: jest.fn(async () => []),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: jest.fn().mockResolvedValue(true), ConfirmDialogElement: null }),
}))

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

type Row = { id: string; name: string }

function renderTable(extensionTableId: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } })
  const view = render(
    React.createElement(
      QueryClientProvider as unknown as React.ComponentType<Record<string, unknown>>,
      { client: queryClient },
      React.createElement(
        I18nProvider as unknown as React.ComponentType<Record<string, unknown>>,
        { locale: 'en', dict: {} },
        React.createElement(DataTable as unknown as React.ComponentType<Record<string, unknown>>, {
          title: 'Rows',
          data: [{ id: 'row-1', name: 'One' }] as Row[],
          columns: [{ id: 'name', header: 'Name', accessorKey: 'name' }],
          extensionTableId,
        }),
      ),
    ),
  )
  queryClient.clear()
  return view
}

function spotIdsFor(tableId: string): string[] {
  return [
    `data-table:${tableId}:columns`,
    `data-table:${tableId}:row-actions`,
    `data-table:${tableId}:bulk-actions`,
    `data-table:${tableId}:filters`,
  ]
}

describe('staff time-tracking DataTable hosts', () => {
  beforeEach(() => {
    ;(globalThis as typeof globalThis & { ResizeObserver?: typeof ResizeObserverMock }).ResizeObserver =
      ResizeObserverMock
    useInjectionDataWidgetsMock.mockReset()
    useInjectionDataWidgetsMock.mockImplementation(() => ({ widgets: [], isLoading: false, error: null }))
    loadInjectionWidgetsForSpotMock.mockClear()
  })

  const cases: Array<[string, string]> = [
    ['time entries', extensionPoints.hosts.timeEntriesTable.tableId],
    ['time projects', extensionPoints.hosts.timeProjectsTable.tableId],
    ['time reports', extensionPoints.hosts.timeReportsTable.tableId],
  ]

  it.each(cases)('resolves the data spot ids for the %s table', (_label, tableId) => {
    const view = renderTable(tableId)
    const requested = useInjectionDataWidgetsMock.mock.calls.map(([spotId]) => spotId as string)
    for (const spotId of spotIdsFor(tableId)) {
      expect(requested).toContain(spotId)
    }
    expect(requested.some((spotId) => spotId.startsWith('__disabled__'))).toBe(false)
    view.unmount()
  })

  it.each(cases)('resolves the render spot ids for the %s table', (_label, tableId) => {
    const view = renderTable(tableId)
    const requested = loadInjectionWidgetsForSpotMock.mock.calls.map(([spotId]) => spotId as string)
    expect(requested).toContain(`data-table:${tableId}:header`)
    expect(requested).toContain(`data-table:${tableId}:toolbar`)
    expect(requested).toContain(`data-table:${tableId}:footer`)
    view.unmount()
  })
})
