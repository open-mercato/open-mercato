/** @jest-environment jsdom */
import * as React from 'react'
import { render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { WarrantyWorkspace } from '../backend/components/WarrantyWorkspace'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
}))

jest.mock('@open-mercato/ui/backend/injection/useInjectionDataWidgets', () => ({
  useInjectionDataWidgets: () => ({ widgets: [], isLoading: false }),
}))

type PolicyRow = { id: string; vendor: string; coverage: string }

describe('WarrantyWorkspace embedded table surfaces', () => {
  it.each([false, true])('matches pinned headers to the card, including empty lists (empty: %s)', (empty) => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } })
    const { container, unmount } = render(
      <QueryClientProvider client={queryClient}>
        <I18nProvider locale="en" dict={{}}>
          <WarrantyWorkspace title="Vendor policies">
            <DataTable<PolicyRow>
              embedded
              columns={[
                { accessorKey: 'vendor', header: 'Vendor' },
                { accessorKey: 'coverage', header: 'Coverage' },
              ]}
              data={empty ? [] : [{ id: 'policy', vendor: 'Test vendor', coverage: '12 months' }]}
              stickyFirstColumn
              stickyActionsColumn
              rowActions={() => <span>Edit</span>}
            />
          </WarrantyWorkspace>
        </I18nProvider>
      </QueryClientProvider>,
    )

    try {
      const workspaceContent = container.querySelector('section')?.lastElementChild
      const utilities = workspaceContent?.className.split(/\s+/) ?? []
      const headerSelector = '[data-slot=table-head][class*=sticky]'
      const pinnedHeaders = workspaceContent?.querySelectorAll(headerSelector)
      expect(pinnedHeaders).toHaveLength(2)
      expect(container.querySelectorAll('thead th')).toHaveLength(3)
      expect(utilities).toEqual(expect.arrayContaining([
        `md:[&_${headerSelector}]:bg-card`,
        `md:[&_${headerSelector}]:bg-linear-to-r`,
        `md:[&_${headerSelector}]:from-muted/40`,
        `md:[&_${headerSelector}]:to-muted/40`,
      ]))

      if (!empty) {
        const bodySelector = '[data-slot=table-cell][class*=sticky]'
        expect(workspaceContent?.querySelectorAll(bodySelector)).toHaveLength(2)
        expect(utilities).toEqual(expect.arrayContaining([
          `md:[&_${bodySelector}]:bg-card`,
          `md:[&_[data-slot=table-row]:hover_${bodySelector}]:bg-linear-to-r`,
          `md:[&_[data-slot=table-row]:hover_${bodySelector}]:from-muted/30`,
          `md:[&_[data-slot=table-row]:hover_${bodySelector}]:to-muted/30`,
        ]))
      }

      expect(utilities.filter((utility) => utility.includes('class*=sticky'))
        .every((utility) => utility.startsWith('md:'))).toBe(true)
    } finally {
      unmount()
      queryClient.clear()
    }
  })
})
