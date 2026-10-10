import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

type IntegrationItem = {
  id?: string
  providerKey?: string
  credentials?: {
    fields?: Array<{ key?: string; type?: string }>
  }
}

const providers = [
  { id: 'channel_brevo', providerKey: 'brevo', title: 'Brevo Email', secretFields: ['apiKey'] },
  { id: 'channel_mailjet', providerKey: 'mailjet', title: 'Mailjet Email', secretFields: ['apiKey', 'secretKey'] },
]

test.describe('TC-EU-EMAIL-001: EU transactional email provider discovery', () => {
  test('lists both providers and exposes their detail pages', async ({ page, request }) => {
    await login(page, 'admin')
    const token = await getAuthToken(request, 'admin')
    const listResponse = await apiRequest(request, 'GET', '/api/integrations?pageSize=100', { token })
    expect(listResponse.status()).toBe(200)
    const listBody = await readJsonSafe<{ items?: IntegrationItem[] }>(listResponse)
    const items = listBody?.items ?? []

    for (const provider of providers) {
      expect(items).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: provider.id, providerKey: provider.providerKey }),
      ]))

      const detailResponse = await apiRequest(request, 'GET', `/api/integrations/${provider.id}`, { token })
      expect(detailResponse.status()).toBe(200)
      const detailBody = await readJsonSafe<{ integration?: IntegrationItem }>(detailResponse)
      expect(detailBody?.integration).toEqual(expect.objectContaining({
        id: provider.id,
        providerKey: provider.providerKey,
      }))
      for (const fieldKey of provider.secretFields) {
        expect(detailBody?.integration?.credentials?.fields).toEqual(expect.arrayContaining([
          expect.objectContaining({ key: fieldKey, type: 'secret' }),
        ]))
      }

      await page.goto(`/backend/integrations/${provider.id}`)
      await expect(page.getByText(provider.title, { exact: true }).first()).toBeVisible()
      for (const fieldKey of provider.secretFields) {
        await expect(page.locator(`[data-crud-field-id="${fieldKey}"] input`)).toHaveAttribute('type', 'password')
      }

      let healthRequests = 0
      await page.route(`**/api/integrations/${provider.id}/health`, async (route) => {
        healthRequests += 1
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            status: 'healthy',
            message: 'Credentials accepted',
            details: { endpoint: 'credential-probe' },
            latencyMs: 1,
            checkedAt: '2026-10-09T00:00:00.000Z',
          }),
        })
      })
      await page.getByRole('tab', { name: 'Health' }).click()
      await page.getByRole('button', { name: 'Run Check' }).click()
      await expect.poll(() => healthRequests).toBe(1)
      await expect(page.getByText('Credentials accepted', { exact: true })).toBeVisible()
    }
  })
})
