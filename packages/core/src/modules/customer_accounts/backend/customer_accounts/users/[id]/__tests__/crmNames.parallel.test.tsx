/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, waitFor } from '@testing-library/react'
import CustomerUserDetailPage from '../page'

type ApiResult = { ok: boolean; status: number; result: unknown }

const apiCallMock = jest.fn<Promise<ApiResult>, [string, ...unknown[]]>()
const readApiResultOrThrowMock = jest.fn()

const userDetail = {
  id: 'user-1',
  displayName: 'User One',
  email: 'user@example.com',
  emailVerifiedAt: null,
  isActive: true,
  lastLoginAt: null,
  personEntityId: 'person-1',
  customerEntityId: 'company-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  roles: [],
  sessions: [],
}

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
}))

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}))

jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PageBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('@open-mercato/ui/backend/forms', () => ({
  FormHeader: () => <div>header</div>,
}))

jest.mock('@open-mercato/ui/primitives/button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}))

jest.mock('@open-mercato/ui/primitives/input', () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}))

jest.mock('@open-mercato/ui/primitives/password-input', () => ({
  PasswordInput: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}))

jest.mock('@open-mercato/ui/primitives/spinner', () => ({
  Spinner: () => <div>spinner</div>,
}))

jest.mock('@open-mercato/ui/primitives/switch-field', () => ({
  SwitchField: () => <div>switch</div>,
}))

jest.mock('@open-mercato/ui/primitives/dialog', () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: [string, ...unknown[]]) => apiCallMock(...args),
  readApiResultOrThrow: (...args: unknown[]) => readApiResultOrThrowMock(...args),
  withScopedApiRequestHeaders: <T,>(_headers: Record<string, string>, run: () => Promise<T>) => run(),
}))

jest.mock('@open-mercato/ui/backend/utils/optimisticLock', () => ({
  buildOptimisticLockHeader: () => ({}),
}))

jest.mock('@open-mercato/ui/backend/conflicts', () => ({
  surfaceRecordConflict: () => false,
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback?: string) => fallback ?? '',
}))

jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: jest.fn(async () => true), ConfirmDialogElement: null }),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: async <T,>({ operation }: { operation: () => Promise<T> }) => operation(),
    retryLastMutation: async () => true,
  }),
}))

jest.mock('@open-mercato/ui/backend/detail', () => ({
  RecordNotFoundState: () => <div>not-found</div>,
  ErrorMessage: ({ label }: { label: string }) => <div>{label}</div>,
}))

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => { resolve = res })
  return { promise, resolve }
}

describe('CustomerUserDetailPage CRM name lookups', () => {
  beforeEach(() => {
    apiCallMock.mockReset()
    readApiResultOrThrowMock.mockReset()
    readApiResultOrThrowMock.mockResolvedValue(userDetail)
  })

  it('dispatches the person and company lookups concurrently rather than sequentially', async () => {
    const personDeferred = createDeferred<ApiResult>()
    const companyDeferred = createDeferred<ApiResult>()

    apiCallMock.mockImplementation((url: string) => {
      if (url.startsWith('/api/customers/people/')) return personDeferred.promise
      if (url.startsWith('/api/customers/') && !url.startsWith('/api/customers/people')) return companyDeferred.promise
      // roles request and any other lookups
      return Promise.resolve({ ok: true, status: 200, result: { items: [] } })
    })

    render(<CustomerUserDetailPage params={{ id: 'user-1' }} />)

    // Both CRM lookups must be in-flight before either response resolves.
    await waitFor(() => {
      const calledUrls = apiCallMock.mock.calls.map((call) => call[0])
      expect(calledUrls).toContain('/api/customers/people/person-1')
      expect(calledUrls).toContain('/api/customers/company-1')
    })

    const personCalls = apiCallMock.mock.calls.filter((call) => call[0] === '/api/customers/people/person-1')
    const companyCalls = apiCallMock.mock.calls.filter((call) => call[0] === '/api/customers/company-1')
    expect(personCalls).toHaveLength(1)
    expect(companyCalls).toHaveLength(1)

    personDeferred.resolve({ ok: true, status: 200, result: { id: 'person-1', firstName: 'Jane', lastName: 'Doe' } })
    companyDeferred.resolve({ ok: true, status: 200, result: { id: 'company-1', name: 'Acme Inc' } })

    await waitFor(() => {
      expect(apiCallMock.mock.calls.some((call) => call[0] === '/api/customers/people/person-1')).toBe(true)
    })
  })

  it('still resolves the company name when the person lookup rejects (best-effort failure)', async () => {
    apiCallMock.mockImplementation((url: string) => {
      if (url.startsWith('/api/customers/people/')) return Promise.reject(new Error('person lookup failed'))
      if (url.startsWith('/api/customers/') && !url.startsWith('/api/customers/people')) {
        return Promise.resolve({ ok: true, status: 200, result: { id: 'company-1', name: 'Acme Inc' } })
      }
      return Promise.resolve({ ok: true, status: 200, result: { items: [] } })
    })

    render(<CustomerUserDetailPage params={{ id: 'user-1' }} />)

    await waitFor(() => {
      const calledUrls = apiCallMock.mock.calls.map((call) => call[0])
      expect(calledUrls).toContain('/api/customers/people/person-1')
      expect(calledUrls).toContain('/api/customers/company-1')
    })
  })
})
