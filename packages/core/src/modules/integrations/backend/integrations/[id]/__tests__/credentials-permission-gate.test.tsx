/**
 * @jest-environment jsdom
 *
 * Regression for #5816: the integration detail page must not render an editable
 * credentials form (or an enabled "Save" action) to a user who lacks
 * `integrations.credentials.manage`. Before the fix, `showCredentialActions` and
 * the credentials tab body only checked whether the provider declared credential
 * fields — never the viewer's ACL grants — so any provider with real fields (e.g.
 * Stripe-shaped credentials) rendered an editable form and an active Save button
 * to every viewer, even though the backend correctly rejects the write with 403.
 */
import * as React from 'react'
import { waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'

const apiCallMock = jest.fn()
const flashMock = jest.fn()

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
  flash: (...args: unknown[]) => flashMock(...args),
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

const NO_PERMISSION_MESSAGE = 'You do not have permission to manage credentials for this integration.'

const dict = {
  'integrations.detail.credentials.noPermission': NO_PERMISSION_MESSAGE,
  'integrations.detail.credentials.secretConfigured': 'Configured. Enter a new value to replace it.',
}

const integrationDetail = {
  integration: {
    id: 'gateway_stripe',
    title: 'Stripe',
    category: 'payment',
    credentials: {
      fields: [
        { key: 'publishableKey', label: 'Publishable Key', type: 'text', required: false },
        { key: 'secretKey', label: 'Secret Key', type: 'secret', required: true },
      ],
    },
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
  hasCredentials: true,
  credentialsUpdatedAt: '2026-06-29T09:00:00.000Z',
  healthStatus: 'unconfigured',
  analytics: { lastActivityAt: null, totalCount: 0, errorCount: 0, errorRate: 0, dailyCounts: [0, 0, 0, 0, 0, 0, 0] },
}

function makeResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    clone() {
      return this
    },
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as unknown as Response
}

function mockApiResponses(granted: string[]) {
  apiCallMock.mockImplementation((url: unknown, init?: RequestInit) => {
    const href = typeof url === 'string' ? url : ''
    if (href.includes('/api/auth/feature-check')) {
      const body = { ok: granted.length > 0, granted, userId: 'user-1' }
      return Promise.resolve({ ok: true, status: 200, result: body, response: makeResponse(200, body) })
    }
    if (href.includes('/credentials')) {
      const body = {
        credentials: { publishableKey: 'pk_test_123', secretKey: '__om_secret_unchanged__' },
        secretFieldsConfigured: { secretKey: true },
        updatedAt: '2026-06-29T09:00:00.000Z',
      }
      return Promise.resolve({ ok: true, status: 200, result: body, response: makeResponse(200, body) })
    }
    if (href.includes('/logs')) {
      const body = { items: [] }
      return Promise.resolve({ ok: true, status: 200, result: body, response: makeResponse(200, body) })
    }
    return Promise.resolve({ ok: true, status: 200, result: integrationDetail, response: makeResponse(200, integrationDetail) })
  })
}

describe('Integration credentials — permission gate (#5816)', () => {
  beforeEach(() => {
    apiCallMock.mockReset()
    flashMock.mockReset()
  })

  it('hides the editable credentials form and Save action from a viewer without integrations.credentials.manage', async () => {
    mockApiResponses([])

    const { container } = renderWithProviders(
      <IntegrationDetailPage params={{ id: 'gateway_stripe' }} />,
      { dict },
    )

    await waitFor(() => {
      expect(container).toHaveTextContent(NO_PERMISSION_MESSAGE)
    })

    expect(container.querySelector('form')).toBeNull()
    expect(container.querySelector('[data-crud-field-id="secretKey"]')).toBeNull()
  })

  it('renders the editable credentials form for a viewer with integrations.credentials.manage', async () => {
    mockApiResponses(['integrations.credentials.manage'])

    const { container } = renderWithProviders(
      <IntegrationDetailPage params={{ id: 'gateway_stripe' }} />,
      { dict },
    )

    await waitFor(() => {
      expect(container.querySelector('form')).not.toBeNull()
    })

    expect(container.querySelector('[data-crud-field-id="secretKey"]')).not.toBeNull()
    expect(container).not.toHaveTextContent(NO_PERMISSION_MESSAGE)
  })
})
