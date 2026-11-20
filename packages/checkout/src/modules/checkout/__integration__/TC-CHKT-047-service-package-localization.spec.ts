import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { acknowledgeGlobalNotices } from '@open-mercato/core/helpers/integration/auth'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { CHECKOUT_ENTITY_IDS } from '../lib/constants'
import { CHECKOUT_LINK_CUSTOM_FIELDS, CHECKOUT_LINK_FIELDSETS } from '../lib/customFields'

const editors = [
  { path: '/backend/checkout/pay-links/create', entityId: CHECKOUT_ENTITY_IDS.link },
  { path: '/backend/checkout/templates/create', entityId: CHECKOUT_ENTITY_IDS.template },
]
const serviceFields = CHECKOUT_LINK_CUSTOM_FIELDS.filter((field) => field.fieldset === 'service_package')
const fieldsets = ['donation_campaign', 'service_package'].map((code) => (
  CHECKOUT_LINK_FIELDSETS.find((fieldset) => fieldset.code === code)!
))

for (const editor of editors) {
  test.describe(`TC-CHKT-047: Polish Service package on ${editor.path}`, () => {
    let token: string
    let tenantId: string | null
    let organizationId: string | null

    test.beforeEach(async ({ request }) => {
      tenantId = null
      organizationId = null
      token = await getAuthToken(request, 'superadmin')
      const marker = `checkout-localization-${randomUUID()}`
      const tenantResponse = await apiRequest(request, 'POST', '/api/directory/tenants', {
        token,
        data: { name: marker },
      })
      expect(tenantResponse.status()).toBe(201)
      tenantId = expectId((await readJsonSafe<{ id?: string }>(tenantResponse))?.id, 'Owned tenant id')
      const organizationResponse = await apiRequest(request, 'POST', '/api/directory/organizations', {
        token,
        data: { tenantId, name: marker },
      })
      expect(organizationResponse.status()).toBe(201)
      organizationId = expectId((await readJsonSafe<{ id?: string }>(organizationResponse))?.id, 'Owned organization id')
      const response = await apiRequest(request, 'POST', '/api/entities/definitions.batch', {
        token,
        headers: { Cookie: `om_selected_tenant=${tenantId}; om_selected_org=${organizationId}` },
        data: {
          entityId: editor.entityId,
          definitions: serviceFields.map(({ key, kind, ...configJson }) => ({ key, kind, configJson })),
          fieldsets,
          singleFieldsetPerRecord: true,
        },
      })
      expect(response.ok(), 'Create owned Service package definitions').toBeTruthy()
      const ownedResponse = await apiRequest(request, 'GET', `/api/entities/definitions.manage?entityId=${editor.entityId}`, {
        token,
        headers: { Cookie: `om_selected_tenant=${tenantId}; om_selected_org=${organizationId}` },
      })
      expect(ownedResponse.ok()).toBeTruthy()
      const owned = await readJsonSafe<{ items: Array<{ key: string; tenantId: string; organizationId: string }> }>(ownedResponse)
      for (const field of serviceFields) {
        expect(owned?.items.find((item) => item.key === field.key)).toMatchObject({ tenantId, organizationId })
      }
    })

    test.afterEach(async ({ request }) => {
      try {
        if (tenantId && organizationId) {
          const response = await apiRequest(request, 'POST', '/api/entities/definitions.batch', {
            token,
            headers: { Cookie: `om_selected_tenant=${tenantId}; om_selected_org=${organizationId}` },
            data: {
              entityId: editor.entityId,
              definitions: serviceFields.map(({ key, kind }) => ({ key, kind, isActive: false })),
              fieldsets: [],
            },
          })
          expect(response.ok(), 'Remove owned definitions and fieldsets').toBeTruthy()
        }
      } finally {
        try {
          if (organizationId) {
            const response = await apiRequest(request, 'DELETE', `/api/directory/organizations?id=${organizationId}`, { token })
            expect(response.ok(), 'Delete owned organization').toBeTruthy()
          }
        } finally {
          if (tenantId) {
            const response = await apiRequest(request, 'DELETE', `/api/directory/tenants?id=${tenantId}`, { token })
            expect(response.ok(), 'Delete owned tenant').toBeTruthy()
          }
        }
      }
    })

    test('translates shipped metadata and preserves a tenant-authored label', async ({ page, request, baseURL }, testInfo) => {
      await acknowledgeGlobalNotices(page)
      await page.context().addCookies([
        { name: 'auth_token', value: token, url: baseURL! },
        { name: 'om_selected_tenant', value: tenantId!, url: baseURL! },
        { name: 'om_selected_org', value: organizationId!, url: baseURL! },
        { name: 'locale', value: 'pl', url: baseURL! },
      ])
      await page.goto(editor.path)
      const fieldsetSelector = page.getByRole('combobox').filter({ hasText: 'Donation campaign' })
      await fieldsetSelector.click()
      await page.getByRole('option', { name: 'Pakiet usług', exact: true }).click()
      await expect(page.getByRole('combobox').filter({ hasText: 'Pakiet usług' })).toBeVisible()
      await expect(page.getByText('Termin realizacji', { exact: true })).toBeVisible()
      await expect(page.getByText('Przed płatnością', { exact: true })).toBeVisible()
      await expect(page.getByText('Co obejmuje usługa', { exact: true })).toHaveCount(2)
      await expect(page.getByText('Co obejmuje usługa', { exact: true }).first()).toBeVisible()
      await expect(page.getByText('Co obejmuje usługa', { exact: true }).last()).toBeVisible()

      await testInfo.attach('polish-service-package', {
        body: await page.screenshot({ fullPage: true }),
        contentType: 'image/png',
      })

      const literalLabel = `Our delivery promise ${randomUUID()}`
      const deliveryField = serviceFields.find((field) => field.key === 'delivery_timeline')!
      const { key, kind, ...configJson } = deliveryField
      const response = await apiRequest(request, 'POST', '/api/entities/definitions', {
        token,
        headers: { Cookie: `om_selected_tenant=${tenantId}; om_selected_org=${organizationId}` },
        data: { entityId: editor.entityId, key, kind, configJson: { ...configJson, label: literalLabel } },
      })
      expect(response.ok(), 'Set tenant-authored label through the definitions API').toBeTruthy()
      await page.reload()
      await page.getByRole('combobox').filter({ hasText: 'Donation campaign' }).click()
      await page.getByRole('option', { name: 'Pakiet usług', exact: true }).click()
      await expect(page.getByText(literalLabel, { exact: true })).toBeVisible()
      await expect(page.getByText('Termin realizacji', { exact: true })).toHaveCount(0)
      await expect(page.getByText('Przed płatnością', { exact: true })).toBeVisible()
      await expect(page.getByText('Co obejmuje usługa', { exact: true })).toHaveCount(2)
      await expect(page.getByText('Co obejmuje usługa', { exact: true }).first()).toBeVisible()
      await expect(page.getByText('Co obejmuje usługa', { exact: true }).last()).toBeVisible()
      await testInfo.attach('polish-tenant-label', {
        body: await page.screenshot({ fullPage: true }),
        contentType: 'image/png',
      })
    })
  })
}
