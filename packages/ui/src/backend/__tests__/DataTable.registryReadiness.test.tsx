/** @jest-environment jsdom */
import * as React from 'react'
import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import {
  registerCoreInjectionWidgets,
  registerCoreInjectionTables,
  registerEnabledModuleIds,
} from '@open-mercato/shared/modules/widgets/injection-loader'
import type { InjectionDataWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import { DataTable } from '../DataTable'
import { useInjectionDataWidgets } from '../injection/useInjectionDataWidgets'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn(), refresh: jest.fn() }),
}))

const COLUMNS = [
  { id: 'reference', accessorKey: 'reference', header: 'Reference' },
  { id: 'status', accessorKey: 'status', header: 'Status' },
  { id: 'amount', accessorKey: 'amount', header: 'Amount' },
]
const ROWS = [{ id: 'payment-1', reference: 'PAY-1', status: 'paid', amount: '10.00' }]
const COLUMN_SPOT = 'data-table:registry.payments:columns'

function readHeaders(): Array<string | null> {
  return screen.queryAllByRole('columnheader').map((cell) => cell.textContent)
}

describe('DataTable injection registry readiness', () => {
  it('waits for both cold registry registration and the injected column module', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
    let resolveWidget: (widget: InjectionDataWidgetModule) => void = () => {}
    const widgetPromise = new Promise<InjectionDataWidgetModule>((resolve) => { resolveWidget = resolve })
    const loadWidget = jest.fn(() => widgetPromise)
    try {
      const disabledHook = renderHook(() => useInjectionDataWidgets('__disabled__:columns'))
      expect(disabledHook.result.current).toEqual({ widgets: [], isLoading: false, error: null })
      disabledHook.unmount()
      render(
        <QueryClientProvider client={queryClient}>
          <I18nProvider locale="en" dict={{}}>
            <DataTable columns={COLUMNS} data={ROWS} extensionTableId="registry.payments" />
          </I18nProvider>
        </QueryClientProvider>,
      )
      await act(async () => { await Promise.resolve() })
      expect(readHeaders()).toEqual([])

      await act(async () => { registerEnabledModuleIds(['example']) })
      expect(readHeaders()).toEqual([])

      await act(async () => {
        registerCoreInjectionWidgets([{
          key: 'example:payment-status',
          moduleId: 'example',
          source: 'app',
          widgetId: 'example.payment-status',
          loader: loadWidget,
        }])
      })
      expect(loadWidget).not.toHaveBeenCalled()
      expect(readHeaders()).toEqual([])

      await act(async () => {
        registerCoreInjectionTables([{
          moduleId: 'example',
          table: { [COLUMN_SPOT]: ['example.payment-status'] },
        }])
      })
      await waitFor(() => expect(loadWidget).toHaveBeenCalledTimes(1))
      expect(readHeaders()).toEqual([])

      await act(async () => {
        resolveWidget({
          metadata: { id: 'example.payment-status' },
          columns: [{ id: 'gateway_status', header: 'Gateway status', accessorKey: 'status' }],
        })
        await widgetPromise
      })
      await waitFor(() => expect(readHeaders()).toEqual(['Reference', 'Status', 'Amount', 'Gateway status']))
    } finally {
      queryClient.clear()
    }
  })
})
