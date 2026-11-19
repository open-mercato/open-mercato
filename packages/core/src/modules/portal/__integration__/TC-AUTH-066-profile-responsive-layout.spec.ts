import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createCustomerUserFixture,
  deleteCustomerUserFixture,
  portalLogin,
} from '@open-mercato/core/helpers/integration/customerAccountsFixtures'

test('TC-AUTH-066: portal profile keeps long values and badges inside the viewport', async ({ page, request, baseURL }) => {
  if (!baseURL) throw new Error('[internal] Integration base URL is required')
  const token = await getAuthToken(request, 'admin')
  const { tenantId, organizationId } = getTokenContext(token)
  const organizationResponse = await apiRequest(request, 'GET', `/api/directory/organizations?view=manage&ids=${encodeURIComponent(organizationId)}&tenantId=${encodeURIComponent(tenantId)}`, { token })
  expect(organizationResponse.ok()).toBeTruthy()
  const organization = await readJsonSafe<{ items?: Array<{ slug?: string | null }> }>(organizationResponse)
  const orgSlug = organization?.items?.[0]?.slug
  if (!orgSlug) throw new Error('[internal] Integration organization slug is required')
  const user = await createCustomerUserFixture(request, token, {
    email: `profile-layout-${randomUUID().slice(0, 8)}-${'long'.repeat(6)}@test.local`,
  })
  try {
    const session = await portalLogin(request, { ...user, tenantId })
    await page.context().addCookies([
      { name: 'customer_auth_token', value: session.authToken, url: baseURL },
      { name: 'customer_session_token', value: session.sessionToken, url: baseURL },
    ])
    await page.goto(`/${orgSlug}/portal/profile`, { waitUntil: 'domcontentloaded' })
    const email = page.getByRole('main').getByText(user.email, { exact: true })
    await expect(email).toHaveCount(1)
    await expect(email).toBeVisible()
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 844 })
      await expect.poll(async () => email.evaluate((element) => {
        const row = element.parentElement?.parentElement?.parentElement
        if (!row) return false
        const card = row.parentElement
        if (!card) return false
        return Array.from(card.querySelectorAll('span')).every((value) => {
          const bounds = value.getBoundingClientRect()
          return bounds.left >= 0 && bounds.right <= window.innerWidth + 1
            && value.scrollWidth <= value.clientWidth + 1
        })
      }), { message: `Profile values and badges should fit at ${width}px` }).toBe(true)
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
    }
  } finally {
    await deleteCustomerUserFixture(request, token, user.id)
  }
})
