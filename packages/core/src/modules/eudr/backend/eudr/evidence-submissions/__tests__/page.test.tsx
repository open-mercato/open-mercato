/** @jest-environment jsdom */

import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import EudrEvidenceSubmissionsPage from '../page'

const mockApiCall = jest.fn(async () => ({
  ok: true,
  result: { items: [], total: 0, totalPages: 1 },
}))
let mockGrantedFeatures: string[] = []

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}))

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props}>{children}</a>
  ),
}))

jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PageBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('@open-mercato/ui/backend/BackendChromeProvider', () => ({
  useBackendChrome: () => ({
    payload: { grantedFeatures: mockGrantedFeatures },
    isLoading: false,
    isReady: true,
    refresh: jest.fn(),
  }),
}))

jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  DataTable: ({
    actions,
    emptyState,
  }: {
    actions?: React.ReactNode
    emptyState?: React.ReactNode
  }) => (
    <div>
      <div data-testid="table-actions">{actions}</div>
      <div data-testid="table-empty-state">{emptyState}</div>
    </div>
  ),
}))

jest.mock('@open-mercato/ui/backend/filters/ListEmptyState', () => ({
  ListEmptyState: ({ createHref, createLabel }: { createHref?: string; createLabel?: string }) => (
    <div>{createHref ? <a href={createHref}>{createLabel}</a> : null}</div>
  ),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: jest.fn(),
    retryLastMutation: jest.fn(),
  }),
}))

jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({
    confirm: jest.fn(),
    ConfirmDialogElement: null,
  }),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => mockApiCall(...args),
  withScopedApiRequestHeaders: (_headers: unknown, operation: () => unknown) => operation(),
}))

jest.mock('@open-mercato/ui/backend/utils/optimisticLock', () => ({
  buildOptimisticLockHeader: jest.fn(() => ({})),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/conflicts', () => ({
  surfaceRecordConflict: jest.fn(() => false),
}))

jest.mock('@open-mercato/ui/primitives/button', () => ({
  Button: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeVersion: () => 1,
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useLocale: () => 'en',
  useT: () => (key: string) => key,
}))

describe('EUDR evidence submissions list permissions', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGrantedFeatures = []
  })

  it('hides every create affordance from a view-only user', async () => {
    mockGrantedFeatures = ['eudr.submissions.view']

    render(<EudrEvidenceSubmissionsPage />)

    expect(screen.queryByText('eudr.evidenceSubmissions.list.actions.create')).toBeNull()
    await waitFor(() => expect(mockApiCall).toHaveBeenCalled())
  })

  it('shows create affordances for a wildcard manage grant', async () => {
    mockGrantedFeatures = ['eudr.*']

    render(<EudrEvidenceSubmissionsPage />)

    expect(screen.getAllByText('eudr.evidenceSubmissions.list.actions.create')).toHaveLength(2)
    await waitFor(() => expect(mockApiCall).toHaveBeenCalled())
  })
})
