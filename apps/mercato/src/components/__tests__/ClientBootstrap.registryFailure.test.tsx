/** @jest-environment jsdom */
import * as React from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { getInjectionRegistryError, isInjectionRegistryReady } from '@open-mercato/shared/modules/widgets/injection-loader'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { ClientBootstrapProvider } from '../ClientBootstrap'

let mockRejectRegistry = true

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

jest.mock('@open-mercato/shared/lib/logger', () => {
  const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: () => logger }
  return { createLogger: () => logger }
})

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn(), refresh: jest.fn() }),
}))
jest.mock('@/modules', () => ({ enabledModules: [] }), { virtual: true })
jest.mock('@/.mercato/generated/translations-fields.generated', () => ({}), { virtual: true })
jest.mock('@/.mercato/generated/injection-widgets.generated', () => {
  if (mockRejectRegistry) throw new Error('ChunkLoadError')
  return { injectionWidgetEntries: [] }
}, { virtual: true })
jest.mock('@/.mercato/generated/injection-tables.generated', () => ({ injectionTables: [] }), { virtual: true })
jest.mock('@/.mercato/generated/enabled-module-ids.generated', () => ({ enabledModuleIds: [] }), { virtual: true })
jest.mock('@/.mercato/generated/notification-handlers.generated', () => ({ notificationHandlerEntries: [] }), { virtual: true })
jest.mock('@/.mercato/generated/messages.client.generated', () => ({}), { virtual: true })

const COLUMNS = [{ id: 'reference', accessorKey: 'reference', header: 'Reference' }]
const ROWS = [{ id: 'payment-1', reference: 'PAY-1' }]

describe('client injection registry failure', () => {
  it('releases a cold table to base rows after registry import rejection and retries on the next render', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
    function Harness({ revision }: { revision: number }) {
      return (
        <QueryClientProvider client={queryClient}>
          <I18nProvider locale="en" dict={{}}>
            <ClientBootstrapProvider profile="backend">
              <DataTable key={revision} columns={COLUMNS} data={ROWS} extensionTableId="registry.payments" />
            </ClientBootstrapProvider>
          </I18nProvider>
        </QueryClientProvider>
      )
    }
    try {
      expect(isInjectionRegistryReady()).toBe(false)
      const { rerender } = render(<Harness revision={0} />)
      expect(screen.queryByRole('table')).toBeNull()

      await waitFor(() => expect(getInjectionRegistryError()).toBe('ChunkLoadError'))
      await waitFor(() => expect(screen.getByRole('columnheader', { name: 'Reference' })).toBeInTheDocument())
      expect(screen.getByText('PAY-1')).toBeInTheDocument()
      expect(screen.getByRole('alert')).toHaveTextContent('Some table extensions could not load. Reload the page to retry.')
      expect(screen.queryByText('Loading data...')).toBeNull()
      expect(isInjectionRegistryReady()).toBe(false)

      mockRejectRegistry = false
      await act(async () => { rerender(<Harness revision={1} />) })

      await waitFor(() => expect(isInjectionRegistryReady()).toBe(true))
      await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
      expect(getInjectionRegistryError()).toBeNull()
      expect(screen.getByRole('columnheader', { name: 'Reference' })).toBeInTheDocument()
      expect(screen.getByText('PAY-1')).toBeInTheDocument()
    } finally {
      queryClient.clear()
    }
  })
})
