/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { PortalUserDetailPageClient } from '../PortalUserDetailPageClient'

type ApiResult = { ok: boolean; status: number; result: unknown }

const apiCallMock = jest.fn<Promise<ApiResult>, [string, ...unknown[]]>()
const readApiResultOrThrowMock = jest.fn()

const userDetail = {
  id: 'user-1',
  organizationId: 'org-child',
  displayName: 'User One',
  email: 'user@example.com',
  emailVerifiedAt: null,
  isActive: true,
  lastLoginAt: null,
  personEntityId: null,
  customerEntityId: null,
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

jest.mock('@open-mercato/shared/lib/i18n/context', () => {
  const translate = (_key: string, fallback?: string) => fallback ?? ''
  return { useT: () => translate }
})

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

describe('PortalUserDetailPageClient role options', () => {
  beforeEach(() => {
    apiCallMock.mockReset()
    readApiResultOrThrowMock.mockReset()
    readApiResultOrThrowMock.mockResolvedValue(userDetail)
    apiCallMock.mockImplementation((url: string) => {
      if (url.startsWith('/api/customer_accounts/admin/roles')) {
        return Promise.resolve({ ok: true, status: 200, result: { items: [{ id: 'role-child', name: 'Child buyer' }] } })
      }
      return Promise.resolve({ ok: true, status: 200, result: {} })
    })
  })

  it("loads role options from the edited user's organization, not the staff user's home organization", async () => {
    render(<PortalUserDetailPageClient params={{ id: 'user-1' }} portalOrigin="http://localhost:3000" />)

    expect(await screen.findByText('Child buyer')).toBeInTheDocument()
    const roleUrls = apiCallMock.mock.calls
      .map((call) => call[0])
      .filter((url) => url.startsWith('/api/customer_accounts/admin/roles'))
    expect(roleUrls).toHaveLength(1)
    const query = new URLSearchParams(roleUrls[0].split('?')[1])
    expect(query.get('organizationId')).toBe('org-child')
    expect(query.get('pageSize')).toBe('100')
  })
})
