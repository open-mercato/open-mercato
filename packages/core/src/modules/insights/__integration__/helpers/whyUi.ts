import { expect, type APIRequestContext, type Page, type TestInfo } from '@playwright/test'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'
import { QA_USER_PASSWORD, uniqueSuffix } from './explainApi'

type JwtScopeClaims = { tenantId?: string; orgId?: string | null }

function decodeJwtScope(token: string): JwtScopeClaims | null {
  const parts = token.split('.')
  if (parts.length < 2) return null
  try {
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as JwtScopeClaims
  } catch {
    return null
  }
}

/** Signs a fixture user into the browser context and opens the backend. */
export async function loginWithCredentials(page: Page, email: string, password: string): Promise<void> {
  const form = new URLSearchParams()
  form.set('email', email)
  form.set('password', password)
  const response = await page.request.post('/api/auth/login', {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    data: form.toString(),
  })
  expect(response.ok(), `login for ${email} should succeed`).toBeTruthy()
  const body = (await response.json().catch(() => null)) as { token?: string } | null
  const claims = typeof body?.token === 'string' ? decodeJwtScope(body.token) : null
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000'
  const cookies: Array<{ name: string; value: string; url: string; sameSite: 'Lax' }> = []
  if (claims?.tenantId) cookies.push({ name: 'om_selected_tenant', value: claims.tenantId, url: baseUrl, sameSite: 'Lax' })
  if (claims?.orgId) cookies.push({ name: 'om_selected_org', value: claims.orgId, url: baseUrl, sameSite: 'Lax' })
  if (cookies.length > 0) await page.context().addCookies(cookies)
  await page.goto('/backend', { waitUntil: 'domcontentloaded' })
  await page.waitForURL(/\/backend(?:\/.*)?$/, { timeout: 15_000 })
}

export type UiUserFixture = { roleId: string | null; userId: string | null; email: string | null }

/** Creates a role holding exactly `features` and a user with only that role in the admin's organization. */
export async function createUiUser(
  request: APIRequestContext,
  adminToken: string,
  fixture: UiUserFixture,
  input: { label: string; features: string[] },
): Promise<{ email: string; password: string }> {
  const { organizationId } = getTokenScope(adminToken)
  const suffix = uniqueSuffix()
  fixture.roleId = await createRoleFixture(request, adminToken, { name: `QA ${input.label} ${suffix}` })
  await setRoleAclFeatures(request, adminToken, { roleId: fixture.roleId, features: input.features, organizations: null })
  const email = `qa-${input.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${suffix}@example.com`
  fixture.email = email
  fixture.userId = await createUserFixture(request, adminToken, {
    email,
    password: QA_USER_PASSWORD,
    organizationId,
    roles: [fixture.roleId],
    name: `QA ${input.label}`,
  })
  return { email, password: QA_USER_PASSWORD }
}

export async function deleteUiUser(request: APIRequestContext, adminToken: string | null, fixture: UiUserFixture): Promise<void> {
  await deleteUserIfExists(request, adminToken, fixture.userId)
  await deleteRoleIfExists(request, adminToken, fixture.roleId)
}

export async function attachScreenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const screenshotPath = testInfo.outputPath(`${name}.png`)
  await page.screenshot({ path: screenshotPath, fullPage: true })
  await testInfo.attach(name, { path: screenshotPath, contentType: 'image/png' })
}
