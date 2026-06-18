import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import QueryIndexesTable from './QueryIndexesTable'
import { TranslationProvider } from '@open-mercato/shared/lib/i18n/context'

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeVersion: () => 1,
}))

describe('QueryIndexesTable', () => {
  it('does not render hard-coded tailwind color classes for status', () => {
    const queryClient = new QueryClient()

    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <TranslationProvider translations={{}}>
          <QueryIndexesTable />
        </TranslationProvider>
      </QueryClientProvider>
    )

    // Validate that no hard-coded text-green-*, text-orange-*, or text-red-*
    // classes remain in the rendered component.
    expect(container.innerHTML).not.toMatch(/text-green-\d+/)
    expect(container.innerHTML).not.toMatch(/text-orange-\d+/)
    expect(container.innerHTML).not.toMatch(/text-red-\d+/)
  })
})
