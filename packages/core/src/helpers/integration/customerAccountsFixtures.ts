import { expect, type APIRequestContext } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { apiRequest } from './api'
import { expectId, readJsonSafe } from './generalFixtures'

/**
 * Customer-portal / customer_accounts integration fixtures.
 *
 * The portal API (`/api/customer_accounts/portal/*`) authenticates with a pair
 * of httpOnly cookies (`customer_auth_token` JWT + `customer_session_token`),
 * not the staff Bearer token. Against the ephemeral PROD build the login route
 * sets those cookies with `Secure: true`, which Playwright's cookie jar refuses
 * to replay over plain `http://`. So {@link portalLogin} extracts the cookie
 * values from the `set-cookie` header and callers pass them back as an explicit
 * `Cookie:` header — this also keeps multiple portal actors isolated in one test
 * (each call sends exactly the header it is given, never a shared jar).
 *
 * Staff-admin setup calls (create role/user, set ACL, cleanup) reuse the shared
 * Bearer-token `apiRequest` helper.
 */

/** Short, collision-resistant token for unique emails/slugs (crypto-backed). */
export function uniqueSuffix(): string {
  return randomUUID().replace(/-/g, '').slice(0, 12)
}

/**
 * A password that satisfies common complexity rules (upper + lower + digit +
 * symbol) and the customer_accounts length bounds (8–128 chars).
 */
export function customerTestPassword(): string {
  return `Aa1!${uniqueSuffix()}`
}

export type CustomerRoleFixture = { id: string; name: string; slug: string }

export type CustomerUserFixture = {
  id: string
  email: string
  password: string
  displayName: string
  customerEntityId: string | null
}

export type CreateCustomerRoleInput = {
  /** Defaults to a unique generated name. */
  name?: string
  /** Defaults to a unique generated slug (lowercased, `[a-z0-9_-]`). */
  slug?: string
  /** When provided, the role's ACL is set to these features after creation. */
  features?: string[]
  /** When provided, sets the portal-admin bypass flag on the role ACL. */
  isPortalAdmin?: boolean
  /** Allow assignment via the portal `users/[id]/roles` endpoint. */
  customerAssignable?: boolean
}

/**
 * Create a customer role (staff admin) and, when `features`/`isPortalAdmin` are
 * provided, set its ACL. Returns the created role identity.
 */
export async function createCustomerRoleFixture(
  request: APIRequestContext,
  adminToken: string,
  input: CreateCustomerRoleInput = {},
): Promise<CustomerRoleFixture> {
  const suffix = uniqueSuffix()
  const name = input.name ?? `QA Portal Role ${suffix}`
  const slug = input.slug ?? `qa-portal-role-${suffix}`

  const createRes = await apiRequest(request, 'POST', '/api/customer_accounts/admin/roles', {
    token: adminToken,
    data: {
      name,
      slug,
      description: 'Integration fixture role',
      customerAssignable: input.customerAssignable ?? false,
    },
  })
  expect(createRes.status(), 'POST /admin/roles should return 201').toBe(201)
  const body = await readJsonSafe<{ role?: { id?: string } }>(createRes)
  const id = expectId(body?.role?.id, 'Role creation response should include role.id')

  if (input.features || typeof input.isPortalAdmin === 'boolean') {
    await setCustomerRoleAcl(request, adminToken, id, {
      features: input.features ?? [],
      isPortalAdmin: input.isPortalAdmin,
    })
  }

  return { id, name, slug }
}

/** Set a customer role's ACL (features + optional portal-admin flag). */
export async function setCustomerRoleAcl(
  request: APIRequestContext,
  adminToken: string,
  roleId: string,
  input: { features: string[]; isPortalAdmin?: boolean },
): Promise<void> {
  const data: { features: string[]; isPortalAdmin?: boolean } = { features: input.features }
  if (typeof input.isPortalAdmin === 'boolean') data.isPortalAdmin = input.isPortalAdmin
  const res = await apiRequest(request, 'PUT', `/api/customer_accounts/admin/roles/${roleId}/acl`, {
    token: adminToken,
    data,
  })
  expect(res.status(), 'PUT /admin/roles/[id]/acl should return 200').toBe(200)
}

/**
 * Create a real owned CRM company (staff admin) and return its `CustomerEntity`
 * id. `POST /admin/users` validates `customerEntityId` against an owned company
 * in the caller's tenant+org (kind=company), so portal scoping fixtures must
 * link users to a company that actually exists rather than a synthetic UUID.
 */
export async function createCustomerCompanyFixture(
  request: APIRequestContext,
  adminToken: string,
  displayName?: string,
): Promise<string> {
  const name = displayName ?? `QA Portal Company ${uniqueSuffix()}`
  const res = await apiRequest(request, 'POST', '/api/customers/companies', {
    token: adminToken,
    data: { displayName: name },
  })
  expect(res.status(), 'POST /customers/companies should return 201').toBe(201)
  const body = await readJsonSafe<{ id?: string; entityId?: string }>(res)
  return expectId(body?.id ?? body?.entityId, 'Company creation response should include the entity id')
}

