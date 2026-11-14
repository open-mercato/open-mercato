import { randomUUID } from 'node:crypto'
import { expect, test, type APIResponse } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { acknowledgeGlobalNotices } from '@open-mercato/core/helpers/integration/auth'
import { createOrganizationFixture, createRoleFixture, createUserFixture, deleteOrganizationIfExists, deleteRoleIfExists, deleteUserIfExists, setRoleAclFeatures } from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'

type ListBody = { items: Array<{ id: string; amount: string; unifiedStatus: string }>; total: number }

async function readList(response: Pick<APIResponse, 'status' | 'text'>): Promise<ListBody> {
  expect(response.status()).toBe(200)
  const body = JSON.parse(await response.text()) as ListBody
  expect(Array.isArray(body.items)).toBe(true)
  return body
}

for (const language of ['en', 'pl'] as const) {
  for (const width of [375, 1440]) {
    test(`TC-PGWY-026: ${language} server transaction sorting at ${width}px`, async ({ browser, request, baseURL }, testInfo) => {
      const superToken = await getAuthToken(request, 'superadmin')
      const adminToken = await getAuthToken(request, 'admin')
      const { tenantId } = getTokenContext(adminToken)
      const suffix = randomUUID()
      const email = `qa-payment-sort-${suffix}@example.com`
      const password = `QA-${randomUUID()}!aA1`
      const ids = Array.from({ length: 24 }, () => randomUUID())
      let organizationId: string | null = null
      let roleId: string | null = null
      let userId: string | null = null
      const context = await browser.newContext({ baseURL, viewport: { width, height: 1000 } })
      const page = await context.newPage()
      const amountHeader = language === 'pl' ? 'Kwota' : 'Amount'
      const updatedHeader = language === 'pl' ? 'Zaktualizowano' : 'Updated'
      const listResponse = (query: Record<string, string>) => page.waitForResponse((response) => {
        const url = new URL(response.url())
        return url.pathname === '/api/payment_gateways/transactions'
          && Object.entries(query).every(([key, value]) => url.searchParams.get(key) === value)
      })
      try {
        organizationId = await createOrganizationFixture(request, superToken, { tenantId, name: `QA sort ${suffix}` })
        roleId = await createRoleFixture(request, superToken, { tenantId, name: `qa-sort-${suffix}` })
        await setRoleAclFeatures(request, superToken, { roleId, organizations: [organizationId], features: ['payment_gateways.view'] })
        userId = await createUserFixture(request, superToken, { email, password, organizationId, roles: [roleId] })
        await withClient(async (client) => {
          for (const [index, id] of ids.entries()) {
            await client.query(`insert into gateway_transactions
              (id, payment_id, provider_key, unified_status, amount, captured_amount, currency_code, organization_id, tenant_id, created_at, updated_at)
              values ($1, $2, $3, $4, $5, 0, 'USD', $6, $7, $8, $9)`,
            [id, randomUUID(), index % 2 ? 'stripe' : 'mock', index % 2 ? 'pending' : 'captured', index === 0 ? 100 : index, organizationId, tenantId,
              new Date(Date.UTC(2026, 10, 1, 0, index)), new Date(Date.UTC(2026, 10, 1, 0, 24 - index))])
          }
        })
        const token = await getAuthToken(page.request, email, password)
        const ascending = await readList(await apiRequest(request, 'GET', '/api/payment_gateways/transactions?sortField=amount&sortDir=asc&pageSize=100', { token }))
        expect(ascending.total).toBe(24)
        expect(ascending.items.map((item) => Number(item.amount))).toEqual([...Array.from({ length: 23 }, (_, index) => index + 1), 100])
        const descending = await readList(await apiRequest(request, 'GET', '/api/payment_gateways/transactions?sortField=amount&sortDir=desc&pageSize=100', { token }))
        expect(descending.items.map((item) => item.id)).toEqual([...ascending.items].reverse().map((item) => item.id))
        const invalid = await apiRequest(request, 'GET', '/api/payment_gateways/transactions?sortField=clientSecret', { token })
        expect(invalid.status()).toBe(400)
        await context.addCookies([
          { name: 'locale', value: language, url: baseURL! },
          { name: 'om_selected_tenant', value: tenantId, url: baseURL! },
          { name: 'om_selected_org', value: organizationId, url: baseURL! },
        ])
        await acknowledgeGlobalNotices(page)
        const initial = listResponse({ page: '1' })
        await page.goto('/backend/payment-gateways')
        await readList(await initial)
        const amount = page.getByRole('columnheader').getByRole('button', { name: amountHeader, exact: true })
        await expect(amount).toBeVisible()
        const sorted = listResponse({ page: '1', sortField: 'amount', sortDir: 'asc' })
        await amount.click()
        const firstPage = await readList(await sorted)
        expect(firstPage.items.map((item) => item.id)).toEqual(ascending.items.slice(0, 20).map((item) => item.id))
        await expect(page.getByText(firstPage.items[0].id, { exact: true })).toBeVisible()
        const nextPage = listResponse({ page: '2', sortField: 'amount', sortDir: 'asc' })
        await page.getByRole('button', { name: language === 'pl' ? 'Następna strona' : 'Next page', exact: true }).click()
        const lastPage = await readList(await nextPage)
        expect(lastPage.items.map((item) => item.id)).toEqual(ascending.items.slice(20).map((item) => item.id))
        const reversed = listResponse({ page: '1', sortField: 'amount', sortDir: 'desc' })
        await amount.click()
        expect((await readList(await reversed)).items[0].id).toBe(ids[0])
        const updated = listResponse({ page: '1', sortField: 'updatedAt', sortDir: 'asc' })
        await page.getByRole('columnheader').getByRole('button', { name: updatedHeader, exact: true }).click()
        expect((await readList(await updated)).items[0].id).toBe(ids[23])
        await testInfo.attach(`transactions-${language}-${width}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
      } finally {
        const cleanupErrors: string[] = []
        const cleanup = async (operation: () => Promise<unknown>) => {
          try {
            await operation()
          } catch (error) {
            cleanupErrors.push(String(error))
          }
        }
        await cleanup(() => context.close())
        await cleanup(() => withClient(async (client) => { await client.query('delete from gateway_transactions where id = any($1::uuid[])', [ids]) }))
        await cleanup(() => deleteUserIfExists(request, superToken, userId))
        await cleanup(() => deleteRoleIfExists(request, superToken, roleId))
        await cleanup(() => deleteOrganizationIfExists(request, superToken, organizationId))
        expect(cleanupErrors, 'Every owned transaction, user, role and organization must be removed').toEqual([])
      }
    })
  }
}
