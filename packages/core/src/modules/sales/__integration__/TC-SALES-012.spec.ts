import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deleteSalesEntityIfExists } from '@open-mercato/core/helpers/integration/salesFixtures'

type CreditMemoCreateResponse = {
  creditMemoId?: string | null
  id?: string | null
}

async function createCreditMemoFixture(
  request: Parameters<typeof apiRequest>[0],
  token: string,
  creditMemoNumber: string,
  options?: { withLine?: boolean; reason?: string },
): Promise<string> {
  const payload: Record<string, unknown> = {
    creditMemoNumber,
    currencyCode: 'USD',
    subtotalNetAmount: 50,
    subtotalGrossAmount: 61.5,
    taxTotalAmount: 11.5,
    grandTotalNetAmount: 50,
    grandTotalGrossAmount: 61.5,
  }
  if (options?.reason) payload.reason = options.reason
  if (options?.withLine) {
    payload.lines = [
      {
        lineNumber: 1,
        name: `Credit memo item ${creditMemoNumber}`,
        sku: `CM-SKU-${creditMemoNumber}`,
        quantity: 1,
        currencyCode: 'USD',
        unitPriceNet: 50,
        unitPriceGross: 61.5,
        taxRate: 23,
        taxAmount: 11.5,
        totalNetAmount: 50,
        totalGrossAmount: 61.5,
      },
    ]
  }
  const response = await apiRequest(request, 'POST', '/api/sales/credit-memos', {
    token,
    data: payload,
  })
  expect(
    response.ok(),
    `POST /api/sales/credit-memos failed (${response.status()})`,
  ).toBeTruthy()
  const body = await readJsonSafe<CreditMemoCreateResponse>(response)
  const id = body?.creditMemoId ?? body?.id ?? null
  expect(id, 'Credit memo id missing in create response').toBeTruthy()
  return id as string
}

/**
 * TC-SALES-012: Credit memo list & detail UI
 * Source: .ai/qa/scenarios/TC-SALES-012-credit-memo-creation.md
 *
 * Verifies the new backend credit memo pages (#1185):
 *  - list page renders (with a heading)
 *  - a credit memo created via API surfaces in the list
 *  - the detail page renders header, totals, reason, and line items
 *  - the underlying detail endpoint (/api/sales/credit-memos/[id]) returns the record + lines
 */
test.describe('TC-SALES-012: Credit memo list & detail UI', () => {
  test('admin lists credit memos and renders a credit memo detail with lines', async ({
    page,
    request,
  }) => {
    test.slow()
    const stamp = Date.now()
    const creditMemoNumber = `QA-CM-${stamp}`
    const reason = `QA refund reason ${stamp}`
    let token: string | null = null
    let creditMemoId: string | null = null

    try {
      token = await getAuthToken(request, 'admin')
      await login(page, 'admin')

      // 1) List page loads.
      await page.goto('/backend/sales/credit-memos')
      await expect(
        page.getByRole('heading', { name: /Credit memos/i }).first(),
      ).toBeVisible({ timeout: 15_000 })

      // 2) Create credit memo via API and verify it appears in the list.
      creditMemoId = await createCreditMemoFixture(
        request,
        token,
        creditMemoNumber,
        { withLine: true, reason },
      )

      await page.goto('/backend/sales/credit-memos')
      const row = page.getByRole('row', {
        name: new RegExp(creditMemoNumber, 'i'),
      })
      await expect(row).toBeVisible({ timeout: 15_000 })

      // 3) Detail endpoint returns the record + lines.
      const detailResponse = await apiRequest(
        request,
        'GET',
        `/api/sales/credit-memos/${creditMemoId}?populate=lines`,
        { token },
      )
      expect(
        detailResponse.status(),
        `GET /api/sales/credit-memos/[id] should be 200, got ${detailResponse.status()}`,
      ).toBe(200)
      const detailBody = await readJsonSafe<{
        creditMemoNumber?: string
        reason?: string | null
        lines?: Array<Record<string, unknown>>
      }>(detailResponse)
      expect(detailBody?.creditMemoNumber).toBe(creditMemoNumber)
      expect(detailBody?.reason).toBe(reason)
      expect(Array.isArray(detailBody?.lines)).toBe(true)
      expect(detailBody?.lines?.length).toBeGreaterThan(0)

      // 4) Detail page renders.
      await page.goto(`/backend/sales/credit-memos/${creditMemoId}`)
      await expect(
        page.getByRole('heading', {
          name: new RegExp(`Credit Memo ${creditMemoNumber}`, 'i'),
        }),
      ).toBeVisible({ timeout: 15_000 })
      await expect(page.getByText(reason).first()).toBeVisible()
      await expect(
        page.getByText(`Credit memo item ${creditMemoNumber}`).first(),
      ).toBeVisible()
    } finally {
      await deleteSalesEntityIfExists(
        request,
        token,
        '/api/sales/credit-memos',
        creditMemoId,
      )
    }
  })

  test('detail endpoint returns 404 for missing credit memo id', async ({
    request,
  }) => {
    const token = await getAuthToken(request, 'admin')
    const response = await apiRequest(
      request,
      'GET',
      `/api/sales/credit-memos/00000000-0000-0000-0000-000000000000`,
      { token },
    )
    expect(response.status()).toBe(404)
  })
})
