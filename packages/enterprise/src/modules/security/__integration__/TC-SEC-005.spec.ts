import { expect, test } from '@playwright/test'
import {
  createSuperadminApiToken,
  createUserFixture,
  deleteUserFixture,
  enrollOtpEmail,
  fetchJson,
  loginViaApi,
  setAuthCookie,
} from './helpers/securityFixtures'
import { getTokenContext } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'

test.describe('TC-SEC-005: Enforcement cascade, redirect, and compliance', () => {
  let adminToken: string
  let tenantId = ''
  let organizationId = ''
  const policyIds: string[] = []
  const userIds: string[] = []

  test.beforeAll(async ({ request }) => {
    adminToken = await createSuperadminApiToken(request)
    const context = getTokenContext(adminToken)
    tenantId = context.tenantId
    organizationId = context.organizationId
  })

  test.afterAll(async ({ request }) => {
    for (const policyId of policyIds.reverse()) {
      await fetchJson<{ ok?: boolean }>(
        request,
        'DELETE',
        `/api/security/enforcement/${policyId}`,
        { token: adminToken },
      ).catch(() => undefined)
    }
    for (const userId of userIds) {
      await deleteUserFixture(request, adminToken ?? null, userId)
    }
  })

  test('resolves org policy precedence, filters allowed methods, redirects unenrolled users, and marks overdue users in compliance', async ({ request, page }) => {
    const platformPolicy = await fetchJson<{ id: string }>(
      request,
      'POST',
      '/api/security/enforcement',
      {
        token: adminToken,
        data: {
          scope: 'platform',
          isEnforced: true,
          allowedMethods: ['totp', 'passkey', 'otp_email'],
          enforcementDeadline: new Date(Date.now() + 86_400_000).toISOString(),
        },
      },
    )
    expect(platformPolicy.status).toBe(201)
    policyIds.push(platformPolicy.body.id)

    const tenantPolicy = await fetchJson<{ id: string }>(
      request,
      'POST',
      '/api/security/enforcement',
      {
        token: adminToken,
        data: {
          scope: 'tenant',
          tenantId,
          isEnforced: true,
          allowedMethods: ['totp', 'otp_email'],
          enforcementDeadline: new Date(Date.now() + 86_400_000).toISOString(),
        },
      },
    )
    expect(tenantPolicy.status).toBe(201)
    policyIds.push(tenantPolicy.body.id)

    const orgPolicy = await fetchJson<{ id: string }>(
      request,
      'POST',
      '/api/security/enforcement',
      {
        token: adminToken,
        data: {
          scope: 'organisation',
          tenantId,
          organizationId,
          isEnforced: true,
          allowedMethods: ['otp_email'],
          enforcementDeadline: new Date(Date.now() - 60_000).toISOString(),
        },
      },
    )
    expect(orgPolicy.status).toBe(201)
    policyIds.push(orgPolicy.body.id)

    const tenantsResponse = await fetchJson<{ items: Array<{ id: string; name: string }> }>(
      request,
      'GET',
      `/api/directory/tenants?id=${tenantId}`,
      { token: adminToken },
    )
    expect(tenantsResponse.status).toBe(200)
    const tenantName = tenantsResponse.body.items[0]?.name
    expect(tenantName).toBeTruthy()

    const organizationsResponse = await fetchJson<{ items: Array<{ id: string; name: string }> }>(
      request,
      'GET',
      `/api/directory/organizations?view=manage&ids=${organizationId}&tenantId=${tenantId}`,
      { token: adminToken },
    )
    expect(organizationsResponse.status).toBe(200)
    const organizationName = organizationsResponse.body.items[0]?.name
    expect(organizationName).toBeTruthy()

    const enforcementListResponse = await fetchJson<{
      items: Array<{
        id: string
        tenantId: string | null
        tenantName: string | null
        organizationId: string | null
        organizationName: string | null
      }>
    }>(
      request,
      'GET',
      '/api/security/enforcement',
      { token: adminToken },
    )
    expect(enforcementListResponse.status).toBe(200)
    const listedOrgPolicy = enforcementListResponse.body.items.find((item) => item.id === orgPolicy.body.id)
    expect(listedOrgPolicy?.tenantId).toBe(tenantId)
    expect(listedOrgPolicy?.tenantName).toBe(tenantName)
    expect(listedOrgPolicy?.organizationId).toBe(organizationId)
    expect(listedOrgPolicy?.organizationName).toBe(organizationName)

    const enrolledUser = await createUserFixture(request, adminToken)
    const overdueUser = await createUserFixture(request, adminToken)
    userIds.push(enrolledUser.id, overdueUser.id)

    const enrolledLogin = await loginViaApi(request, enrolledUser.email, enrolledUser.password)
    await setAuthCookie(page, enrolledLogin.token)
    await page.goto('/backend')
    await expect(page).toHaveURL(/\/backend\/profile\/security\/mfa/)
    await expect(page.getByText('MFA enrollment required')).toBeVisible()

    const filteredProviders = await fetchJson<{ providers: Array<{ type: string }> }>(
      request,
      'GET',
      '/api/security/mfa/providers',
      { token: enrolledLogin.token },
    )
    expect(filteredProviders.status).toBe(200)
    expect(filteredProviders.body.providers.map((provider) => provider.type)).toEqual(['otp_email'])

    await enrollOtpEmail(request, enrolledLogin.token)
    await page.goto('/backend')
    await expect(page).toHaveURL(/\/backend$/)

    const overdueUpdate = await fetchJson<{ ok?: boolean }>(
      request,
      'PUT',
      `/api/security/enforcement/${orgPolicy.body.id}`,
      {
        token: adminToken,
        data: {
          enforcementDeadline: new Date(Date.now() - 60_000).toISOString(),
          allowedMethods: ['otp_email'],
          isEnforced: true,
          tenantId,
          organizationId,
          scope: 'organisation',
        },
      },
    )
    expect(overdueUpdate.status).toBe(200)

    const overdueLogin = await loginViaApi(request, overdueUser.email, overdueUser.password)
    await setAuthCookie(page, overdueLogin.token)
    await page.goto('/backend')
    await expect(page).toHaveURL(/\/backend\/profile\/security\/mfa$/)
    await expect(page.getByText('MFA enrollment required')).toBeVisible()
    await expect(page.getByText('Your MFA enrollment deadline has passed. Set up MFA now to keep account access.')).toBeVisible()

    const complianceResponse = await fetchJson<{
      total: number
      enrolled: number
      pending: number
      overdue: number
    }>(
      request,
      'GET',
      `/api/security/enforcement/compliance?scope=organisation&scopeId=${tenantId}:${organizationId}`,
      { token: adminToken },
    )
    expect(complianceResponse.status).toBe(200)
    expect(complianceResponse.body.total).toBeGreaterThanOrEqual(2)
    expect(complianceResponse.body.enrolled).toBeGreaterThanOrEqual(1)
    expect(complianceResponse.body.overdue).toBeGreaterThanOrEqual(1)
  })
})
