/**
 * @jest-environment jsdom
 *
 * Guard: the switcher must never leave a blank `om_selected_tenant` cookie behind.
 *
 * A blank value is not "no selection". `resolveTenantOverride` reads it as a deliberate "no tenant"
 * override and `applySuperAdminScope` then nulls the tenant for the whole session on super-admin
 * accounts — which is why ordinary accounts never saw it. Routes that feed the tenant into a uuid
 * filter fail in the driver from there. Expiring the cookie leaves the session on the tenant
 * carried in the token.
 */
import '@testing-library/jest-dom'
import { render, waitFor } from '@testing-library/react'

const apiCallMock = jest.fn()

// `load()` is a useCallback keyed on the router and the translator, and the mount effect depends on
// it — a fresh identity per render would re-run the effect forever, so both mocks are singletons.
const router = { refresh: jest.fn(), push: jest.fn() }
const translate = (_key: string, fallback?: string) => fallback ?? _key

jest.mock('next/navigation', () => ({
  usePathname: () => '/backend',
  useRouter: () => router,
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => translate,
  useLocale: () => 'en',
}))

jest.mock('@open-mercato/core/modules/directory/components/OrganizationSelect', () => ({
  OrganizationSelect: () => <div data-testid="organization-select" />,
}))

jest.mock('@open-mercato/core/modules/directory/components/TenantSelect', () => ({
  TenantSelect: () => <div data-testid="tenant-select" />,
}))

jest.mock('@open-mercato/shared/lib/frontend/organizationEvents', () => ({
  emitOrganizationScopeChanged: jest.fn(),
}))

import OrganizationSwitcher from '../OrganizationSwitcher'

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'

function clearCookies() {
  for (const entry of document.cookie.split(';')) {
    const name = entry.split('=')[0]?.trim()
    if (name) document.cookie = `${name}=; path=/; max-age=0`
  }
}

function readTenantCookie(): string | null {
  for (const entry of document.cookie.split(';')) {
    const trimmed = entry.trim()
    if (trimmed.startsWith('om_selected_tenant=')) {
      return trimmed.slice('om_selected_tenant='.length)
    }
  }
  return null
}

function mockSwitcherPayload(payload: Record<string, unknown>) {
  // jsdom has no global Response; the component only reads `ok`/`status`/`result` on success.
  apiCallMock.mockResolvedValue({ ok: true, status: 200, result: payload })
}

describe('OrganizationSwitcher tenant cookie', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    clearCookies()
  })

  it('does not write a blank cookie when the switcher resolves no tenant', async () => {
    mockSwitcherPayload({
      items: [],
      selectedId: null,
      canManage: true,
      tenantId: null,
      tenants: [],
      isSuperAdmin: true,
    })

    render(<OrganizationSwitcher />)

    await waitFor(() => expect(apiCallMock).toHaveBeenCalled())
    await waitFor(() => expect(readTenantCookie()).toBeNull())
  })

  it('clears a cookie an earlier build left blank', async () => {
    document.cookie = `om_selected_tenant=; path=/; max-age=${60 * 60 * 24 * 30}`
    expect(readTenantCookie()).toBe('')

    mockSwitcherPayload({
      items: [],
      selectedId: null,
      canManage: true,
      tenantId: null,
      tenants: [],
      isSuperAdmin: true,
    })

    render(<OrganizationSwitcher />)

    await waitFor(() => expect(apiCallMock).toHaveBeenCalled())
    await waitFor(() => expect(readTenantCookie()).toBeNull())
  })

  it('persists a resolved tenant', async () => {
    mockSwitcherPayload({
      items: [{ id: organizationId, name: 'Org', depth: 0, children: [] }],
      selectedId: organizationId,
      canManage: true,
      tenantId,
      tenants: [{ id: tenantId, name: 'Tenant', isActive: true }],
      isSuperAdmin: true,
    })

    render(<OrganizationSwitcher />)

    await waitFor(() => expect(readTenantCookie()).toBe(tenantId))
  })
})
