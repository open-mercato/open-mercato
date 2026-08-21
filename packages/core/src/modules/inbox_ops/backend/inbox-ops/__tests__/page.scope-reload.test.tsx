/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { act, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { emitOrganizationScopeChanged } from '@open-mercato/shared/lib/frontend/organizationEvents'
import InboxOpsProposalsPage from '../page'

type ApiResult<T> = { ok: boolean; result: T }

const apiCallMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: async ({ operation }: { operation: () => Promise<unknown> }) => operation(),
  }),
}))

jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({
    confirm: jest.fn(async () => true),
    ConfirmDialogElement: null,
  }),
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}))

function okResult<T>(result: T): ApiResult<T> {
  return { ok: true, result }
}

function configureApi(scope: { inboxAddress: string; pending: number }) {
  apiCallMock.mockImplementation(async (url: string) => {
    if (url.startsWith('/api/inbox_ops/proposals/counts')) {
      return okResult({ pending: scope.pending, partial: 0, accepted: 0, rejected: 0 })
    }
    if (url.startsWith('/api/inbox_ops/settings')) {
      return okResult({ settings: { inboxAddress: scope.inboxAddress } })
    }
    if (url.startsWith('/api/inbox_ops/proposals')) {
      return okResult({ items: [], total: 0, page: 1, totalPages: 1 })
    }
    return okResult({})
  })
}

beforeEach(() => {
  apiCallMock.mockReset()
})

describe('InboxOpsProposalsPage scope reload', () => {
  it('reloads counts and settings when the organization scope changes', async () => {
    configureApi({ inboxAddress: 'org-a@inbox.example.com', pending: 0 })

    renderWithProviders(<InboxOpsProposalsPage />)

    await waitFor(() => {
      expect(screen.getByText('org-a@inbox.example.com')).toBeTruthy()
    })

    const countsCallsBefore = apiCallMock.mock.calls.filter(([url]) =>
      typeof url === 'string' && url.startsWith('/api/inbox_ops/proposals/counts'),
    ).length
    const settingsCallsBefore = apiCallMock.mock.calls.filter(([url]) =>
      typeof url === 'string' && url.startsWith('/api/inbox_ops/settings'),
    ).length

    configureApi({ inboxAddress: 'org-b@inbox.example.com', pending: 0 })

    act(() => {
      emitOrganizationScopeChanged({
        organizationId: 'org-b',
        tenantId: 'tenant-b',
      })
    })

    await waitFor(() => {
      expect(screen.getByText('org-b@inbox.example.com')).toBeTruthy()
    })
    expect(screen.queryByText('org-a@inbox.example.com')).toBeNull()

    const countsCallsAfter = apiCallMock.mock.calls.filter(([url]) =>
      typeof url === 'string' && url.startsWith('/api/inbox_ops/proposals/counts'),
    ).length
    const settingsCallsAfter = apiCallMock.mock.calls.filter(([url]) =>
      typeof url === 'string' && url.startsWith('/api/inbox_ops/settings'),
    ).length

    expect(countsCallsAfter).toBeGreaterThan(countsCallsBefore)
    expect(settingsCallsAfter).toBeGreaterThan(settingsCallsBefore)
  })
})
