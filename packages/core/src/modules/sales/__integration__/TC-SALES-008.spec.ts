import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deleteSalesEntityIfExists } from '@open-mercato/core/helpers/integration/salesFixtures'

type InvoiceCreateResponse = {
  invoiceId?: string | null
  id?: string | null
}

async function createInvoiceFixture(
  request: Parameters<typeof apiRequest>[0],
  token: string,
  invoiceNumber: string,
  options?: { withLine?: boolean },
): Promise<string> {
  const payload: Record<string, unknown> = {
    invoiceNumber,
    currencyCode: 'USD',
    subtotalNetAmount: 100,
    subtotalGrossAmount: 123,
    taxTotalAmount: 23,
    grandTotalNetAmount: 100,
    grandTotalGrossAmount: 123,
  }
  if (options?.withLine) {
    payload.lines = [
      {
        lineNumber: 1,
        kind: 'product',
        name: `Invoice item ${invoiceNumber}`,
        sku: `SKU-${invoiceNumber}`,
        quantity: 1,
        currencyCode: 'USD',
        unitPriceNet: 100,
        unitPriceGross: 123,
        taxRate: 23,
        taxAmount: 23,
        totalNetAmount: 100,
        totalGrossAmount: 123,
      },
    ]
  }
  const response = await apiRequest(request, 'POST', '/api/sales/invoices', {
    token,
    data: payload,
  })
  expect(
    response.ok(),
    `POST /api/sales/invoices failed (${response.status()})`,
  ).toBeTruthy()
  const body = await readJsonSafe<InvoiceCreateResponse>(response)
  const id = body?.invoiceId ?? body?.id ?? null
  expect(id, 'Invoice id missing in create response').toBeTruthy()
  return id as string
}

/**
 * TC-SALES-008: Invoice list & detail UI
 * Source: .ai/qa/scenarios/TC-SALES-008-invoice-creation-full.md
 *
 * Verifies the new backend invoice pages (#1185):
 *  - empty list state renders for an org without invoices (best-effort)
 *  - an invoice created via API surfaces in the list
 *  - the detail page renders header, totals, and line items
 *  - the underlying detail endpoint (/api/sales/invoices/[id]) returns the record + lines
 */
test.describe('TC-SALES-008: Invoice list & detail UI', () => {
  test('admin sees invoice list with empty state and renders an invoice detail with lines', async ({
    page,
    request,
  }) => {
    test.slow()
    const stamp = Date.now()
    const invoiceNumber = `QA-INV-${stamp}`
    let token: string | null = null
    let invoiceId: string | null = null

    try {
      token = await getAuthToken(request, 'admin')
      await login(page, 'admin')

      // 1) Empty/initial list state — page renders and table loads.
      await page.goto('/backend/sales/invoices')
      await expect(
        page.getByRole('heading', { name: /Sales invoices/i }).first(),
      ).toBeVisible({ timeout: 15_000 })

      // 2) Create invoice via API and verify it shows up in the list.
      invoiceId = await createInvoiceFixture(request, token, invoiceNumber, {
        withLine: true,
      })

      await page.goto('/backend/sales/invoices')
      const row = page.getByRole('row', {
        name: new RegExp(invoiceNumber, 'i'),
      })
      await expect(row).toBeVisible({ timeout: 15_000 })

      // 3) Detail endpoint returns the record + lines.
      const detailResponse = await apiRequest(
        request,
        'GET',
        `/api/sales/invoices/${invoiceId}?populate=lines`,
        { token },
      )
      expect(
        detailResponse.status(),
        `GET /api/sales/invoices/[id] should be 200, got ${detailResponse.status()}`,
      ).toBe(200)
      const detailBody = await readJsonSafe<{
        invoiceNumber?: string
        lines?: Array<Record<string, unknown>>
      }>(detailResponse)
      expect(detailBody?.invoiceNumber).toBe(invoiceNumber)
      expect(Array.isArray(detailBody?.lines)).toBe(true)
      expect(detailBody?.lines?.length).toBeGreaterThan(0)

      // 4) Detail page renders.
      await page.goto(`/backend/sales/invoices/${invoiceId}`)
      await expect(
        page.getByRole('heading', {
          name: new RegExp(`Invoice ${invoiceNumber}`, 'i'),
        }),
      ).toBeVisible({ timeout: 15_000 })
      await expect(
        page.getByText('Grand Total', { exact: false }).first(),
      ).toBeVisible()
      await expect(
        page.getByText(`Invoice item ${invoiceNumber}`).first(),
      ).toBeVisible()
    } finally {
      await deleteSalesEntityIfExists(
        request,
        token,
        '/api/sales/invoices',
        invoiceId,
      )
    }
  })

  test('detail endpoint returns 404 for missing invoice id', async ({
    request,
  }) => {
    const token = await getAuthToken(request, 'admin')
    const response = await apiRequest(
      request,
      'GET',
      `/api/sales/invoices/00000000-0000-0000-0000-000000000000`,
      { token },
    )
    expect(response.status()).toBe(404)
  })
})
