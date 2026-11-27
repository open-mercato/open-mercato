import { randomUUID } from 'node:crypto'
import { expect, test as base } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createOrganizationFixture, deleteOrganizationIfExists } from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * TC-PORTAL-021: Portal signup and invite-accept show translated errors, never the raw server text
 *
 * The signup and invite-accept pages used to render the API's `error` field ahead of their
 * translated generic message. That field is an English literal for most failures, so a customer
 * browsing the portal in Polish saw English. The signup case rewrites the organizationId in the
 * outgoing request so the real API answers with its untranslated "Organization not found" 400.
 * The invite case stubs a JSON 500 because no server branch the form can reach returns an
 * unmapped status with a JSON body.
 */

const BASE_URL = process.env.BASE_URL?.trim() || 'http://localhost:3000'
const SIGNUP_GENERIC_PL = 'Rejestracja nie powiodła się. Spróbuj ponownie.'
const INVITE_GENERIC_PL = 'Nie udało się przyjąć zaproszenia. Spróbuj ponownie.'

const test = base.extend<{ orgSlug: string }>({
  orgSlug: async ({ request }, use) => {
    const token = await getAuthToken(request, 'superadmin')
    const { tenantId } = getTokenContext(await getAuthToken(request, 'admin'))
    const organizationId = await createOrganizationFixture(request, token, {
      name: `QA Portal 021 ${randomUUID()}`,
      tenantId,
    })
    try {
      const response = await apiRequest(
        request,
        'GET',
        `/api/directory/organizations?view=manage&ids=${encodeURIComponent(organizationId)}&tenantId=${encodeURIComponent(tenantId)}`,
        { token },
      )
      expect(response.ok(), 'organization lookup should succeed').toBeTruthy()
      const body = await readJsonSafe<{ items?: Array<{ slug?: string | null }> }>(response)
      const slug = body?.items?.[0]?.slug
      if (!slug) throw new Error('[internal] Organization fixture has no slug')
      await use(slug)
    } finally {
      await deleteOrganizationIfExists(request, token, organizationId)
    }
  },
})

test.describe('TC-PORTAL-021: portal signup and invite-accept errors are translated', () => {
  test.beforeEach(async ({ page }) => {
    await page.context().addCookies([{ name: 'locale', value: 'pl', url: BASE_URL }])
  })

  test('signup shows the Polish generic message instead of the English API error', async ({ page, orgSlug }) => {
    const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`

    await page.route('**/api/customer_accounts/signup', async (route) => {
      const payload = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>
      await route.continue({ postData: JSON.stringify({ ...payload, organizationId: randomUUID() }) })
    })

    await page.goto(`/${orgSlug}/portal/signup`)
    await page.locator('#signup-name').fill(`QA Portal 021 ${stamp}`)
    await page.locator('#signup-email').fill(`qa-portal-021-${stamp}@test.invalid`)

    const responsePromise = page.waitForResponse((response) => response.url().includes('/api/customer_accounts/signup'))
    await page.locator('button[type="submit"]').click()
    const response = await responsePromise
    expect(response.status()).toBe(400)
    const body = (await response.json()) as { error?: string }
    const serverText = body?.error
    if (!serverText) throw new Error('[internal] Signup response has no error text')

    await expect(page.getByText(SIGNUP_GENERIC_PL)).toBeVisible()
    await expect(page.getByText(serverText, { exact: true })).toHaveCount(0)
  })

  test('invite accept shows the Polish generic message instead of the English API error', async ({ page, orgSlug }) => {
    const serverText = 'Internal Server Error'

    await page.route('**/api/customer_accounts/invitations/accept', async (route) => {
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ ok: false, error: serverText }) })
    })

    await page.goto(`/${orgSlug}/portal/invite?token=${randomUUID()}`)
    await page.locator('#invite-display-name').fill('QA Portal 021')
    await page.locator('#invite-password').fill('Password-021-Invite!')
    await page.locator('#invite-confirm-password').fill('Password-021-Invite!')
    await page.locator('button[type="submit"]').click()

    await expect(page.getByText(INVITE_GENERIC_PL)).toBeVisible()
    await expect(page.getByText(serverText, { exact: true })).toHaveCount(0)
  })
})
