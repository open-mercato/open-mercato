import { expect, test, type APIRequestContext } from '@playwright/test'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { createSalesOrderFixture } from '@open-mercato/core/modules/core/__integration__/helpers/salesFixtures'

/**
 * TC-SALES-ADDR-CONTACT-001 — address-level contact details on the document detail page.
 *
 * Spec: .ai/specs/2026-08-10-address-contact-and-tax-fields.md (Phase 1)
 *
 * The document address snapshot is schemaless, so an integration posting `phone` / `taxId` /
 * `taxIdType` beside the postal fields always had them PERSISTED — this phase gives them a read
 * path. The spec proves the full journey: an order created via the API with a snapshot carrying
 * the contact keys round-trips them through the API, and the document detail page renders them
 * as the contact block under the billing tile.
 *
 * The editor-save round-trip (unowned keys surviving a manual address save) and the
 * locked-document disabled editor are covered at the component level —
 * `components/documents/__tests__/AddressesSection.test.tsx` — where both sides of each
 * behaviour can be asserted deterministically; this spec owns the API-and-page journey.
 */

const BASE_URL = process.env.BASE_URL?.trim() || null
function resolveUrl(path: string): string {
  return BASE_URL ? `${BASE_URL}${path}` : path
}

const BILLING_SNAPSHOT = {
  name: 'QA Contact Fixture',
  addressLine1: '12 Market Street',
  city: 'London',
  postalCode: 'SW1A 1AA',
  country: 'GB',
  phone: '+48 600 100 200',
  taxId: 'PL1234567890',
  taxIdType: 'eu_vat',
}

async function putOrder(
  request: APIRequestContext,
  token: string,
  orderId: string,
  data: Record<string, unknown>,
) {
  return request.fetch(resolveUrl('/api/sales/orders'), {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: { id: orderId, ...data },
  })
}

async function readOrder(request: APIRequestContext, token: string, orderId: string) {
  const response = await request.fetch(resolveUrl(`/api/sales/orders?id=${encodeURIComponent(orderId)}`), {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  })
  expect(response.status(), 'GET /api/sales/orders?id=... should return 200').toBe(200)
  const body = (await response.json()) as { items?: Array<Record<string, unknown>> }
  const item = body.items?.[0]
  expect(item, 'response should include the requested order').toBeTruthy()
  return item as Record<string, unknown>
}

test.describe('TC-SALES-ADDR-CONTACT-001: contact details on the document address', () => {
  let token: string
  let orderId: string

  test.beforeAll(async ({ request }) => {
    token = await getAuthToken(request)
    orderId = await createSalesOrderFixture(request, token)
    const put = await putOrder(request, token, orderId, { billingAddressSnapshot: BILLING_SNAPSHOT })
    expect(put.status(), 'seeding the billing snapshot should succeed').toBe(200)
  })

  test.afterAll(async ({ request }) => {
    if (!orderId) return
    await request.fetch(resolveUrl('/api/sales/orders'), {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { id: orderId },
    })
  })

  test('the snapshot round-trips the contact keys through the API', async ({ request }) => {
    const item = await readOrder(request, token, orderId)
    const snapshot = (item.billingAddressSnapshot ?? item.billing_address_snapshot) as
      | Record<string, unknown>
      | undefined
    expect(snapshot, 'order should carry the billing snapshot').toBeTruthy()
    expect(snapshot).toMatchObject({
      phone: '+48 600 100 200',
      taxId: 'PL1234567890',
      taxIdType: 'eu_vat',
    })
  })

  test('the document detail page renders the tax id and the phone on the billing address', async ({ page }) => {
    await login(page)
    await page.goto(resolveUrl(`/backend/sales/orders/${orderId}`))
    await page.getByRole('button', { name: 'Addresses' }).click()

    // The labels come from sales.documents.detail.addresses.{taxId,phone}; the values are the
    // snapshot's own. The tax id TYPE is metadata and must not surface as a line of its own.
    await expect(page.getByText('Tax ID: PL1234567890')).toBeVisible()
    await expect(page.getByText('Phone: +48 600 100 200')).toBeVisible()
    await expect(page.getByText(/eu_vat/)).toHaveCount(0)

    // Postal-purity downstream: the one-line summaries built from the postal lines must not have
    // the contact details spliced in.
    await expect(page.getByText('12 Market Street, PL1234567890')).toHaveCount(0)
  })
})
