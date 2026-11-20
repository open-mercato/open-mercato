import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { createOrganizationFixture, deleteOrganizationIfExists } from '@open-mercato/core/helpers/integration/authFixtures'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

const mappingsPath = '/api/customer_accounts/admin/domain-mappings'

test.describe('TC-DOMAIN-9146: custom domain ownership instructions', () => {
  test.use({ locale: 'en-US' })

  test('registers a domain, copies both TXT values and preserves the ownership deadline on reload', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = randomUUID().replaceAll('-', '')
    let organizationId: string | null = null
    let mappingId: string | null = null

    try {
      organizationId = await createOrganizationFixture(request, token, { name: `Domain ownership ${stamp}` })
      await login(page, 'admin')
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
      await page.goto(`/backend/customer_accounts/settings/domain?org=${organizationId}`)
      await page.getByRole('button', { name: 'Register Domain', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: 'Register custom domain' })
      const hostname = `ownership-${stamp}.example.test`
      await dialog.getByLabel('Domain', { exact: true }).fill(hostname)
      const registration = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith(mappingsPath))
      await dialog.getByRole('button', { name: 'Register', exact: true }).click()
      const response = await registration
      expect(response.status()).toBe(201)
      const body = await response.json() as {
        domainMapping: { id: string; ownershipRecord: { name: string; value: string }; verificationExpiresAt: string }
      }
      mappingId = body.domainMapping.id
      const { ownershipRecord, verificationExpiresAt } = body.domainMapping
      expect(ownershipRecord.name).toBe(`_om-verify.${hostname}`)
      expect(ownershipRecord.value).toBe(`open-mercato-verification=${mappingId}`)
      expect(Number.isFinite(Date.parse(verificationExpiresAt))).toBe(true)
      await expect(page.getByText(ownershipRecord.name, { exact: true })).toBeVisible()
      await expect(page.getByText(ownershipRecord.value, { exact: true })).toBeVisible()
      await expect(page.getByText(/Verify by .*If the request expires, register again/)).toBeVisible()

      for (const [label, value] of [['Copy TXT record name', ownershipRecord.name], ['Copy TXT record value', ownershipRecord.value]]) {
        await page.getByRole('button', { name: label, exact: true }).click()
        await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(value)
      }

      await page.reload()
      await expect(page.getByText(ownershipRecord.name, { exact: true })).toBeVisible()
      await expect(page.getByText(ownershipRecord.value, { exact: true })).toBeVisible()
      const listed = await apiRequest(request, 'GET', `${mappingsPath}?organizationId=${organizationId}`, { token })
      expect(listed.status()).toBe(200)
      const records = await readJsonSafe<{ domainMappings: Array<{ id: string; ownershipRecord: unknown; verificationExpiresAt: string }> }>(listed)
      expect(records?.domainMappings.find((record) => record.id === mappingId)).toMatchObject({ ownershipRecord, verificationExpiresAt })
      const refused = await apiRequest(request, 'POST', `${mappingsPath}/${mappingId}/health-check`, { token })
      expect(refused.status()).toBe(409)
      expect(await readJsonSafe<{ code: string }>(refused)).toMatchObject({ code: 'domain_mapping_not_verified' })
    } finally {
      try {
        if (mappingId) {
          const removed = await apiRequest(request, 'DELETE', `${mappingsPath}?id=${mappingId}`, { token })
          expect(removed.status()).toBe(200)
        }
      } finally {
        await deleteOrganizationIfExists(request, token, organizationId)
      }
    }
  })
})
