/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import BundleConfigPage from '../page'

const apiCallMock = jest.fn()

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
  withScopedApiRequestHeaders: (
    _headers: Record<string, string>,
    operation: () => Promise<unknown>,
  ) => operation(),
}))

jest.mock('@open-mercato/ui/backend/utils/optimisticLock', () => ({
  buildOptimisticLockHeader: () => ({}),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: async ({ operation }: { operation: () => Promise<unknown> }) => operation(),
    retryLastMutation: async () => true,
  }),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

const bundleDetail = {
  integration: { id: 'storage_s3', title: 'Storage bundle' },
  bundle: { id: 'storage_s3', title: 'Storage bundle', credentials: { fields: [] } },
  bundleIntegrations: [],
  state: { isEnabled: true },
  hasCredentials: false,
}

beforeEach(() => {
  apiCallMock.mockReset()
  apiCallMock.mockResolvedValue({ ok: true, result: bundleDetail })
})

describe('BundleConfigPage route id resolution', () => {
  it('loads the bundle using the id from the params prop', async () => {
    renderWithProviders(<BundleConfigPage params={{ id: 'storage_s3' }} />)

    await waitFor(() => {
      expect(apiCallMock).toHaveBeenCalledWith(
        '/api/integrations/storage_s3',
        undefined,
        { fallback: null },
      )
    })
  })

  it('shows an error and issues no request when the id is missing', async () => {
    renderWithProviders(<BundleConfigPage params={{}} />)

    await waitFor(() => {
      expect(screen.getByText('integrations.detail.loadError')).toBeInTheDocument()
    })
    expect(apiCallMock).not.toHaveBeenCalled()
  })
})
