/** @jest-environment jsdom */

import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import SalesChannelOffersListPage from '../page'

const mockReadApiResultOrThrow = jest.fn()
const mockT = (key: string, fallback?: string) => fallback ?? key

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}))

jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PageBody: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}))

jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  DataTable: ({
    title,
    titleHeadingLevel,
  }: {
    title?: React.ReactNode
    titleHeadingLevel?: 1 | 2
  }) => {
    const TitleHeading = titleHeadingLevel === 1 ? 'h1' : 'h2'
    return (
      <div>
        {typeof title === 'string' || titleHeadingLevel
          ? <TitleHeading>{title}</TitleHeading>
          : title}
      </div>
    )
  },
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: (...args: unknown[]) => mockReadApiResultOrThrow(...args),
  withScopedApiRequestHeaders: (_headers: unknown, operation: () => unknown) => operation(),
}))

jest.mock('@open-mercato/ui/backend/utils/optimisticLock', () => ({
  buildOptimisticLockHeader: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/conflicts', () => ({
  surfaceRecordConflict: jest.fn(() => false),
}))

jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  deleteCrud: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: jest.fn(),
    retryLastMutation: jest.fn(),
  }),
}))

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeVersion: () => 0,
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => mockT,
}))

jest.mock('@open-mercato/core/modules/sales/components/useSalesChannelsEnabled', () => ({
  useSalesChannelsEnabled: () => ({ enabled: true, isLoading: false }),
}))

jest.mock('@open-mercato/shared/lib/logger', () => ({
  createLogger: () => ({ error: jest.fn(), warn: jest.fn() }),
}))

describe('SalesChannelOffersListPage heading hierarchy', () => {
  beforeEach(() => {
    mockReadApiResultOrThrow.mockReset()
    mockReadApiResultOrThrow.mockResolvedValue({ items: [], total: 0, totalPages: 1 })
  })

  it('keeps the page title as the sole h1 and the subtitle outside its accessible name', async () => {
    render(<SalesChannelOffersListPage />)

    const heading = screen.getByRole('heading', { level: 1, name: 'Sales channel offers' })
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(heading).toBeVisible()
    expect(heading).not.toHaveTextContent('Review product overrides across every sales channel.')
    expect(screen.getByText('Review product overrides across every sales channel.')).toBeVisible()
    await waitFor(() => expect(mockReadApiResultOrThrow).toHaveBeenCalled())
  })
})
