/**
 * @jest-environment jsdom
 */
/**
 * Regression coverage for #5954: the "Linked Person" / "Linked Company"
 * pickers on the portal user admin page must query the real customers API
 * (`/api/customers/people` and `/api/customers/companies`) and read the
 * snake_case fields those endpoints actually return, instead of a
 * nonexistent `/api/customers` route and camelCase fields that are never
 * present in the response.
 */
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PortalUserDetailPageClient } from '../PortalUserDetailPageClient'

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
  // A stable translate-function reference is required: the real hook returns
  // the same function across renders, and PortalUserDetailPageClient's data
  // effect depends on `t` — a fresh function identity on every render would
  // re-trigger the load effect and reset in-progress edits.
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

describe('PortalUserDetailPageClient CRM link search', () => {
  beforeEach(() => {
    apiCallMock.mockReset()
    readApiResultOrThrowMock.mockReset()
    readApiResultOrThrowMock.mockResolvedValue(userDetail)
    apiCallMock.mockResolvedValue({ ok: true, status: 200, result: { items: [] } })
  })

  it('searches companies via /api/customers/companies and labels results by display_name', async () => {
    apiCallMock.mockImplementation((url: string) => {
      if (url.startsWith('/api/customers/companies?search=')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          result: { items: [{ id: 'company-1', display_name: 'Acme Inc' }] },
        })
      }
      return Promise.resolve({ ok: true, status: 200, result: { items: [] } })
    })

    render(<PortalUserDetailPageClient params={{ id: 'user-1' }} portalOrigin="http://localhost:3000" />)

    const searchInput = await screen.findByPlaceholderText('Search companies by name...')
    fireEvent.change(searchInput, { target: { value: 'Acme' } })

    await waitFor(() => {
      expect(apiCallMock.mock.calls.some((call) =>
        typeof call[0] === 'string' && call[0].startsWith('/api/customers/companies?search=Acme'),
      )).toBe(true)
    })
    await waitFor(() => {
      expect(screen.getByText('Acme Inc')).toBeInTheDocument()
    })
    expect(apiCallMock.mock.calls.every((call) =>
      typeof call[0] !== 'string' || call[0] !== '/api/customers?search=Acme&pageSize=10',
    )).toBe(true)
  })

  it('searches people via /api/customers/people and labels results by first_name/last_name', async () => {
    apiCallMock.mockImplementation((url: string) => {
      if (url.startsWith('/api/customers/people?search=')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          result: { items: [{ id: 'person-1', first_name: 'Jane', last_name: 'Doe' }] },
        })
      }
      return Promise.resolve({ ok: true, status: 200, result: { items: [] } })
    })

    render(<PortalUserDetailPageClient params={{ id: 'user-1' }} portalOrigin="http://localhost:3000" />)

    const searchInput = await screen.findByPlaceholderText('Search people by name...')
    fireEvent.change(searchInput, { target: { value: 'Jane' } })

    await waitFor(() => {
      expect(apiCallMock.mock.calls.some((call) =>
        typeof call[0] === 'string' && call[0].startsWith('/api/customers/people?search=Jane'),
      )).toBe(true)
    })
    await waitFor(() => {
      expect(screen.getByText('Jane Doe')).toBeInTheDocument()
    })
  })

  it('links the selected company and shows its display name instead of the raw id', async () => {
    apiCallMock.mockImplementation((url: string) => {
      if (url.startsWith('/api/customers/companies?search=')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          result: { items: [{ id: 'company-1', display_name: 'Acme Inc' }] },
        })
      }
      return Promise.resolve({ ok: true, status: 200, result: { items: [] } })
    })

    render(<PortalUserDetailPageClient params={{ id: 'user-1' }} portalOrigin="http://localhost:3000" />)

    const searchInput = await screen.findByPlaceholderText('Search companies by name...')
    fireEvent.change(searchInput, { target: { value: 'Acme' } })

    await waitFor(() => {
      expect(apiCallMock.mock.calls.some((call) =>
        typeof call[0] === 'string' && call[0].startsWith('/api/customers/companies?search=Acme'),
      )).toBe(true)
    })
    let option: HTMLElement
    await waitFor(() => {
      option = screen.getByRole('button', { name: 'Acme Inc' })
      expect(option).toBeInTheDocument()
    })
    fireEvent.click(option!)

    await waitFor(() => {
      expect(screen.queryByText('company-1')).not.toBeInTheDocument()
    })
    expect(screen.getAllByText('Acme Inc').length).toBeGreaterThan(0)
  })
})
