/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'

const apiCallMock = jest.fn()

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}))

jest.mock('next/navigation', () => ({
  usePathname: () => '/backend/integrations/gateway_stripe',
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

jest.mock('remark-gfm', () => ({ __esModule: true, default: {} }))

jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PageBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('@open-mercato/ui/backend/detail', () => ({
  LoadingMessage: ({ label }: { label: string }) => <div>{label}</div>,
  ErrorMessage: ({ label }: { label: string }) => <div>{label}</div>,
  RecordNotFoundState: ({ label }: { label: string }) => <div>{label}</div>,
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => {
  const actual = jest.requireActual('@open-mercato/ui/backend/utils/apiCall')
  return {
    ...actual,
    apiCall: (...args: unknown[]) => apiCallMock(...args),
    withScopedApiRequestHeaders: (_headers: Record<string, string>, run: () => Promise<unknown>) => run(),
  }
})

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: async ({ operation }: { operation: () => Promise<unknown> }) => operation(),
    retryLastMutation: jest.fn(),
  }),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

// CrudForm dependencies that need stubbing to render under jsdom.
jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: jest.fn().mockResolvedValue(true), ConfirmDialogElement: null }),
}))
jest.mock('@open-mercato/ui/backend/custom-fields/FieldDefinitionsManager', () => {
  const ReactLocal = require('react')
  return {
    __esModule: true,
    FieldDefinitionsManager: ReactLocal.forwardRef(() => <div>Field definitions manager</div>),
  }
})
jest.mock('@open-mercato/ui/backend/utils/customFieldForms', () => ({
  __esModule: true,
  buildFormFieldFromCustomFieldDef: jest.fn(),
  buildFormFieldsFromCustomFields: jest.fn(() => []),
  fetchCustomFieldFormStructure: jest.fn(async () => ({
    fields: [],
    definitions: [],
    metadata: { items: [], fieldsetsByEntity: {}, entitySettings: {} },
  })),
}))

import IntegrationDetailPage from '../page'

const integrationDetail = {
  integration: {
    id: 'gateway_stripe',
    title: 'Stripe',
    category: 'payment',
    credentials: { fields: [] },
  },
  state: {
    isEnabled: true,
    apiVersion: null,
    reauthRequired: false,
    lastHealthStatus: null,
    lastHealthCheckedAt: null,
    lastHealthLatencyMs: null,
    enabledAt: null,
    updatedAt: '2026-06-29T09:00:00.000Z',
  },
  hasCredentials: false,
  credentialsUpdatedAt: null,
  healthStatus: 'unconfigured',
  analytics: { lastActivityAt: null, totalCount: 0, errorCount: 0, errorRate: 0, dailyCounts: [0, 0, 0, 0, 0, 0, 0] },
}

function mockApiResponses() {
  apiCallMock.mockImplementation((url: unknown) => {
    const href = typeof url === 'string' ? url : ''
    if (href.includes('/logs')) return Promise.resolve({ ok: true, status: 200, result: { items: [] } })
    return Promise.resolve({ ok: true, status: 200, result: integrationDetail })
  })
}

describe('IntegrationDetailPage route id resolution', () => {
  beforeEach(() => {
    apiCallMock.mockReset()
    mockApiResponses()
  })

  it('loads the integration using the id from the params prop', async () => {
    renderWithProviders(<IntegrationDetailPage params={{ id: 'gateway_stripe' }} />)

    await waitFor(() => {
      expect(apiCallMock).toHaveBeenCalledWith(
        '/api/integrations/gateway_stripe',
        undefined,
        { fallback: null },
      )
    })
  })

  it('shows an error and issues no request when the id is missing', async () => {
    renderWithProviders(<IntegrationDetailPage params={{}} />)

    await waitFor(() => {
      expect(screen.getByText('Failed to load integration')).toBeInTheDocument()
    })
    expect(apiCallMock).not.toHaveBeenCalled()
  })
})