/** Best-effort soft-delete of a CRM company (cleanup). */
export async function deleteCustomerCompanyFixture(
  request: APIRequestContext,
  adminToken: string | null,
  companyEntityId: string | null,
): Promise<void> {
  if (!adminToken || !companyEntityId) return
  await apiRequest(request, 'DELETE', `/api/customers/companies?id=${companyEntityId}`, {
    token: adminToken,
  }).catch(() => undefined)
}

export type CreateCustomerUserInput = {
  email?: string
  password?: string
  displayName?: string
  roleIds?: string[]
  /**
   * Owned CRM company id (a `CustomerEntity` of kind=company in the caller's
   * tenant+org) used for portal company scoping. `POST /admin/users` rejects an
   * id that is not an owned company, so create one via
   * {@link createCustomerCompanyFixture} rather than passing a synthetic UUID.
   */
  customerEntityId?: string | null
}

/**
 * Create a customer user (staff admin). Admin-created users are email-verified
 * automatically, so the returned credentials can log in immediately.
 */
export async function createCustomerUserFixture(
  request: APIRequestContext,
  adminToken: string,
  input: CreateCustomerUserInput = {},
): Promise<CustomerUserFixture> {
  const suffix = uniqueSuffix()
  const email = input.email ?? `qa-portal-${suffix}@test.local`
  const password = input.password ?? customerTestPassword()
  const displayName = input.displayName ?? `QA Portal User ${suffix}`

  const data: Record<string, unknown> = { email, password, displayName }
  if (input.roleIds && input.roleIds.length > 0) data.roleIds = input.roleIds
  if (input.customerEntityId) data.customerEntityId = input.customerEntityId

  const res = await apiRequest(request, 'POST', '/api/customer_accounts/admin/users', {
    token: adminToken,
    data,
  })
  expect(res.status(), 'POST /admin/users should return 201').toBe(201)
  const body = await readJsonSafe<{ user?: { id?: string } }>(res)
  const id = expectId(body?.user?.id, 'User creation response should include user.id')

  return { id, email, password, displayName, customerEntityId: input.customerEntityId ?? null }
}

export type PortalSession = {
  /** Raw `customer_auth_token` (JWT) cookie value. */
  authToken: string
  /** Raw `customer_session_token` cookie value. */
  sessionToken: string
  /** Ready-to-send `Cookie:` header carrying both portal cookies. */
  cookieHeader: string
}

/** Build portal request options carrying the session's `Cookie` header. */
export function portalCookieHeaders(
  session: PortalSession,
  extra?: Record<string, string>,
): Record<string, string> {
  return { Cookie: session.cookieHeader, ...(extra ?? {}) }
}

/**
 * Log a customer in and return the portal cookies. Pass `session.cookieHeader`
 * as the `Cookie` request header on subsequent portal calls (see
 * {@link portalCookieHeaders}). Logging in the same user twice yields two
 * distinct sessions.
 */
export async function portalLogin(
  request: APIRequestContext,
  input: { email: string; password: string; tenantId: string },
): Promise<PortalSession> {
  const res = await request.post('/api/customer_accounts/login', {
    data: { email: input.email, password: input.password, tenantId: input.tenantId },
    headers: { 'Content-Type': 'application/json' },
  })
  expect(res.ok(), `portal login should succeed (status ${res.status()})`).toBeTruthy()

  const setCookie = res.headers()['set-cookie'] ?? ''
  const authMatch = setCookie.match(/customer_auth_token=([^;]+)/)
  const sessionMatch = setCookie.match(/customer_session_token=([^;]+)/)
  expect(authMatch, 'login must set customer_auth_token').toBeTruthy()
  expect(sessionMatch, 'login must set customer_session_token').toBeTruthy()

  const authToken = authMatch![1]
  const sessionToken = sessionMatch![1]
  return {
    authToken,
    sessionToken,
    cookieHeader: `customer_auth_token=${authToken}; customer_session_token=${sessionToken}`,
  }
}

/** Best-effort soft-delete of a customer user (cleanup). */
export async function deleteCustomerUserFixture(
  request: APIRequestContext,
  adminToken: string | null,
  userId: string | null,
): Promise<void> {
  if (!adminToken || !userId) return
  await apiRequest(request, 'DELETE', `/api/customer_accounts/admin/users/${userId}`, {
    token: adminToken,
  }).catch(() => undefined)
}

/** Best-effort delete of a customer role (cleanup). */
export async function deleteCustomerRoleFixture(
  request: APIRequestContext,
  adminToken: string | null,
  roleId: string | null,
): Promise<void> {
  if (!adminToken || !roleId) return
  await apiRequest(request, 'DELETE', `/api/customer_accounts/admin/roles/${roleId}`, {
    token: adminToken,
  }).catch(() => undefined)
}
