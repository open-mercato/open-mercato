import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createCustomerUserFixture,
  deleteCustomerUserFixture,
  portalCookieHeaders,
  portalLogin,
} from '@open-mercato/core/helpers/integration/customerAccountsFixtures'

test('TC-AUTH-3821: customer credential writes enforce the shared policy without invalidating login', async ({ request }) => {
  test.setTimeout(60_000)
  const token = await getAuthToken(request, 'admin')
  const { tenantId } = getTokenContext(token)
  const weakCreate = await apiRequest(request, 'POST', '/api/customer_accounts/admin/users', {
    token,
    data: { email: `weak-${Date.now()}@test.local`, displayName: 'Policy regression', password: 'longpassword' },
  })
  if (weakCreate.status() === 201) {
    const body = await readJsonSafe<{ user?: { id?: string } }>(weakCreate)
    if (body?.user?.id) await deleteCustomerUserFixture(request, token, body.user.id)
  }
  expect(weakCreate.status()).toBe(400)
  const user = await createCustomerUserFixture(request, token)
  try {
    const session = await portalLogin(request, { ...user, tenantId })
    const weakReset = await apiRequest(request, 'POST', `/api/customer_accounts/admin/users/${user.id}/reset-password`, {
      token,
      data: { newPassword: 'longpassword' },
    })
    expect(weakReset.status()).toBe(400)
    const weakChange = await request.post('/api/customer_accounts/portal/password-change', {
      headers: portalCookieHeaders(session),
      data: { currentPassword: user.password, newPassword: 'longpassword' },
    })
    expect(weakChange.status()).toBe(400)
    await portalLogin(request, { ...user, tenantId })
    const newPassword = `Changed-${Date.now()}-Aa1!`
    const validReset = await apiRequest(request, 'POST', `/api/customer_accounts/admin/users/${user.id}/reset-password`, {
      token,
      data: { newPassword },
    })
    expect(validReset.ok()).toBeTruthy()
    await portalLogin(request, { email: user.email, password: newPassword, tenantId })
  } finally {
    await deleteCustomerUserFixture(request, token, user.id)
  }
})
