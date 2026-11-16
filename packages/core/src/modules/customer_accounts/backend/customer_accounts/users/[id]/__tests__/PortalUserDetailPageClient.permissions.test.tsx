/** @jest-environment jsdom */
import type { ReactNode } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { PortalUserDetailPageClient } from '../PortalUserDetailPageClient'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

const mockTranslate = (key: string, fallback?: string) => fallback ?? key
let mockChrome: { isReady: boolean; payload?: { grantedFeatures?: string[] } }

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => mockTranslate }))
jest.mock('@open-mercato/ui/backend/BackendChromeProvider', () => ({ useBackendChrome: () => mockChrome }))
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }))
jest.mock('next/link', () => ({ children, href }: { children: ReactNode; href: string }) => <a href={href}>{children}</a>)
jest.mock('@open-mercato/ui/backend/forms', () => ({
  FormHeader: ({ title }: { title: ReactNode }) => <h1>{title}</h1>,
}))
jest.mock('@open-mercato/ui/backend/detail', () => ({
  RecordNotFoundState: () => <div>Not found</div>,
  ErrorMessage: ({ label }: { label: string }) => <div>{label}</div>,
}))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(async () => ({ ok: true, result: { items: [] } })),
  readApiResultOrThrow: jest.fn(),
  withScopedApiRequestHeaders: (_headers: Record<string, string>, operation: () => unknown) => operation(),
}))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('@open-mercato/ui/backend/conflicts', () => ({ surfaceRecordConflict: jest.fn() }))
jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: jest.fn(async () => false), ConfirmDialogElement: null }),
}))
jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: ({ operation }: { operation: () => unknown }) => operation(),
    retryLastMutation: jest.fn(),
  }),
}))

const user = {
  id: 'user-1', displayName: 'Portal reader', email: 'reader@example.com',
  emailVerifiedAt: '2026-01-01T00:00:00Z', isActive: true, lastLoginAt: null,
  personEntityId: null, customerEntityId: null, createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z', roles: [],
  sessions: [{ id: 'session-1', ipAddress: '192.0.2.1', userAgent: 'Test browser',
    lastUsedAt: null, createdAt: '2026-01-01T00:00:00Z', expiresAt: '2027-01-01T00:00:00Z' }],
}

function expectNoSecurityControls() {
  for (const name of ['Reset Password', 'Send Reset Link', 'Revoke']) {
    expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
  }
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(readApiResultOrThrow).mockResolvedValue(user)
})

it.each([
  ['view-only', { isReady: true, payload: { grantedFeatures: ['customer_accounts.view'] } }],
  ['unready with cached manage grant', { isReady: false, payload: { grantedFeatures: ['*'] } }],
  ['unknown payload', { isReady: true }],
  ['unknown grants', { isReady: true, payload: {} }],
])('keeps detail readable without security controls for %s', async (_label, chrome) => {
  mockChrome = chrome
  render(<PortalUserDetailPageClient params={{ id: user.id }} portalOrigin="https://portal.example.com" />)
  expect(await screen.findByRole('heading', { name: user.displayName })).toBeInTheDocument()
  expect(screen.getByText(user.email)).toBeInTheDocument()
  expect(screen.getByText('192.0.2.1')).toBeInTheDocument()
  expectNoSecurityControls()
})

it.each([undefined, {}])('fails closed when ready without feature grants (%j)', async (payload) => {
  mockChrome = { isReady: true, payload }
  render(<PortalUserDetailPageClient params={{ id: user.id }} portalOrigin="https://portal.example.com" />)
  expect(await screen.findByRole('heading', { name: user.displayName })).toBeInTheDocument()
  expectNoSecurityControls()
})

it.each(['customer_accounts.manage', 'customer_accounts.*', '*'])('retains security controls for %s and removes an open reset dialog when permission is lost', async (grant) => {
  mockChrome = { isReady: true, payload: { grantedFeatures: [grant] } }
  const { rerender } = render(<PortalUserDetailPageClient params={{ id: user.id }} portalOrigin="https://portal.example.com" />)
  const reset = await screen.findByRole('button', { name: 'Reset Password' })
  expect(screen.getByRole('button', { name: 'Send Reset Link' })).toBeEnabled()
  expect(screen.getByRole('button', { name: 'Revoke' })).toBeEnabled()
  fireEvent.click(reset)
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  expect(screen.getByLabelText('New Password')).toBeInTheDocument()
  mockChrome = { isReady: false, payload: { grantedFeatures: [grant] } }
  rerender(<PortalUserDetailPageClient params={{ id: user.id }} portalOrigin="https://portal.example.com" />)
  expectNoSecurityControls()
  expect(screen.getByRole('heading', { name: user.displayName })).toBeInTheDocument()
})
