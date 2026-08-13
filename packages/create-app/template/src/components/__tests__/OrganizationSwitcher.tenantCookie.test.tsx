/**
 * @jest-environment jsdom
 *
 * Guard: the switcher must never leave a blank `om_selected_tenant` cookie behind.
 *
 * A blank value is meaningless for this cookie — there is no all-tenants sentinel to express and no
 * UI produces one. `resolveTenantOverride` used to read it as a deliberate "no tenant" override, so
 * `applySuperAdminScope` nulled the tenant for the whole session on super-admin accounts (which is
 * why ordinary accounts never saw it) and routes feeding that tenant into a uuid filter failed in
 * the driver. The server now ignores a blank value; these cases keep the writer from producing one
 * in the first place, so neither side depends on the other for the fix to hold.
 */
import '@testing-library/jest-dom'
import { act, render, waitFor } from '@testing-library/react'

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

function readCookie(name: string): string | null {
  for (const entry of document.cookie.split(';')) {
    const trimmed = entry.trim()
    if (trimmed.startsWith(`${name}=`)) {
      return trimmed.slice(name.length + 1)
    }
  }
  return null
}

const readTenantCookie = () => readCookie('om_selected_tenant')

// The organization cookie is written by the same `persistSelection` pass that used to write the
// blank tenant cookie, so its presence proves the load continuation actually ran.
const readSelectedOrgCookie = () => readCookie('om_selected_org')

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

    // The blank write happened in the continuation after `apiCall` resolved, so the assertion has
    // to run against a settled tree — otherwise "no cookie" is just the state before the load ran.
    await waitFor(() => expect(apiCallMock).toHaveBeenCalled())
    await waitFor(() => expect(readSelectedOrgCookie()).not.toBeNull())
    await act(async () => {})

    expect(readTenantCookie()).toBeNull()
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

  // The path a real poisoned browser takes. Now that the server ignores a blank cookie, the switcher
  // API answers with the actor's own tenant rather than `null`, so the blank cookie is overwritten
  // with that concrete id instead of being expired — the other direction of the same remediation.
  it('overwrites a legacy blank cookie with the tenant the switcher resolves', async () => {
    document.cookie = `om_selected_tenant=; path=/; max-age=${60 * 60 * 24 * 30}`
    expect(readTenantCookie()).toBe('')

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
