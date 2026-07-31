/**
 * @jest-environment jsdom
 *
 * Regression for #3676: when saving integration credentials hits an optimistic-lock
 * 409, the credentials form must surface the conflict on the unified
 * RecordConflictBanner with a localized message — not toast the raw `record_modified`
 * code, and not silently swallow the conflict. The page hands the failure to its host
 * CrudForm via raiseCrudError (status + body), so CrudForm's existing conflict path
 * runs. Before the fix the handler threw createCrudFormError('record_modified'), which
 * CrudForm could not recognize as a conflict, so no bar appeared and the toast showed
 * the raw key.
 */
import * as React from 'react'
import { act, fireEvent, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { OPTIMISTIC_LOCK_CONFLICT_CODE } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

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

// runMutation must actually execute the operation so the credentials PUT (and its 409)
// flows through to the page's failure handling — the bug lives in that handler.
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
import { dismissRecordConflict, getRecordConflictForTest } from '@open-mercato/ui/backend/conflicts'

const RECORD_MODIFIED_MESSAGE = 'This record was modified by someone else. Refresh and try again.'

const dict = {
  'ui.forms.flash.recordModified': RECORD_MODIFIED_MESSAGE,
}

const integrationDetail = {
  integration: {
    id: 'gateway_stripe',
    title: 'Stripe',
    category: 'payment',
    credentials: {
      fields: [{ key: 'publishableKey', label: 'Publishable Key', type: 'text', required: false }],
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

const conflictBody = {
  error: 'record_modified',
  code: OPTIMISTIC_LOCK_CONFLICT_CODE,
  currentUpdatedAt: '2026-06-29T10:00:00.000Z',
  expectedUpdatedAt: '2026-06-29T09:00:00.000Z',
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

function mockApiResponses() {
  apiCallMock.mockImplementation((url: unknown, init?: RequestInit) => {
    const href = typeof url === 'string' ? url : ''
    const method = (init?.method ?? 'GET').toUpperCase()
    if (href.includes('/credentials')) {
      if (method === 'PUT') {
        return Promise.resolve({
          ok: false,
          status: 409,
          result: conflictBody,
          response: makeResponse(409, conflictBody),
        })
      }
      const body = { credentials: { publishableKey: 'pk_test_123' }, updatedAt: '2026-06-29T09:00:00.000Z' }
      return Promise.resolve({ ok: true, status: 200, result: body, response: makeResponse(200, body) })
    }
    if (href.includes('/logs')) {
      const body = { items: [] }
      return Promise.resolve({ ok: true, status: 200, result: body, response: makeResponse(200, body) })
    }
    return Promise.resolve({ ok: true, status: 200, result: integrationDetail, response: makeResponse(200, integrationDetail) })
  })
}

describe('Integration credentials — optimistic-lock conflict surfacing (#3676)', () => {
  beforeEach(() => {
    apiCallMock.mockReset()
    flashMock.mockReset()
    dismissRecordConflict()
    mockApiResponses()
  })

  afterEach(() => {
    dismissRecordConflict()
  })

  it('surfaces a stale-save 409 on the unified conflict bar with a localized message (no raw record_modified toast)', async () => {
    const { container } = renderWithProviders(
      <IntegrationDetailPage params={{ id: 'gateway_stripe' }} />,
      { dict },
    )

    let form: HTMLFormElement | null = null
    await waitFor(() => {
      form = container.querySelector('form')
      expect(form).not.toBeNull()
    })

    await act(async () => {
      fireEvent.submit(form as unknown as HTMLFormElement)
    })

    await waitFor(() => {
      const entry = getRecordConflictForTest()
      expect(entry).not.toBeNull()
      expect(entry?.message).toBe(RECORD_MODIFIED_MESSAGE)
    })

    // The raw enum string must never reach the user as a toast.
    expect(flashMock).not.toHaveBeenCalledWith('record_modified', 'error')
    expect(flashMock).not.toHaveBeenCalledWith(RECORD_MODIFIED_MESSAGE, 'error')

    // Sanity: the credentials PUT was actually attempted.
    const putCall = apiCallMock.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === 'PUT',
    )
    expect(putCall).toBeTruthy()
  })
})
